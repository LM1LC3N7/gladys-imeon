# TODO

## Before announcing

- [ ] Test on a real Gladys 5.2+ with a real IMEON inverter (ideally a
      single-phase 3.6 or 9.12 and a three-phase 3-25, with and without
      battery): test button, device creation, the consumption and production
      the core derives from the indexes, a midnight of the inverter.
- [ ] Test the Docker image (no Docker on the development PC yet).
- [ ] Run the store validator (`npx github:GladysAssistant/integration-store .`):
      the development agent could not run it.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).

## To confirm on a real inverter (built without one)

- [ ] The login form (`do_login=True`, `email`, `passwd`) and its answer
      `{ accessGranted }`; the session cookie and how long it lasts; whether
      the login page is what an ended session answers (the library's test).
- [ ] The `{ "result": "<JSON text>" }` envelope of every `/api` page with
      `time=minute`: a flat object of the current values (as Home Assistant
      reads it), not a time series.
- [ ] The units: W for the powers, Wh for `/api/energy` and `/api/forecast`
      (Home Assistant declares Wh), W for `/api/monitor?time=minute` (the
      values of its fixture look small for W).
- [ ] `/api/energy`: counters of the day ("Today ..." in Home Assistant),
      back to 0 at the inverter's midnight; whether a reboot of the inverter
      resets them during the day.
- [ ] `/data`: `serial`, `type`, `software`, `max_ac_charging_current`,
      `injection_power`.
- [ ] The values of `battery.status`, `manager.inverter_state` and
      `manager.inverter_mode` (as Home Assistant lists them).
- [ ] Whether a single-phase inverter answers `threephase=true` with L2/L3 at
      0 (only then are L2/L3 hidden).

## Decisions

- **Versions**: 0.1.0 set once by hand when leaving the template (package,
  lock file, manifest, image tag `ghcr.io/lm1lc3n7/gladys-imeon:0.1.0`), as for
  the sibling integrations; the Release workflow owns them from now on (the
  first patch release gives 0.1.1).
- **Reused project**: imeon_inverter_api (Imeon Energy, Apache-2.0, 0.4.3,
  `main` at commit 59a498e), cloned read-only in `_ref/imeon-inverter-api`,
  ported to JavaScript: the login, the pages, their query, the envelope, the
  "not JSON = session ended" test, the 1.2 s spacing. The units, the meaning
  of the fields and the enum values come from the Home Assistant integration
  (Apache-2.0, `_ref/ha-imeon`). The SDK stays the only runtime dependency.
  The guard, the store and the address parser come from gladys-p1-monitor;
  the production index with its 30-minute production from gladys-apsystems.
  The template's demo files were moved out of the repository (to
  `_ref/lot10/imeon-template-leftovers`, deleting them was refused in this
  session).
- **Read-only (v1)**: no `onSetValue`, no select for the inverter mode, no
  battery mode change; the mode and limits are read-only sensors. Nothing of
  the library's settings endpoint is ported.
- **External id**: `inverter:<serial>` (the `/data` serial, checked
  `[A-Za-z0-9_-]{4,40}`), one inverter per integration; the address is only
  a param. The serial is kept in `/data` so that the created device gets its
  values even when `/data` fails after a restart.
- **Energy indexes (lot 6 rules)**: the inverter gives no lifetime counter,
  only counters of the day. Published as an index, a counter of the day would
  drop to 0 each night (held by the guard forever). So `src/daily.js` builds
  a cumulative index: `offset + today`, `offset` the sum of the days ended:
  - review 1, B1 (a): a drop (to at most 36 kWh) is a new day only from 1 h
    before to 3 h after the local midnight (`TZ` of the container, else
    Europe/Paris), once a night, or when the last value taken is from an
    earlier local day (a cut across midnight); any other drop gives no index,
    nothing moves, until the counter is back above the last value taken
    (scenarios S1b, S1d, S2 of the review: counted once);
  - review 1, B1 (b): a rise is taken only when plausible since the last
    value taken (`readAt`, moved by every value taken, an equal one
    included): at most 36 kW × the time + 0.5 kWh. A larger rise is a jump:
    no index, the reference does not move, `readAt` moves (never confirmed
    by time). Within 3 h of a new day, a jump undoes it, and so does a
    return straight from the new day's value to the exact value of the day
    before (a frozen counter after an outage); S1, S1c, S1e counted once;
  - review 1, I2: a read before `readAt` (a wall clock set back) gives no
    index and moves nothing; a date of /data in the future is brought back
    to the time of loading (S4);
  - always on the side of counting less: the time between the last read and
    the inverter's midnight, hours without reads around midnight, a glitch, a
    real mid-day reset of the counter are lost;
  - approval R1: an undo for a too-fast return (or an exact return) uses the
    night: a value under the day before gives no index until the counter
    passes it or the local day changes (the real midnight stays open);
  - approval R2: a second drop while the first new day may be undone undoes
    it first (night free again), then is judged alone: one new day, never
    two (a stale low value before the inverter's midnight);
  - approval R3: a new day taken with no gap before it (≤ 3 polls), then a
    value read after a gap (> 3 polls) back to at least half the day before:
    undone (≥ the day before: taken; under: no index). A cut across midnight
    is not touched;
  - a new day keeps the index exactly where it was: its first value is not
    counted (a stale low value never is; less after a real midnight);
  - risk left near midnight (documented): a glitch to near 0 right after a
    gap in the reads, then back after another gap, slowly enough for 36 kW:
    taken as a new day, at most the value it came back with counted too
    much. Several faults in a row;
  - the first value goes on from the index Gladys already holds (never from
    0); its state is kept in `/data` with the guard, written BEFORE the
    values are published (review 1, M5).
    The result goes through the IndexGuard of gladys-p1-monitor, taken as it
    is, with `maxKw` (36 kW, the largest French residential connection) and
    `slackKwh` (0.5) as parameters. `consumption_index` (grid consumed,
    `energy-sensor` / `index`) is billed by the core; `production_index` (PV,
    `energy-production-sensor` / `index`) with its `thirty-minutes-production`
    declared like gladys-apsystems. The injection, house, battery and forecast
    energies are plain sensors (`unknown` / `decimal`, "kWh, today" in the
    name). No `daily-consumption`, no `daily-production`, no
    `publishEnergyConsumption` (tested).
- **Powers**: `grid_power` (taken from the grid, `/api/monitor?time=minute`)
  is the only `energy-sensor` / `power`, `pv_power` (`/api/pv` total) the only
  `energy-production-sensor` / `power`; every other power is a plain sensor in
  W (signed ones from -100 kW to 100 kW). A negative value of a feature whose
  minimum is 0 is not sent.
- **Units**: only those of `DEVICE_FEATURE_UNITS_BY_CATEGORY`: W, V, A, kWh
  (energy-sensor), W, kWh (energy-production-sensor), % (battery), °C
  (device-temperature-sensor); Hz, %, A of a limit go in plain sensors with
  the unit in the name. Tested.
- **Enums** as integers with the meaning in the feature name: battery status
  (1-3), inverter state (0-4), inverter mode (1-4). The timeline messages are
  not read in v1.
- **Phases**: L2/L3 features once the grid or output shows a voltage on them;
  capabilities only grow, merged with the created device's features.
- **Pace**: one poll a minute (as Home Assistant), 12 `/api` pages 1.2 s
  apart (~15 s), `/data` at start then hourly. `publishChangedStates` with a
  10-minute heartbeat: at most ~70 states a minute, far below 300.
- **Credentials refused** (`accessGranted` not true, or 401/403 at login):
  stop kept in `/data` (`authStop { until, count }`, no secret), one try
  after 1 h, then doubled up to 24 h; a save of the form clears it; a
  reconnection to Gladys keeps it; the test button never forces a try during
  it.
- **Session**: an answer that is not JSON (or 401/403/3xx) on a page means
  the session ended: one new login per poll, at most; a second failure is a
  normal failure (retry after 1 min, doubled).
- **429 / 5xx**: pause `{ until, count, code, status }` in `/data`, from
  Retry-After or 1 min doubled, bounded 1 min – 6 h; the end read back from
  `/data` is capped at 6 h from the load.
- **Unreachable**: 1 min, doubled up to 15 min (never faster than a poll);
  kept across reconnections, reset by a save of the form or a good test.
- **Secondary pages** (input, output, meter, temp, forecast, monitor hour,
  manager, `/data` once the serial is known): a failure is shown in the status
  and never holds back the rest; without any main page (battery, grid, pv,
  energy, monitor minute) the read fails.
- **Hostile answers**: bodies bounded to 256 KiB, no redirect followed,
  strict numbers (`num`), own keys only (no prototype), ranges checked, the
  `result` JSON text parsed once, cookies checked before being sent back.
- **No custom User-Agent**, no imitation: Node's own fetch, the form of the
  library.
- **Gladys version**: `>=5.2.0`, like the other energy integrations.

- **Serial confirmed per session** (review 1, I1): a session is one
  inverter. After every login (another address, a DHCP swap, a reboot), the
  `/data` page is read again and nothing is published until it gave the
  serial in that session (`confirmed = { client, session }`); a session
  opened during the pages reads `/data` again before publishing. Another
  address does not publish the old device at start (only on the very first
  start, from the serial in `/data`).
- **Pace of reads** (review 1, M3): no read less than a poll after the last
  one, except the timer, a save of the form and a device creation; a
  reconnection, an update, a scan or an acceptance waits for the next poll.
- **/data writes** (review 1, M4): the saves are queued, never two on the
  same temporary file.

## Ideas

- The timeline messages (`/api/timeline`) as a scene trigger.
- The smart load relay state (`/api/smartload`).
- Commands (inverter mode, grid charge, night discharge, injection) behind
  options disabled by default, once tested on a real inverter.
