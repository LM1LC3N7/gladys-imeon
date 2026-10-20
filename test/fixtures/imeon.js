// -----------------------------------------------------------------------------
// Answers of an IMEON inverter, shaped after the Home Assistant test fixture
// (tests/components/imeon_inverter/fixtures/entity_data.json) and the
// envelope imeon_inverter_api reads (`{ "result": "<JSON text>" }`).
// -----------------------------------------------------------------------------

export const ADDRESS = '192.168.1.50';
export const SERIAL = '1234567890AB';
/** 2026-10-20 12:00:00 UTC. */
export const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
export const USERNAME = 'user@local';
export const PASSWORD = 'pa ss-w0rd';

export const DATA = {
  serial: SERIAL,
  type: '3-25',
  software: '1.8.1.0',
  max_ac_charging_current: 50,
  injection_power: 5000,
  enable_status: { discharge_night: '1', charge_bat_with_grid: '0' },
};

export const RESULTS = {
  battery: { power: 2500.0, soc: 78.0, status: 'charging', stored: 10200.0, consumed: 500.0 },
  grid: {
    current_l1: 12.5,
    current_l2: 10.8,
    current_l3: 11.2,
    frequency: 50.0,
    voltage_l1: 230.0,
    voltage_l2: 229.5,
    voltage_l3: 230.1,
  },
  pv: { consumed: 1500.0, injected: 800.0, power_1: 1200.0, power_2: 1300.0, power_total: 2500.0 },
  input: { power_l1: 1000.0, power_l2: 950.0, power_l3: 980.0, power_total: 2930.0 },
  output: {
    current_l1: 15.0,
    current_l2: 14.5,
    current_l3: 15.2,
    frequency: 49.9,
    power_l1: 1100.0,
    power_l2: 1080.0,
    power_l3: 1120.0,
    power_total: 3300.0,
    voltage_l1: 231.0,
    voltage_l2: 229.8,
    voltage_l3: 230.2,
  },
  em: { power: 2000.0 },
  temp: { air_temperature: 25.0, component_temperature: 45.5 },
  energy: {
    pv: 12000.0,
    grid_injected: 5000.0,
    grid_consumed: 6000.0,
    building_consumption: 15000.0,
    battery_stored: 8000.0,
    battery_consumed: 2000.0,
  },
  forecast: { cons_remaining_today: 3000.0, prod_remaining_today: 7000.0 },
  monitorHour: { self_produced: 2600.0, self_consumption: 85.0, self_sufficiency: 90.0 },
  monitorMinute: {
    building_consumption: 50.0,
    grid_consumption: 8.3,
    grid_injection: 11.7,
    grid_power_flow: -3.4,
    solar_production: 43.3,
  },
  manager: { inverter_state: 'grid_consumption', inverter_mode: 'smg' },
};

export const json = (body, { status = 200, headers = {} } = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** What the inverter answers when the session is over: its login page. */
export const loginPage = () =>
  new Response('<html><body>login</body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });

export const COOKIE = 'session=abc123';

/**
 * The routes of a working inverter. `results` overrides the page results
 * (by key of RESULTS), `session` checks the cookie (a call without it gets
 * the login page), `granted` is what the login answers.
 */
export function routes({ results = {}, data = DATA, granted = true } = {}) {
  const r = { ...RESULTS, ...results };
  const page = (key) => (call) =>
    call.headers.Cookie === COOKIE ? json({ result: JSON.stringify(r[key]) }) : loginPage();
  return {
    '/login': () =>
      json(
        { accessGranted: granted },
        granted ? { headers: { 'set-cookie': `${COOKIE}; Path=/` } } : {},
      ),
    '/data': (call) => (call.headers.Cookie === COOKIE ? json(data) : loginPage()),
    '/api/battery': page('battery'),
    '/api/grid': page('grid'),
    '/api/pv': page('pv'),
    '/api/input': page('input'),
    '/api/output': page('output'),
    '/api/em': page('em'),
    '/api/temp': page('temp'),
    '/api/energy': page('energy'),
    '/api/forecast': page('forecast'),
    '/api/monitor': (call) =>
      page(call.query.time === 'hour' ? 'monitorHour' : 'monitorMinute')(call),
    '/api/manager': page('manager'),
  };
}
