# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.2] - 2026-10-22

### Fixed

- "Accept the held index" no longer accepts a DROP of an index built from the
  counter of the day: taking it counted the climb back twice. A drop is never
  a new meter here; it corrects itself and only the new energy is counted.
  The status says "nothing to do", the button answers "never accepted"; jumps
  are still accepted as before.
- The counter of the day before shown again by the inverter (after a reboot,
  or after midnight before its new day) is kept out of the index when it is
  within 0.1 kWh of the last value read or of the day before (it was counted
  as a rise of the day), and the counter of the day is not sent for that read
  (the status says so). The mark of the day before holds for the night of the
  new day, also when the inverter resets a little before our midnight. After
  the update, this protection starts at the first midnight (or at once within
  3 h of a new day). A small grid day (0.1 kWh or less) still sees the reset
  of the next day, and a slow rise of today's counter up to the value of the
  day before is never kept out (only a jump to it is); left: the day before
  shown again less than 0.1 kWh above today's counter, 0.1 kWh at most.
- The margin of the solar production index follows the installation: 1.5 ×
  the highest solar power of the last 30 days once 7 days are known (2 to
  36 kW), instead of 36 kW, so a false counter after a silence is no longer
  taken on a small installation. A counter of the day updated by steps is
  judged on the time since its previous step (steps of up to 20 min, within
  36 kW, as before the learned margin).

## [0.1.1] - 2026-10-20

### Added

- Local reading of IMEON hybrid inverters through the API of OS One (the "API
  module"), as the imeon_inverter_api library of Imeon Energy does: login with
  the user name and password of the local interface, the `/data` page (serial,
  model, limits) at start then hourly, and the `/api` pages once a minute,
  1.2 s apart. Read-only: no setting of the inverter is ever changed.
- One device per inverter, by its serial: solar production (total and per
  string), battery (charge, power, status), grid (power taken and injected,
  flow, voltage, current, frequency), house consumption, AC input and output,
  energy meter, temperatures, self-consumption and self-sufficiency, inverter
  state and mode, the counters of the day and the forecasts as plain sensors.
  L2 and L3 only once the inverter shows three phases.
- Two energy indexes for the Gladys energy monitoring, built from the counters
  of the day of the inverter (it gives no lifetime counter): the grid
  consumption index (`energy-sensor` / `index`) and the solar production index
  (`energy-production-sensor` / `index`, with its 30-minute production). A
  drop is a new day only around the local midnight (or after a cut across
  it); any other drop, and any rise faster than 36 kW, gives no index; every
  doubt counts less, never more. Both pass the guard of gladys-p1-monitor
  (never 0, jumps and drops held until the "Accept the held index" button,
  bounded to the value shown).
- Nothing is published before the `/data` page of the current session gave
  the serial: another address or another inverter never writes into the
  device of the previous one.
- Refused credentials stop the reads (kept in `/data`), one new try after 1 h,
  then 2 h, up to 24 h; a save of the configuration starts again. HTTP 429 and
  5xx pause the reads from 1 minute to 6 hours (kept in `/data`). An
  unreachable inverter is tried again after 1 minute, doubled up to 15
  minutes. A session that ended is opened again once per read, never in a
  loop.
- A secondary page failing never holds back the main values.
- Each reconnection to Gladys publishes the device, every value and the status
  again; the device published again never loses a feature of the created one.
- "Test the connection" and "Accept the held index" buttons.
- Documentation in English and French; `LICENSE` (Apache-2.0) and
  `THIRD_PARTY_NOTICES.md` (Apache-2.0 notice of imeon_inverter_api), shipped
  in the image.

[Unreleased]: https://github.com/LM1LC3N7/gladys-imeon/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-imeon/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-imeon/releases/tag/v0.1.1
