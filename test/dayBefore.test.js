// -----------------------------------------------------------------------------
// Fix 0.1.2 (as gladys-zeversolar): the counter of the day before shown again,
// and the margin of the production index learned from the solar power.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DailyIndex } from '../src/daily.js';
import {
  keptOut,
  maxKwOf,
  noteNewDay,
  plausiblePeak,
  readMaxKw,
  validPeaks,
  validRef,
  withPeak,
} from '../src/dayBefore.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Local time in Paris on 2026-10-(12 + day), "HH:MM" (CEST, UTC+2). */
const at = (day, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return Date.UTC(2026, 9, 12 + day, h - 2, m);
};
const r3 = (v) => (v === undefined ? undefined : Math.round(v * 1000) / 1000);

/** daily.js behind keptOut and noteNewDay, as src/app.js chains them. */
function chain() {
  const daily = new DailyIndex(undefined, { timeZone: 'Europe/Paris' });
  const ref = validRef(null);
  return {
    daily,
    ref,
    read(today, time) {
      if (keptOut(daily, ref, today, time)) return 'kept out';
      const built = daily.read(today, time);
      noteNewDay(daily, ref, time);
      return r3(built);
    },
  };
}

test('the day before shown again later the same day is kept out, then the day goes on', () => {
  const c = chain();
  c.read(14.9, at(0, '23:58'));
  c.read(15, at(0, '23:59'));
  assert.equal(c.read(0, at(1, '00:00')), 15, 'a new day, the index unchanged');
  assert.deepEqual(c.ref.dayBefore, { day: '2026-10-13', value: 15 });
  for (let m = 1; m <= 60; m += 1) c.read(r3(m * 0.1), at(1, '00:00') + m * MINUTE);
  // A reboot at 12:00 shows the day before again (15.05, within 0.1 kWh): kept out.
  c.read(6.1, at(1, '12:00'));
  assert.equal(c.read(15.05, at(1, '12:30')), 'kept out');
  assert.equal(c.read(14.95, at(1, '12:31')), 'kept out', 'a little under it too (symmetric band)');
  assert.equal(c.read(6.2, at(1, '12:32')), 21.2, 'the real counter goes on');
});

test('after midnight, the counter of the day before still shown is kept out until the reset', () => {
  const c = chain();
  c.read(15, at(0, '23:59'));
  assert.equal(c.read(15.05, at(1, '00:00')), 'kept out');
  assert.deepEqual(c.ref.staleSeen, { day: '2026-10-13', value: 15.05 });
  assert.equal(c.read(0.01, at(1, '00:30')), 15, 'the reset: a new day, nothing counted twice');
  assert.equal(c.ref.dayBefore.value, 15.05);
  assert.equal(c.read(15.04, at(1, '00:40')), 'kept out');
});

test('the margin of the production index: learned after 7 days, bounded, outliers twice', () => {
  assert.equal(maxKwOf([]), 36);
  let peaks = [];
  for (let d = 1; d <= 7; d += 1) peaks = withPeak(peaks, `2026-10-0${d}`, 3000);
  assert.equal(maxKwOf(peaks), 4.5);
  peaks = withPeak(peaks, '2026-10-07', 2000);
  assert.equal(peaks.at(-1).w, 3000, 'the highest of the day kept');
  assert.equal(maxKwOf([{ day: '2026-10-01', w: 100 }].concat(peaks.slice(1))), 4.5);
  const low = Array.from({ length: 7 }, (_, i) => ({ day: `2026-10-0${i + 1}`, w: 200 }));
  assert.equal(maxKwOf(low), 2, 'never under 2 kW');
  // An aberrant power never; an outlier only seen twice in a row (the lower one).
  const state = {};
  assert.equal(plausiblePeak(peaks, 65_535, state), undefined);
  assert.equal(plausiblePeak(peaks, 9000, state), undefined);
  assert.equal(plausiblePeak(peaks, 8000, state), 8000);
  assert.equal(plausiblePeak(peaks, 4000, state), 4000);
  assert.equal(plausiblePeak([], 30_000, {}), 30_000, 'the first week: learned as is');
  // One read may be wider than the margin: 1.5 × its own plausible power.
  assert.equal(readMaxKw(peaks, 6000), 9);
  assert.equal(readMaxKw(peaks, 1000), 4.5);
  assert.equal(readMaxKw(peaks, 65_535), 4.5);
  assert.deepEqual(validPeaks([{ day: 'x', w: 1 }, { day: '2026-10-01', w: -1 }, null]), []);
  assert.deepEqual(validRef({ dayBefore: { day: 'x', value: 1 } }), {
    dayBefore: null,
    staleSeen: null,
  });
});

test('a false counter +12 kWh after 30 silent minutes is no longer taken with a 3 kW install', () => {
  let peaks = [];
  for (let d = 1; d <= 7; d += 1) peaks = withPeak(peaks, `2026-10-0${d}`, 3000);
  const kw = maxKwOf(peaks);
  const daily = new DailyIndex(undefined, { timeZone: 'Europe/Paris', maxKw: kw });
  daily.read(5, at(0, '12:00'));
  assert.equal(
    daily.read(17, at(0, '12:30')),
    undefined,
    '4.5 kW × 0.5 h + 0.5 = 2.75 kWh at most',
  );
  assert.ok(HOUR > 0);
});
