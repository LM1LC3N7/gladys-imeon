// -----------------------------------------------------------------------------
// A cumulative index built from a counter of the day. Pure.
//
// The local API of an IMEON inverter gives its energies as counters of the
// day (`/api/energy`: "today" in imeon_inverter_api and in Home Assistant),
// started again at the inverter's midnight, and no lifetime counter. The
// Gladys energy monitoring needs a cumulative index (it counts the deltas),
// never a counter of the day: published as an index, it would drop to 0
// every night, the guard (src/guard.js) would hold every one of those drops,
// and the index would be stuck. So the index is built here:
//
//   index = offset + today
//
// where `offset` is the sum of the days already ended. Every doubt counts
// LESS, never more. The rules:
// - a rise of the counter is taken only when it is plausible since the last
//   value taken: at most `maxKw` × the time since that read (`readAt`, moved
//   by every value taken, an equal one included) + `slackKwh`. A larger rise
//   is a jump: no index, the counter of reference does not move, and
//   `readAt` moves anyway, so a jump is never confirmed by time;
// - a drop is a new day only around the local midnight (from `windowBefore`
//   before to `windowAfter` after it, in `timeZone`: the inverter's clock may
//   be a little off), once per night, or when the last value taken is from an
//   earlier local day (a cut across midnight), and only down to at most
//   `resetMaxKwh`. The last value of the day ended goes into `offset`: the
//   index goes on without dropping. What the inverter counted between our
//   last read and its midnight is lost (less);
// - any other drop (a reboot, a clock lost, a glitch in the day) gives no
//   index, and nothing moves: the counter must come back above the last value
//   taken. What was counted meanwhile and is not back is lost (less);
// - a new day taken by mistake (a glitch to 0 near midnight) is undone when,
//   within `undoWithinMs`, the counter comes back faster than `maxKw` allows,
//   or comes back to exactly the value of the day before (a frozen counter);
// - a wall clock set back (a value read before the last one taken) gives no
//   index and moves nothing; a `readAt` read back from /data in the future is
//   brought back to the time of loading.
//
// Risk left near midnight: a glitch to near 0 in the midnight window, then
// the inverter unreachable long enough for `maxKw` to cover the return, then
// back at a value other than the one of the day before, is taken as a new day
// and the day before is counted again. It needs three faults in a row.
//
// Whatever comes out still passes the IndexGuard, which holds any jump or
// drop of the built index.
// -----------------------------------------------------------------------------

const HOUR = 3_600_000;

export const DAILY_DEFAULTS = {
  resetMaxKwh: 36,
  undoWithinMs: 3 * HOUR,
  maxKw: 36,
  slackKwh: 0.5,
  windowBefore: HOUR,
  windowAfter: 3 * HOUR,
  timeZone: 'Europe/Paris',
};

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (value) => (typeof value === 'string' && DAY.test(value) ? value : null);

const formats = new Map();
const localPartsFormat = (timeZone) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });

/** The local date (YYYY-MM-DD) and hour (0-23) of `at` in `timeZone`. */
export function localParts(at, timeZone) {
  let format = formats.get(timeZone);
  if (!format) {
    try {
      format = localPartsFormat(timeZone);
    } catch {
      // An unknown time zone: the one of the inverters' home market.
      format = localPartsFormat(DAILY_DEFAULTS.timeZone);
    }
    formats.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(at).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

function validState(saved, loadedAt) {
  if (
    !saved ||
    !finite(saved.offset) ||
    !finite(saved.today) ||
    saved.today < 0 ||
    !finite(saved.readAt)
  ) {
    return undefined;
  }
  const undo = saved.undo;
  // A date of /data in the future (a clock set back since) is brought back to now.
  const clamp = (at) => (finite(loadedAt) ? Math.min(at, loadedAt) : at);
  return {
    offset: saved.offset,
    today: saved.today,
    readAt: clamp(saved.readAt),
    readDay: day(saved.readDay),
    resetWindow: day(saved.resetWindow),
    undo:
      undo &&
      finite(undo.prevToday) &&
      finite(undo.prevReadAt) &&
      finite(undo.at) &&
      finite(undo.resetValue)
        ? {
            prevToday: undo.prevToday,
            prevReadAt: clamp(undo.prevReadAt),
            prevReadDay: day(undo.prevReadDay),
            prevResetWindow: day(undo.prevResetWindow),
            at: clamp(undo.at),
            resetValue: undo.resetValue,
          }
        : null,
  };
}

export class DailyIndex {
  /**
   * `saved`: the state kept in /data (`state()`). `limits`: see
   * DAILY_DEFAULTS (a missing one takes its default). `loadedAt`: the time of
   * loading (a date of /data after it is brought back to it).
   */
  constructor(saved, limits = {}, loadedAt) {
    this.limits = { ...DAILY_DEFAULTS };
    for (const [key, value] of Object.entries(limits ?? {})) {
      if (value !== undefined && key in DAILY_DEFAULTS) this.limits[key] = value;
    }
    this.s = validState(saved, loadedAt);
  }

  /** What /data keeps. */
  state() {
    return this.s ? { ...this.s, undo: this.s.undo ? { ...this.s.undo } : null } : null;
  }

  local(at) {
    return localParts(at, this.limits.timeZone);
  }

  /** The night `at` belongs to (the date after its midnight), and whether `at` is in its window. */
  window(at) {
    const { windowBefore, windowAfter } = this.limits;
    const shifted = this.local(at + windowBefore);
    return {
      key: shifted.date,
      inside: shifted.hour * HOUR < windowBefore + windowAfter,
    };
  }

  take(today, at) {
    this.s.today = today;
    this.s.readAt = at;
    this.s.readDay = this.local(at).date;
    return this.s.offset + today;
  }

  undo() {
    const { undo } = this.s;
    this.s.offset -= undo.prevToday;
    this.s.today = undo.prevToday;
    this.s.readAt = undo.prevReadAt;
    this.s.readDay = undo.prevReadDay;
    this.s.resetWindow = undo.prevResetWindow;
    this.s.undo = null;
  }

  /**
   * The index for a counter of the day `today` (kWh) read at `at` (ms), or
   * undefined (no index for that read). `known`: the index Gladys holds
   * (`{ value }`), used only the very first time, so that an index already
   * in Gladys goes on from its value (never from 0).
   */
  read(today, at, known) {
    if (!finite(today) || today < 0 || !finite(at)) {
      return undefined;
    }
    const s = this.s;
    if (!s) {
      const base = known && finite(known.value) && known.value > 0 ? known.value - today : 0;
      this.s = { offset: base, today, readAt: at, readDay: null, resetWindow: null, undo: null };
      return this.take(today, at);
    }
    if (at < s.readAt) {
      // The wall clock went back: nothing taken, nothing moved.
      return undefined;
    }
    const { resetMaxKwh, undoWithinMs, maxKw, slackKwh } = this.limits;
    if (s.undo && (at - s.undo.at > undoWithinMs || at < s.undo.at)) {
      s.undo = null;
    }
    if (
      s.undo &&
      s.today === s.undo.resetValue &&
      today > s.today &&
      Math.abs(today - s.undo.prevToday) < 0.0005
    ) {
      // Straight from the new day's value back to exactly the value of the day
      // before (a real new day climbs on its way): a frozen counter, undone.
      this.undo();
      return this.read(today, at);
    }
    if (today >= s.today) {
      const margin = (maxKw * (at - s.readAt)) / HOUR + slackKwh;
      if (today - s.today <= margin) {
        return this.take(today, at);
      }
      if (s.undo) {
        // Too fast for a new day: the new day was a glitch, undone.
        this.undo();
        return this.read(today, at);
      }
      // A jump: never taken, never confirmed by time.
      s.readAt = at;
      s.readDay = this.local(at).date;
      return undefined;
    }
    // A drop: a new day, or a glitch.
    const night = this.window(at);
    const laterDay = s.readDay !== null && this.local(at).date > s.readDay;
    const newDay =
      today <= resetMaxKwh && ((night.inside && s.resetWindow !== night.key) || laterDay);
    if (!newDay) {
      return undefined;
    }
    s.undo = {
      prevToday: s.today,
      prevReadAt: s.readAt,
      prevReadDay: s.readDay,
      prevResetWindow: s.resetWindow,
      at,
      resetValue: today,
    };
    s.offset += s.today;
    s.resetWindow = night.key;
    return this.take(today, at);
  }
}
