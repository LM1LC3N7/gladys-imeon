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

Rule: every doubt counts less, never more.

- A drop of the counter is a new day only around the local midnight (11 pm
  to 3 am, time zone `TZ` of the container, Europe/Paris by default), once a
  night, or when the last value taken is from an earlier day (a cut across
  midnight), and only down to 36 kWh at most. The index then stays exactly
  where it was: neither the first value of the new day nor what the inverter
  counted between the last read and its midnight is counted (a little less).
- A second drop while the first new day may still be undone (a stale low
  value just before midnight, then the real 0) undoes the first one: only one
  new day counts.
- Any other drop (a reboot, a lost clock, a glitch in the day) gives no index
  until the counter is back above its last value (the status says so). What
  is not back is not counted.
- A rise faster than 36 kW since the last value taken is a jump: never
  taken, never confirmed by time.
- A "new day" taken by mistake (a counter at 0 near midnight) is undone when,
  within 3 h, the counter comes back faster than possible, straight back to
  the exact value of the day before, or, read after a gap of more than 3
  minutes, back to at least half of the day before: a night reboot of the
  inverter (unread, 0 or a stale value, unread, back) is one incident. The
  only exception: a real cut across midnight (a drop read out of the midnight
  window, after 3 am, the local day changed and over 1 h without reads before
  the drop, measured on the monotonic clock: a wall clock jumping forward
  forges none). The night is then used: a value under
  the day before gives no index until the counter passes it or the local day
  changes.
- A wall clock set back gives no index until it has caught up with the last
  read.
- If the integration is stopped for hours around midnight, the energy of
  those hours is not counted.
- **Risk left near midnight**: after a new day still undoable, a value read
  after a gap but under half of the day before is taken as the consumption
  of the new day (at most that value counted too much); and after a real cut
  across midnight (a drop read after 3 am, over 1 h without reads), a return
  to the level of the day before after another gap, slow enough to be
  plausible, would count the day before a second time: it needs an inverter
  whose midnight is more than 3 h late, a cut, a counter near 0 and a return. The guard below still
  holds any jump of the index.

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
