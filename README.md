# gladys-imeon

Unofficial [Gladys Assistant](https://gladysassistant.com) integration for
**IMEON hybrid inverters** (Imeon Energy, Brest, France). It reads the inverter
through the local API of OS One, without any cloud, once a minute: solar
production, battery, grid, house consumption, temperatures, and two energy
indexes (grid consumption, solar production) for the Gladys energy monitoring.
**Read-only**: it never changes a setting of the inverter.

**Never tested with a real IMEON inverter.** Not affiliated with Imeon Energy.

- User guide: [English](docs/en.md), [français](docs/fr.md).
- Requirements: Gladys 5.2.0 or later, the "API module" of the inverter turned
  on, the user name and password of its local interface.

## How it works

- `POST /login`, then `/data` (serial, model, limits) at start and hourly, and
  twelve `/api` pages once a minute, 1.2 s apart, as the
  [imeon_inverter_api](https://github.com/Imeon-Inverters-for-Home-Assistant/inverter-api)
  library of Imeon Energy (Apache-2.0) does. Ported to JavaScript, see
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- The inverter gives its energies as counters of the day only: the two
  indexes are built from them (`src/daily.js`) and pass the guard of
  gladys-p1-monitor (`src/guard.js`): never 0, jumps and drops held; a jump is
  taken only by the "Accept the held index" button, a drop is never accepted
  (it corrects itself). The counter of the day before shown again is kept out
  (`src/dayBefore.js`), and the margin of the production index is learned from
  the solar power. Risks left and limits: see the docs.
- Refused credentials stop the reads (kept in `/data`, spaced retries), 429
  and 5xx pause them (kept in `/data`), a session is opened again at most once
  per read.

## Development

```bash
npm install
npm test
npm run lint
npm run format:check
npm run audit
```

See [CLAUDE.md](CLAUDE.md) for the project rules, [TODO.md](TODO.md) for the
decisions and what is left to check on a real inverter.

## License

Apache-2.0, see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
