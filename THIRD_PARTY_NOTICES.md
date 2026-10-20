# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the projects below, distributed under their own
license, also the Apache License 2.0 (its full text is the `LICENSE` file of
this repository).

## imeon_inverter_api (Imeon-Inverters-for-Home-Assistant/inverter-api)

<https://github.com/Imeon-Inverters-for-Home-Assistant/inverter-api>, by
Imeon Energy (the maker of the inverters), the library the IMEON integration
of Home Assistant uses. Version 0.4.3 (`pyproject.toml`), branch `main` at
commit 59a498e.

Ported to JavaScript in `src/imeon/client.js` and `src/imeon/model.js`: the
login of the local API (`POST /login` with `do_login`, `email`, `passwd`, the
`accessGranted` answer and the session cookie), the pages read (`/data` with
`serial`, `type`, `software`, `max_ac_charging_current`, `injection_power`;
`/api/battery`, `/api/grid`, `/api/pv`, `/api/input`, `/api/output`,
`/api/em`, `/api/temp`, `/api/energy`, `/api/forecast` with `time=minute`,
`threephase=true` for grid and output; `/api/monitor` with `time=hour` and
`time=minute`; `/api/manager`), their `{ "result": "<JSON text>" }` envelope,
the test that an answer which is not JSON means the session ended, and the
1.2 s between two requests. Changed here: read-only (the library's
`/api/set` is never called), a missing or odd value is never read as 0, a
session is opened again at most once per read, and the answers are bounded.

Its license notice, reproduced as it appears in its `LICENSE` file:

```
Copyright [2024] [Imeon Energy]

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

## Home Assistant, IMEON integration (home-assistant/core)

<https://github.com/home-assistant/core>, `homeassistant/components/imeon_inverter`
(branch `dev` at commit 9f26580), Apache License 2.0, Copyright the Home
Assistant authors. The keys of each page and their units (W, %, V, A, Hz,
°C, Wh), the meaning of the energies as counters of the day ("Today ..."),
the values of the battery status, inverter state and inverter mode, and the
test fixture shape (`tests/components/imeon_inverter/fixtures/entity_data.json`)
come from there; `test/fixtures/imeon.js` is shaped after that fixture.

## gladys-p1-monitor

The plausibility guard of the energy indexes (`src/guard.js`, its margin made
a parameter here), the `/data` store (`src/store.js`) and the address parser
(`src/config.js`) come from the sibling integration
[gladys-p1-monitor](https://github.com/LM1LC3N7/gladys-p1-monitor), same
project, Apache-2.0.
