# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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

[Unreleased]: https://github.com/LM1LC3N7/gladys-imeon/commits/main
