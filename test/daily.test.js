// -----------------------------------------------------------------------------
// The cumulative index built from a counter of the day (src/daily.js), alone
// and with the guard behind it.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DailyIndex } from '../src/daily.js';
import { IndexGuard } from '../src/guard.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const LIMITS = {
  resetMaxKwh: 36,
  minGapMs: 12 * HOUR,
  undoWithinMs: HOUR,
  maxKw: 36,
  slackKwh: 0.5,
};
const fresh = (saved) => new DailyIndex(saved, LIMITS);
const r3 = (v) => (v === undefined ? undefined : Math.round(v * 1000) / 1000);

test('daily index: the same day, it follows the counter; the first read starts from it', () => {
  const daily = fresh();
  assert.equal(daily.read(2, 0), 2);
  assert.equal(daily.read(2, MINUTE), 2, 'unchanged');
  assert.equal(daily.read(3.5, 2 * MINUTE), 3.5);
  for (const bad of [undefined, null, NaN, -1, '3', Infinity]) {
    assert.equal(daily.read(bad, 3 * MINUTE), undefined, String(bad));
  }
  assert.equal(daily.read(4, NaN), undefined);
});

test('daily index: an index already in Gladys goes on from its value, never from 0', () => {
  const daily = fresh();
  assert.equal(daily.read(5, 0, { value: 1000 }), 1000);
  assert.equal(daily.read(6, MINUTE), 1001);
  assert.equal(fresh().read(5, 0, { value: 0 }), 5, 'a value of 0 is no reference');
});

test('daily index: a new day goes on from the index, never drops', () => {
  const daily = fresh();
  assert.equal(daily.read(15, 0), 15);
  // Midnight of the inverter: the counter starts again.
  assert.equal(r3(daily.read(0.02, MINUTE)), 15.02);
  assert.equal(r3(daily.read(3, 2 * HOUR)), 18);
  // The next midnight, 24 h later.
  assert.equal(r3(daily.read(20, 24 * HOUR - MINUTE)), 35);
  assert.equal(r3(daily.read(0, 24 * HOUR)), 35);
  assert.equal(r3(daily.read(1, 25 * HOUR)), 36);
});

test('daily index: a drop that is no new day gives no index; back above, it goes on', () => {
  const daily = fresh();
  daily.read(12, 0);
  // 11 is not "near 0 of a new day"... but 36 kWh is the bound: a drop to
  // 11 with no new day yet IS a new day. With one 2 h ago, it is a glitch.
  daily.read(0.5, 2 * HOUR); // a new day (the first one)
  daily.read(8, 4 * HOUR);
  assert.equal(daily.read(7, 5 * HOUR), undefined, 'a drop 3 h after a new day: a glitch');
  assert.equal(daily.read(7.5, 6 * HOUR), undefined, 'still below the last value taken');
  assert.equal(r3(daily.read(8.5, 7 * HOUR)), 20.5, 'back above: 12 + 8.5');
  // A drop above the bound (36 kWh) is never a new day.
  const big = fresh();
  big.read(100, 0);
  assert.equal(big.read(50, 13 * HOUR), undefined);
});

test('daily index: a glitch to 0 contradicted at once is undone (no fictive rise)', () => {
  const daily = fresh();
  daily.read(12, 0);
  // At 13:00 the counter reads 0 once (no new day before: taken as one)...
  assert.equal(daily.read(0, 13 * HOUR), 12);
  // ...and 12.01 a minute later: impossible from 0 in a minute, undone.
  assert.equal(r3(daily.read(12.01, 13 * HOUR + MINUTE)), 12.01);
  assert.equal(r3(daily.read(12.5, 14 * HOUR)), 12.5);
  // The new day after the undo is free again (the reset date was restored).
  assert.equal(r3(daily.read(0.1, 24 * HOUR)), 12.6);
});

test('daily index: a real new day is never undone by a fast morning', () => {
  const daily = fresh();
  daily.read(15, 0);
  assert.equal(daily.read(0.1, MINUTE), 15.1);
  // 3 kWh in an hour: below the old level, a normal rise.
  assert.equal(r3(daily.read(3, HOUR)), 18);
  // Even back at the old level, slowly enough (36 kW for an hour + 0.5).
  const second = fresh();
  second.read(10, 0);
  second.read(0.1, MINUTE);
  assert.equal(r3(second.read(10.2, MINUTE + 59 * MINUTE)), 20.2, 'possible in 59 min at 36 kW');
});

test('daily index: hours without reads across midnight count less, never more', () => {
  const daily = fresh();
  daily.read(14, 0); // 23:00
  // Read again at 01:00: what came between 23:00 and midnight is lost.
  assert.equal(r3(daily.read(0.5, 2 * HOUR)), 14.5);
});

test('daily index: its state survives a restart through JSON', () => {
  const daily = fresh();
  daily.read(15, 0);
  daily.read(0.1, MINUTE);
  const saved = JSON.parse(JSON.stringify(daily.state()));
  const again = fresh(saved);
  assert.equal(r3(again.read(0.2, 2 * MINUTE)), 15.2);
  assert.equal(fresh({ offset: 'x' }).state(), null, 'a broken state is dropped');
  assert.equal(fresh().state(), null);
});

test('daily index and guard: three days of a real inverter, every value taken, no jump', () => {
  const daily = fresh();
  const guard = new IndexGuard(undefined, undefined, 0, { maxKw: 36, slackKwh: 0.5 });
  let at = 0;
  let total = 0;
  for (let day = 0; day < 3; day += 1) {
    for (let minute = 0; minute < 24 * 60; minute += 1) {
      const today = minute * 0.01; // 0.6 kWh an hour
      const index = daily.read(today, at, guard.last);
      if (index !== undefined && Math.round(index * 1000) / 1000 > 0) {
        assert.equal(
          guard.accept(Math.round(index * 1000) / 1000, at),
          true,
          `day ${day} ${minute}`,
        );
        total = index;
      }
      at += MINUTE;
    }
  }
  // Every day 14.39 kWh (the last minute before midnight is not counted).
  assert.equal(Math.round(total * 100) / 100, 43.17);
  assert.equal(guard.held, undefined);
});
