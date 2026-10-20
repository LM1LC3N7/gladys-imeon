# IMEON for Gladys Assistant

**Unofficial** integration, not affiliated with Imeon Energy. It reads your
IMEON hybrid inverter (IMEON 3.6, 9.12, 3-25…) on your local network, through
the local API of OS One, without any cloud, once a minute. **Read-only**: it
never changes a setting of the inverter (mode, battery charge, injection,
relay).

**Never tested with a real IMEON inverter**: the integration was written from
the official library of Imeon Energy (imeon_inverter_api) and the Home
Assistant integration that uses it. Your feedback is welcome.

## Requirements

- An IMEON inverter with OS One, reachable on your local network (a fixed IP
  address in your router is advised).
- The **API module** turned on in the inverter (without it, the integration
  says "not an IMEON answer").
- The user name and password of the local interface of the inverter (often
  `user@local`). A user account is enough: the integration only reads.

## Setup

1. In Gladys, install the IMEON integration from the catalog.
2. Enter the **address** of the inverter (e.g. `192.168.1.50`), the **user
   name** and the **password**. The password is kept by Gladys in its
   database, never shown again, sent only to the inverter on your network.
3. Click **Test the connection**: the model and serial of the inverter are
   shown.
4. In the **Discover** tab, create the "IMEON …" device. Its values come at
   once, then every minute.

## What you get

- **Solar**: total production (`energy-production-sensor`, W), per string,
  share used in the house, share injected.
- **Battery**: charge (%), power, status (1 = charging, 2 = discharging, 3 =
  charged), stored and consumed powers.
- **Grid**: power taken (`energy-sensor`, W, read by the energy contracts),
  power injected, flow, voltage and current per phase, frequency.
- **House**: consumption (W), AC input and output, energy meter, inverter
  temperatures, self-consumption and self-sufficiency over 24 h, inverter
  state and mode (read-only), charging current and injection power limits.
- **Counters of the day** (kWh): solar production, taken from and injected
  into the grid, house consumption, stored in and taken from the battery,
  forecasts left. These are plain sensors: they start again from 0 each night
  and are never counted by the energy monitoring.
- **Two energy indexes** for the Gladys energy monitoring: the **grid
  consumption** index (the core derives the consumption and its cost) and the
  **solar production** index (the core derives the production per half
  hour).

Phases L2 and L3 only show once the inverter shows them (three-phase
inverter).

## The energy indexes

The local API of the inverter only gives **counters of the day**, started
again from 0 at midnight, and no lifetime counter. The Gladys energy
monitoring needs a cumulative index. So the integration builds it: index =
sum of the days ended + counter of the day.

- When the counter of the day starts again from nearly 0 (36 kWh at most), at
  least 12 h after the previous time, it is a new day: the index goes on
  without dropping. What the inverter counted between the last read and its
  midnight (a minute at most) is lost: a little less is counted, never more.
- Any other drop of the counter is a glitch: no index until the counter is
  back above its last value (the status says so).
- If the counter falls to 0 and comes back to its level at once (faster than
  possible), the "new day" is undone.
- If the integration is stopped for hours around midnight, the energy of
  those hours is not counted.

Each index then passes the **guard** taken from the P1 Monitor integration:
never 0; a plausible rise (at most 36 kW on average since the last value,
plus 0.5 kWh) goes through; a drop or a jump is **held** (the last accepted
value is sent again), shown in the status of the integration and kept across
restarts. Only the **Accept the held index** button takes it, and only for the
value shown (plus what may have come since): a jump is then counted at once, a
drop counts nothing. Saving the configuration never accepts anything.

If you delete and create the device again, its indexes start from scratch.

## Errors and pauses

- **User name or password refused**: the reads stop (kept across restarts),
  one new try after 1 h, then 2 h… up to 24 h. Correct them and save the
  configuration to start again at once. The test button never forces a try
  during this stop.
- **HTTP 429 or 5xx**: a pause from 1 minute to 6 hours (kept across
  restarts), never a read before its end.
- **Unreachable inverter**: new try after 1 minute, then doubled up to 15
  minutes.
- **Session ended**: the integration logs in again once per read, never in a
  loop.
- A secondary page (temperatures, forecast, state…) that does not answer never
  holds back the other values.

## Known limits

- Never tested with a real IMEON inverter: the names of the fields and their
  units come from the library and the Home Assistant integration.
- Read-only in v0.1: no change of mode, grid charge, night discharge,
  injection or relay.
- The timeline messages of the inverter are not read in v0.1.
- One inverter per integration.

## Data and privacy

Everything stays on your local network: the integration only talks to the
inverter. The `/data` folder of the integration only keeps the serial, the
state of the indexes and guards, and the pauses running: never the password
nor the session cookie.
