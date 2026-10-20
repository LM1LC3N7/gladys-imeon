# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

It reads an **IMEON hybrid inverter** through the local API of OS One over
plain HTTP: `POST /login` (session cookie), `GET /data` and the `/api/<page>`
pages. The login, the pages and the meaning of their fields are ported from
[imeon_inverter_api](https://github.com/Imeon-Inverters-for-Home-Assistant/inverter-api)
(Imeon Energy, Apache-2.0, see `THIRD_PARTY_NOTICES.md`). Unofficial: not
affiliated with Imeon Energy. **Read-only**: never `onSetValue`, never the
library's settings endpoint. Siblings: `gladys-p1-monitor` (the index guard),
`gladys-apsystems` (the production index and its 30-minute production).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/daily.test.js            # one file
node --test --test-name-pattern "guard"   # tests whose name matches
npm run audit                             # npm audit --omit=dev
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/app.js                        ImeonApp: polls, indexes, pauses and stops, buttons
src/imeon/client.js               the only HTTP access (login, session, bounded body, spacing)
src/imeon/model.js                the pages -> values, /data, capabilities (pure)
src/daily.js                      a cumulative index built from a counter of the day (pure)
src/guard.js                      plausibility of an energy index, from gladys-p1-monitor (pure)
src/store.js                      what /data keeps across restarts
src/devices.js                    the device, feature keys, states (pure)
src/config.js                     address, user name, password, normalized
src/constants.js                  pages, pacing, limits, manifest keys
src/i18n.js                       runtime texts (en/fr)
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys (integration-sdk/testing)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **Energy monitoring**: `consumption_index` (grid, `energy-sensor` /
  `index`) and `production_index` (solar, `energy-production-sensor` /
  `index`, with its `thirty-minutes-production` declared with UUID v5 ids)
  are the only indexes. They are built from the counters of the day by
  `src/daily.js` (a new day never drops them; any doubt counts less, never
  more) and pass `IndexGuard` (`src/guard.js`): never 0, a drop and a jump
  never confirmed by repetition nor by time, only by the `accept_held_index`
  action, bounded to the value shown. The counters of the day stay plain
  sensors: never an index, never `daily-consumption`, never
  `publishEnergyConsumption`.
- **Credentials**: the password lives in memory only; never in logs, `/data`,
  statuses or errors. Refused credentials stop the reads (kept in `/data`),
  retries 1 h → 24 h; a save of the form starts again. A session is opened
  again at most once per read. The password field is described as "kept by
  Gladys in its database, never shown again" (`test/encoding.test.js` checks
  that no text claims more).
- **Pauses**: 429/5xx pause from 1 min to 6 h, kept in `/data` (end capped
  when read back); never a read faster than the poll interval; a reconnection
  to Gladys clears neither a pause, a stop nor the client.
- **A secondary page never blocks the main data.**
- **Never a text of the inverter in a message**, never a URL in the logs:
  error messages use our own words and codes.
- **External ids are forever**: `inverter:<serial>`, the `FEATURE` keys of
  `src/devices.js`, the manifest keys. The device published again never loses
  a feature of the created one (`capabilitiesOfDevice`).
- **The container rootfs is read-only.** Write only under `/data`:
  `src/store.js` keeps `/data/imeon-state.json`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language.
  `test/manifest.test.js` ties the manifest to the code.
- **User-facing text** is bilingual (English and French): runtime messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync. Files are
  UTF-8 without BOM (`test/encoding.test.js`, sources included).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
