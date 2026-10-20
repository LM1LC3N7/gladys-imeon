// -----------------------------------------------------------------------------
// Constants shared by the integration. Every key stored by Gladys (actions,
// manifest keys, feature keys in src/devices.js) is forever: never rename one.
// -----------------------------------------------------------------------------

export const ACTIONS = { TEST: 'test_connection', ACCEPT_HELD: 'accept_held_index' };

/**
 * The external id of the device: `inverter:<serial>`, the serial the inverter
 * gives in its `/data` page: a new IP address of the same inverter keeps its
 * device and history.
 */
export const EXTERNAL_ID_TYPE = 'inverter';

// --- The local HTTP API of the inverter (as imeon_inverter_api reads it) ---------
export const PATHS = {
  LOGIN: '/login',
  /** The instant data: serial, model, software, limits (read at start, then hourly). */
  DATA: '/data',
};

/**
 * The pages read at each poll (`/api/<name>`), with the query the library
 * sends (`time=minute`, `threephase=true` for grid and output). `main`: the
 * page carries the main values; a secondary page failing never holds them back.
 */
export const PAGES = [
  { name: 'battery', path: '/api/battery', query: { time: 'minute' }, main: true },
  { name: 'grid', path: '/api/grid', query: { time: 'minute', threephase: 'true' }, main: true },
  { name: 'pv', path: '/api/pv', query: { time: 'minute' }, main: true },
  { name: 'energy', path: '/api/energy', query: { time: 'minute' }, main: true },
  { name: 'monitoringMinute', path: '/api/monitor', query: { time: 'minute' }, main: true },
  { name: 'input', path: '/api/input', query: { time: 'minute' }, main: false },
  {
    name: 'output',
    path: '/api/output',
    query: { time: 'minute', threephase: 'true' },
    main: false,
  },
  { name: 'meter', path: '/api/em', query: { time: 'minute' }, main: false },
  { name: 'temp', path: '/api/temp', query: { time: 'minute' }, main: false },
  { name: 'forecast', path: '/api/forecast', query: { time: 'minute' }, main: false },
  { name: 'monitoring', path: '/api/monitor', query: { time: 'hour' }, main: false },
  { name: 'manager', path: '/api/manager', query: {}, main: false },
];

export const HTTP_TIMEOUT = 15_000;
/** The pages are a few KiB: more is not an IMEON answer. */
export const MAX_BODY_BYTES = 256 * 1024;
/** The inverter is slow: the library waits 1.2 s between two requests (its rate limiter). */
export const REQUEST_SPACING = 1_200;

// --- Schedule ------------------------------------------------------------------------
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** One poll a minute, as the Home Assistant integration (13 requests, ~16 s with the spacing). */
export const POLL_INTERVAL = MINUTE;
/** The `/data` page (serial, model, limits): read at start, then every hour. */
export const DATA_INTERVAL = HOUR;
/** An unreachable inverter: tries after 1 min (never faster than a poll), doubled up to 15 min. */
export const RETRY_MIN = MINUTE;
export const RETRY_MAX = 15 * MINUTE;
/** HTTP 429 or 5xx: a pause from 60 s to 6 h, kept in /data. */
export const PAUSE_MIN = MINUTE;
export const PAUSE_MAX = 6 * HOUR;
/** Credentials refused: stopped, kept in /data; new tries after 1 h, doubled up to 24 h. */
export const AUTH_RETRY_MIN = HOUR;
export const AUTH_RETRY_MAX = 24 * HOUR;
/** Unchanged values are sent again after this delay (publishChangedStates heartbeat). */
export const STATE_HEARTBEAT = 10 * MINUTE;
/** The test button answers within this delay. */
export const TEST_ANSWER_WITHIN = 25 * SECOND;

// --- Energy indexes (built from the counters of the day, see src/daily.js) ----------
/**
 * The guard of an index (src/guard.js): a home connection never draws, and an
 * IMEON installation never produces, more than this on average between two
 * reads (36 kVA is the largest residential connection in France).
 */
export const INDEX_MAX_KW = 36;
/** kWh always accepted on top of INDEX_MAX_KW × hours (rounding, a late read). */
export const INDEX_SLACK_KWH = 0.5;
/**
 * A counter of the day back to at most this (kWh) is a new day: the inverter
 * started counting again at its midnight.
 */
export const DAY_RESET_MAX_KWH = INDEX_MAX_KW;
/**
 * A drop is a new day only from 1 h before to 3 h after the local midnight
 * (the inverter's clock may be a little off), once a night, or after a cut
 * across midnight.
 */
export const DAY_WINDOW_BEFORE = HOUR;
export const DAY_WINDOW_AFTER = 3 * HOUR;
/** A new day contradicted within this delay (too fast, or the old value back) is undone. */
export const DAY_RESET_UNDO_WITHIN = 3 * HOUR;
/** The local midnight: the TZ of the container, else the inverters' home market. */
export const TIME_ZONE = process.env.TZ || 'Europe/Paris';

/** A power above this (W) is a glitch. */
export const POWER_MAX = 100_000;
/** A counter of the day above this (kWh) is a glitch. */
export const DAY_ENERGY_MAX = 2_000;
