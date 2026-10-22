// -----------------------------------------------------------------------------
// What the app adds around src/daily.js (shared with gladys-zeversolar, same
// code there, fix 0.1.2): the counter of the day before shown again, and the
// margin of the solar production index learned from the power. Pure.
//
// - The day before shown again (zeversolar review 1, B1 and I1): an inverter
//   that reboots may show the counter of the day before again. Given to the
//   daily index, it would be taken as a rise of today's counter and counted a
//   second time. So a value back within ±STALE_BAND_KWH of the day before is
//   kept out of the index (as a counter not read: its time is not moved):
//   - on a later local day than the last value taken, near that value (the
//     inverter has not started its new day yet);
//   - later the same local day as a new day, near the value of the day before
//     while today's counter taken is still under it.
//   Cost: about 0.1 kWh (the band plus one read) at the end of a day that
//   ends within 0.1 kWh of the day before. The protection starts at the first
//   midnight after an update from 0.1.1 (no mark before), or at once when the
//   update falls within 3 h of a new day (the mark is drawn from the daily
//   index's pending undo, markFromUndo).
// - The margin of the production index (zeversolar review 1, I3): 1.5 × the
//   highest solar power of the last 30 days, once 7 days are known, bounded
//   to MAX_KW_MIN..MAX_KW_MAX; INDEX_MAX_KW until then. The same for the
//   daily index and the guard.
// -----------------------------------------------------------------------------

import {
  INDEX_MAX_KW,
  MAX_KW_MAX,
  MAX_KW_MIN,
  PEAK_DAYS_KEPT,
  PEAK_DAYS_MIN,
  PEAK_OUTLIER,
  PLAUSIBLE_POWER_MAX,
  STALE_BAND_KWH,
  STALE_BELOW_KWH,
} from './constants.js';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A margin (kW), rounded up to half a kW and bounded. */
export const clampKw = (kw) => Math.min(MAX_KW_MAX, Math.max(MAX_KW_MIN, Math.ceil(kw * 2) / 2));

/** The daily power peaks kept in /data: `[{ day, w }]`, valid, the last PEAK_DAYS_KEPT days. */
export function validPeaks(peaks) {
  if (!Array.isArray(peaks)) {
    return [];
  }
  return peaks
    .filter(
      (p) =>
        p &&
        typeof p.day === 'string' &&
        DAY.test(p.day) &&
        finite(p.w) &&
        p.w >= 0 &&
        p.w <= PLAUSIBLE_POWER_MAX,
    )
    .map((p) => ({ day: p.day, w: p.w }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .slice(-PEAK_DAYS_KEPT);
}

/** The peaks with the power `w` read on local `day`. */
export function withPeak(peaks, day, w) {
  const known = peaks.find((p) => p.day === day);
  if (known) {
    return known.w >= w ? peaks : peaks.map((p) => (p.day === day ? { day, w } : p));
  }
  return validPeaks([...peaks, { day, w }]);
}

/** The margin of the production index (kW): learned once 7 days are known. */
export function maxKwOf(peaks) {
  if (peaks.length < PEAK_DAYS_MIN) {
    return INDEX_MAX_KW;
  }
  return clampKw((PEAK_OUTLIER * Math.max(...peaks.map((p) => p.w))) / 1000);
}

/**
 * The power of a read as a peak to learn, or undefined: aberrant (above
 * PLAUSIBLE_POWER_MAX), never; above 1.5 × the highest of the last 30 days
 * (once 7 are known), only when seen twice in a row (then the lower of the
 * two). `state.outlier` keeps the first one.
 */
export function plausiblePeak(peaks, power, state) {
  const previous = state.outlier;
  state.outlier = undefined;
  if (!finite(power) || power < 0 || power > PLAUSIBLE_POWER_MAX) {
    return undefined;
  }
  if (peaks.length < PEAK_DAYS_MIN) {
    return power;
  }
  const top = PEAK_OUTLIER * Math.max(...peaks.map((p) => p.w));
  if (power <= top) {
    return power;
  }
  if (previous !== undefined) {
    return Math.min(previous, power);
  }
  state.outlier = power;
  return undefined;
}

/**
 * The margin of ONE read (kW): the learned one, widened to 1.5 × the power of
 * that read when it is above it and plausible (the first read after an
 * outage that ends in full sun). Counting too much then needs a wrong counter
 * AND a wrong power in the same answer.
 */
export function readMaxKw(peaks, power) {
  const kw = maxKwOf(peaks);
  if (!finite(power) || power < 0 || power > PLAUSIBLE_POWER_MAX) {
    return kw;
  }
  return Math.max(kw, clampKw((PEAK_OUTLIER * power) / 1000));
}

/** `{ day, value }` read back from /data, else null. */
const validMark = (mark) =>
  mark &&
  typeof mark.day === 'string' &&
  DAY.test(mark.day) &&
  finite(mark.value) &&
  mark.value >= 0
    ? { day: mark.day, value: mark.value }
    : null;

/**
 * The marks of the counter of the day before, kept in /data with the index:
 * `dayBefore` the value of the day before for the local day of the new day
 * (the last value taken, or a higher stale value seen after midnight),
 * `staleSeen` the highest stale value kept out after midnight that day.
 */
export const validRef = (ref) => ({
  dayBefore: validMark(ref?.dayBefore),
  staleSeen: validMark(ref?.staleSeen),
});

/**
 * Whether the counter `today`, read at `now`, is the day before shown again,
 * to keep out of the index. Pure but for `ref.staleSeen`. Returns 'later'
 * (a later local day, near the last value taken), 'again' (the same local
 * day as a new day, near the day before) or undefined.
 */
export function keptOut(daily, ref, today, now) {
  const s = daily.state();
  if (!s || !(today > 0)) {
    return undefined;
  }
  const day = daily.local(now).date;
  if (
    s.readDay &&
    day > s.readDay &&
    today >= s.today - STALE_BELOW_KWH &&
    today <= s.today + STALE_BAND_KWH
  ) {
    const seen = ref.staleSeen?.day === day ? ref.staleSeen.value : 0;
    ref.staleSeen = { day, value: Math.max(seen, today) };
    return 'later';
  }
  const before = ref.dayBefore;
  if (
    before &&
    // The night of the new day, or the local date: an inverter whose midnight
    // comes before ours resets at 23:xx (review 0.1.2, B1).
    (before.day === day || before.day === daily.window(now).key) &&
    s.today < before.value - STALE_BAND_KWH &&
    today >= before.value - STALE_BELOW_KWH &&
    today <= before.value + STALE_BAND_KWH
  ) {
    return 'again';
  }
  return undefined;
}

/** After a read the daily index took: a new day just started notes the value of the day before. */
export function noteNewDay(daily, ref, now) {
  const s = daily.state();
  if (!s?.undo || s.undo.at !== now) {
    return;
  }
  // The night of the new day (the date after its midnight), not the local
  // date: an inverter whose midnight comes before ours resets at 23:xx and
  // the mark must hold for the next day (review 0.1.2, B1).
  const day = daily.window(now).key;
  const seen = ref.staleSeen?.day === day ? ref.staleSeen.value : 0;
  ref.dayBefore = { day, value: Math.max(s.undo.prevToday, seen) };
}

/**
 * A missing mark drawn from the daily index (review 0.1.2, m1): after an
 * update from 0.1.1 within 3 h of a new day, its pending undo knows the value
 * of the day before.
 */
export function markFromUndo(daily, ref) {
  const undo = daily.state()?.undo;
  if (ref.dayBefore || !undo) {
    return;
  }
  ref.dayBefore = { day: daily.window(undo.at).key, value: undo.prevToday };
}
