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
// where `offset` is the sum of the days already ended. The rules, all on the
// side of counting LESS, never more:
// - a counter that rises (or stays) is the same day: the index follows it;
// - a counter that drops to at most `resetMaxKwh`, at least `minGapMs` after
//   the last new day (or with none yet), is a new day: the last value of the
//   day ended goes into `offset`, so the index goes on from where it was,
//   without any drop. What the inverter counted between our last read and
//   its midnight (up to a minute) is lost: a little less is counted;
// - any other drop is a glitch: no index for that read (nothing published),
//   the counter must come back above the last value taken to give one again
//   (what was counted meanwhile is lost: less, never more);
// - a new day contradicted at once (within `undoWithinMs`, the counter back
//   at or above the old level faster than `maxKw` allows from the new day's
//   value) was a glitch to near 0: undone, the offset as before;
// - the inverter's midnight is never guessed (its clock, its time zone): only
//   its counter dropping says a day ended.
//
// Whatever comes out still passes the IndexGuard, which holds any jump or
// drop: the two together never let a fictive rise reach the core.
// -----------------------------------------------------------------------------

const HOUR = 3_600_000;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

function validState(saved) {
  if (!saved || !finite(saved.offset) || !finite(saved.today) || saved.today < 0) {
    return undefined;
  }
  const undo = saved.undo;
  return {
    offset: saved.offset,
    today: saved.today,
    resetAt: finite(saved.resetAt) ? saved.resetAt : null,
    undo:
      undo && finite(undo.prevToday) && finite(undo.at) && finite(undo.resetValue)
        ? {
            prevToday: undo.prevToday,
            at: undo.at,
            resetValue: undo.resetValue,
            prevResetAt: finite(undo.prevResetAt) ? undo.prevResetAt : null,
          }
        : null,
  };
}

export class DailyIndex {
  /**
   * `saved`: the state kept in /data (`state()`). `limits`: `{ resetMaxKwh,
   * minGapMs, undoWithinMs, maxKw, slackKwh }`.
   */
  constructor(saved, limits) {
    this.limits = limits;
    this.s = validState(saved);
  }

  /** What /data keeps. */
  state() {
    return this.s ? { ...this.s, undo: this.s.undo ? { ...this.s.undo } : null } : null;
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
      this.s = { offset: base, today, resetAt: null, undo: null };
      return base + today;
    }
    const { resetMaxKwh, minGapMs, undoWithinMs, maxKw, slackKwh } = this.limits;
    if (s.undo) {
      const since = at - s.undo.at;
      if (since < 0 || since > undoWithinMs) {
        s.undo = null;
      } else if (
        today >= s.undo.prevToday &&
        today - s.undo.resetValue > (maxKw * since) / HOUR + slackKwh
      ) {
        // The old level back too fast for a new day: it was a glitch, undone.
        s.offset -= s.undo.prevToday;
        s.resetAt = s.undo.prevResetAt;
        s.undo = null;
        s.today = today;
        return s.offset + today;
      }
    }
    if (today >= s.today) {
      s.today = today;
      return s.offset + today;
    }
    // A drop: a new day, or a glitch.
    const gapOk = s.resetAt === null || at < s.resetAt || at - s.resetAt >= minGapMs;
    if (today <= resetMaxKwh && gapOk) {
      s.undo = { prevToday: s.today, at, resetValue: today, prevResetAt: s.resetAt };
      s.offset += s.today;
      s.today = today;
      s.resetAt = at;
      return s.offset + today;
    }
    return undefined;
  }
}
