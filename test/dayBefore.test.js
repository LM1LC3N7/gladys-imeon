// -----------------------------------------------------------------------------
// Fix 0.1.2 (as gladys-zeversolar): the counter of the day before shown again,
// and the margin of the production index learned from the solar power.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DailyIndex } from '../src/daily.js';
import {
  keptOut,
  markFromUndo,
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

// --- Review 0.1.2, B1: an inverter whose midnight comes before ours ---------------------

/** A chain in a time zone; times built in Paris (CEST, UTC+2). */
function chainIn(timeZone) {
  const daily = new DailyIndex(undefined, { timeZone });
  const ref = validRef(null);
  return {
    ref,
    read(today, time) {
      if (keptOut(daily, ref, today, time)) return 'kept out';
      const built = daily.read(today, time);
      noteNewDay(daily, ref, time);
      return r3(built);
    },
  };
}

test('the inverter resets at 23:59 (its clock ahead): the day before is still kept out the next day', () => {
  const c = chain();
  c.read(14.9, at(0, '23:57'));
  c.read(15, at(0, '23:58'));
  assert.equal(c.read(0, at(0, '23:59')), 15, 'its midnight, one minute before ours: a new day');
  assert.equal(
    c.ref.dayBefore.day,
    '2026-10-13',
    'noted for the night it starts, not for 2026-10-12',
  );
  for (let m = 1; m <= 60; m += 1) c.read(r3(m * 0.1), at(0, '23:59') + m * MINUTE);
  c.read(6.1, at(1, '12:00'));
  // A reboot after a silence shows the day before again: never a rise of today's counter.
  assert.equal(c.read(15, at(1, '12:40')), 'kept out');
  assert.equal(c.read(6.3, at(1, '12:41')), 21.3, 'the real counter goes on');
});

for (const [label, aheadMs, timeZone] of [
  ['30 s', 30_000, 'Europe/Paris'],
  ['2 min', 2 * MINUTE, 'Europe/Paris'],
  ['20 min', 20 * MINUTE, 'Europe/Paris'],
  ['55 min', 55 * MINUTE, 'Europe/Paris'],
  // The inverter on Paris time, the container in Lisbon: its midnight 1 h before ours.
  ['1 h (container in Lisbon, inverter in Paris)', 0, 'Europe/Lisbon'],
]) {
  test(`the inverter's midnight ${label} ahead: the day before shown at noon is kept out`, () => {
    const c = chainIn(timeZone);
    const reset = at(1, '00:00') - aheadMs;
    // Reads every minute at :45 seconds, the counter at 15 until its midnight.
    let time = at(0, '22:00') + 45_000;
    for (; time < reset; time += MINUTE) c.read(15, time);
    assert.equal(c.read(0, time), 15, 'its midnight: a new day, the index unchanged');
    for (let m = 1; m <= 120; m += 1) c.read(r3(m * 0.05), time + m * MINUTE);
    assert.equal(c.read(6.1, at(1, '12:00')), 21.1);
    assert.equal(c.read(15.05, at(1, '12:40')), 'kept out');
    assert.equal(c.read(6.2, at(1, '12:41')), 21.2);
  });
}

test('after an update from 0.1.1 within 3 h of a new day, the mark comes from the undo (m1)', () => {
  const daily = new DailyIndex(undefined, { timeZone: 'Europe/Paris' });
  daily.read(15, at(0, '23:59'));
  daily.read(0, at(1, '00:01'));
  const ref = validRef(null);
  markFromUndo(daily, ref);
  assert.deepEqual(ref.dayBefore, { day: '2026-10-13', value: 15 });
  const kept = { dayBefore: { day: '2026-10-13', value: 9 }, staleSeen: null };
  markFromUndo(daily, kept);
  assert.equal(kept.dayBefore.value, 9, 'an existing mark is kept');
});

test('approval R1: a small grid day (0.06 kWh) still sees the reset of the next day', () => {
  const c = chain();
  c.read(0.05, at(0, '22:00'));
  c.read(0.06, at(0, '23:59'));
  // The next day starts at 0.001 kWh: far under half the day before, a new day.
  assert.equal(c.read(0.001, at(1, '00:01')), 0.06);
  assert.equal(c.ref.dayBefore.value, 0.06);
  assert.equal(c.read(0.002, at(1, '00:02')), 0.061);
  // Still near it after midnight (the inverter late): kept out as before.
  const late = chain();
  late.read(0.06, at(0, '23:59'));
  assert.equal(late.read(0.06, at(1, '00:01')), 'kept out');
});

test('a new day taken at 23:xx (inverter ahead): its own small counter is not kept out after our midnight', () => {
  const c = chain();
  c.read(0.07, at(0, '22:59'));
  assert.equal(c.read(0.001, at(0, '23:00')), 0.07, 'its midnight, an hour before ours');
  assert.equal(c.read(0.001, at(1, '00:00')), 0.07, 'our midnight: today counter, taken');
  assert.equal(c.read(0.05, at(1, '12:00')), 0.119);
});

// --- Approval R2: a slow rise is never kept out ------------------------------------

/** Counts the rises of the built index, as the core does (kept-out reads give nothing). */
function counting() {
  const c = chain();
  let last;
  let counted = 0;
  return {
    c,
    read(today, time) {
      const v = c.read(today, time);
      if (typeof v === 'number') {
        if (last !== undefined && v > last) counted += v - last;
        last = v;
      }
      return v;
    },
    get counted() {
      return r3(counted);
    },
  };
}

test('two equal days, then the day before shown again on day 2: counted at most the real', () => {
  const p = counting();
  for (let day = 0; day < 2; day += 1) {
    for (let m = 0; m < 1440; m += 1) {
      const today = r3((Math.min(Math.max(0, m - 480), 720) / 720) * 10);
      if (day === 1 && m === 720) {
        // Noon of day 2 (counter at 4): a reboot shows the day before (10) again.
        assert.equal(p.read(10, at(day, '00:00') + m * MINUTE), 'kept out');
      }
      p.read(today, at(day, '00:00') + m * MINUTE);
    }
  }
  assert.ok(p.counted <= 20, `counted ${p.counted}`);
  assert.ok(p.counted >= 19.98, `counted ${p.counted}`);
});

test('seven days of 0.15 kWh spread over the day: counted as real within 0.01 kWh', () => {
  const p = counting();
  for (let day = 0; day < 7; day += 1) {
    for (let m = 0; m < 1440; m += 1) {
      p.read(r3((m / 1439) * 0.15), at(day, '00:00') + m * MINUTE);
    }
  }
  // Real: 7 × 0.15 kWh, minus the first read of each new day (nothing counted for it).
  assert.ok(Math.abs(p.counted - 1.05) <= 0.01, `counted ${p.counted}`);
  assert.ok(p.counted <= 1.05 + 1e-9);
});
