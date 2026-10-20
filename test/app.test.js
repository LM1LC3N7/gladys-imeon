// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and a fake IMEON inverter.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ImeonApp } from '../src/app.js';
import { ACTIONS, AUTH_RETRY_MIN, PAUSE_MIN, POLL_INTERVAL, RETRY_MIN } from '../src/constants.js';
import { buildDevice } from '../src/devices.js';
import { ImeonClient } from '../src/imeon/client.js';
import { parseData } from '../src/imeon/model.js';
import { createMemoryStore } from '../src/store.js';
import { createFetch, refusedError } from './helpers/fakeFetch.js';
import { createFakeTimers } from './helpers/fakeTimers.js';
import {
  ADDRESS,
  COOKIE,
  DATA,
  NOW,
  PASSWORD,
  RESULTS,
  SERIAL,
  USERNAME,
  json,
  loginPage,
  routes as imeonRoutes,
} from './fixtures/imeon.js';

const SELECTOR = 'imeon';
const DEVICE = `ext:${SELECTOR}:inverter:${SERIAL}`;
const F = (key) => `${DEVICE}:${key}`;
const CONFIG = { address: ADDRESS, username: USERNAME, password: PASSWORD };
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function createLogger() {
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  return { lines, info: log, warn: log, error: log, debug: log };
}

/** The device as the user created it from the discovered one. */
function created({ index } = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR });
  const device = buildDevice(gladys, parseData(DATA), { threePhase: true }, ADDRESS);
  if (index) {
    const feature = device.features.find((f) => f.external_id === F('consumption_index'));
    feature.last_value = index.value;
    feature.last_value_changed = new Date(index.at).toISOString();
  }
  return device;
}

async function setup({
  config = CONFIG,
  routes = imeonRoutes(),
  devices = [],
  store = createMemoryStore(),
  now = NOW,
} = {}) {
  const fake = createFetch(routes);
  const gladys = createFakeGladys({ selector: SELECTOR, config, devices });
  await gladys.connect();
  const timers = createFakeTimers();
  const clock = { now };
  const logger = createLogger();
  const app = new ImeonApp({
    gladys,
    logger,
    now: () => clock.now,
    monotonic: () => clock.now,
    timers,
    store,
    clientFactory: (options) => new ImeonClient({ ...options, fetchImpl: fake.fetch, spacing: 0 }),
  });
  gladys.onDeviceCreated((device) => app.onDeviceCreated(device));
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  gladys.onAction(ACTIONS.ACCEPT_HELD, () => app.acceptHeldIndex());
  /** The next poll (or `ms` later). */
  const tick = async (ms = POLL_INTERVAL) => {
    clock.now += ms;
    await timers.runIntervals();
  };
  return { app, gladys, timers, clock, logger, fake, tick, store };
}

const status = (gladys) => gladys.fake.connectionStatus;
const calls = (fake, path) => fake.calls.filter((c) => c.path === path).length;
const last = (gladys, key) => gladys.fake.lastState(F(key));

/** A route of `/api/energy` with these counters of the day (Wh). */
const energy = (r, values) => {
  r['/api/energy'] = (call) =>
    call.headers.Cookie === COOKIE
      ? json({ result: JSON.stringify({ ...RESULTS.energy, ...values }) })
      : loginPage();
};

test('an incomplete or wrong configuration: the status says so, nothing is called', async () => {
  for (const [config, pattern] of [
    [{}, /Saisissez l’adresse/],
    [{ address: ADDRESS, username: USERNAME }, /Saisissez l’adresse/],
    [{ ...CONFIG, address: 'http://u:p@1.2.3.4' }, /pas valide/],
  ]) {
    const { app, gladys, timers, fake } = await setup({ config });
    await app.start(config);
    await app.idle();
    assert.equal(status(gladys).connected, false);
    assert.match(status(gladys).message.fr, pattern);
    assert.equal(fake.calls.length, 0);
    assert.equal(timers.pending.size, 0);
    assert.match(String((await gladys.fake.action(ACTIONS.TEST)).data.message.fr), pattern);
  }
});

test('the inverter is discovered by its serial; no value before its device is created', async () => {
  const { app, gladys, store } = await setup();
  await app.start(CONFIG);
  await app.idle();
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, DEVICE);
  assert.equal(device.name, `IMEON 3-25 ${SERIAL}`);
  assert.ok(device.features.some((f) => f.external_id === F('grid_voltage_l3')));
  assert.equal(gladys.fake.states.length, 0);
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.fr, /Découverte/);
  assert.equal(store.data.serial, SERIAL);
});

test('a created device gets its values and its two indexes, never through the consumption endpoint', async () => {
  const r = imeonRoutes();
  const { app, gladys, tick, fake } = await setup({ routes: r, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(last(gladys, 'battery_soc'), 78);
  assert.equal(last(gladys, 'pv_power'), 2500);
  assert.equal(last(gladys, 'grid_power'), 8);
  assert.equal(last(gladys, 'grid_voltage_l2'), 229.5);
  assert.equal(last(gladys, 'energy_pv_today'), 12);
  assert.equal(last(gladys, 'consumption_index'), 6);
  assert.equal(last(gladys, 'production_index'), 12);
  assert.equal(last(gladys, 'inverter_mode'), 1);
  assert.equal(last(gladys, 'injection_power_limit'), 5000);
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.en, /Connected to the IMEON inverter/);
  // The day goes on, then the inverter's midnight: the indexes never drop.
  energy(r, { grid_consumed: 6500, pv: 12500 });
  await tick();
  assert.equal(last(gladys, 'consumption_index'), 6.5);
  energy(r, { grid_consumed: 20, pv: 0 });
  await tick(12 * HOUR);
  assert.equal(last(gladys, 'consumption_index'), 6.52);
  assert.equal(last(gladys, 'production_index'), 12.5);
  assert.equal(last(gladys, 'energy_grid_consumed_today'), 0.02);
  assert.equal(gladys.fake.publishedEnergyConsumption.length, 0);
  // Read-only: only the login and reads, never /api/set.
  assert.ok(fake.calls.every((c) => c.path === '/login' || c.init.method === 'GET'));
  assert.equal(calls(fake, '/login'), 1, 'one session for every read');
  assert.equal(calls(fake, '/data'), 2, 'the /data page at start, then hourly (12 h later)');
});

test('a session that ended is opened again once per read, never in a loop', async () => {
  const r = imeonRoutes();
  const { app, gladys, tick, fake } = await setup({ routes: r, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  // The inverter drops the session once: one new login, the values go on.
  let dropped = false;
  const battery = r['/api/battery'];
  r['/api/battery'] = (call) => {
    if (!dropped) {
      dropped = true;
      return loginPage();
    }
    return battery(call);
  };
  await tick();
  assert.equal(calls(fake, '/login'), 2);
  assert.equal(status(gladys).connected, true);
  // A session that never holds: one new login in this read, then a failure.
  r['/api/battery'] = () => loginPage();
  await tick();
  assert.equal(calls(fake, '/login'), 3);
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.en, /session/);
});

test('refused credentials: stopped, kept in /data, one try an hour later, a save starts again', async () => {
  const store = createMemoryStore();
  const r = imeonRoutes({ granted: false });
  const { app, gladys, tick, fake, logger, clock } = await setup({ routes: r, store });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(calls(fake, '/login'), 1);
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.fr, /refusé l’identifiant ou le mot de passe/);
  assert.equal(store.data.authStop.count, 1);
  // Never more often: 59 minutes of polls, no new login.
  for (let i = 0; i < 59; i += 1) await tick();
  assert.equal(calls(fake, '/login'), 1);
  // A restart (a reconnection to Gladys) keeps the stop.
  const again = await setup({ routes: r, store, now: clock.now });
  await again.app.start(CONFIG);
  await again.app.idle();
  assert.equal(again.fake.calls.length, 0);
  assert.match(status(again.gladys).message.fr, /refusé/);
  assert.match(String((await again.gladys.fake.action(ACTIONS.TEST)).data.message.fr), /refusé/);
  assert.equal(again.fake.calls.length, 0, 'the test button never forces a try');
  // After the hour: one try, refused again, the next one 2 h later.
  await tick(2 * MINUTE);
  assert.equal(calls(fake, '/login'), 2);
  assert.equal(store.data.authStop.count, 2);
  assert.ok(store.data.authStop.until >= clock.now + 2 * HOUR - 1);
  // A save of the form with the right password: at once.
  r['/login'] = imeonRoutes()['/login'];
  await app.start(CONFIG, { fresh: true });
  await app.idle();
  assert.equal(status(gladys).connected, true);
  assert.equal(store.data.authStop, null);
  // The password is nowhere: logs, /data, statuses.
  const everything = JSON.stringify([logger.lines, store.data, gladys.fake.connectionStatus]);
  assert.ok(!everything.includes(PASSWORD));
  assert.ok(!everything.includes(COOKIE));
  assert.ok(AUTH_RETRY_MIN === HOUR);
});

test('429 and 5xx: a bounded pause kept in /data, never a read before its end', async () => {
  const store = createMemoryStore();
  const r = imeonRoutes();
  r['/data'] = () => json({}, { status: 429, headers: { 'retry-after': '1' } });
  const { app, gladys, tick, fake, clock } = await setup({ routes: r, store });
  await app.start(CONFIG);
  await app.idle();
  assert.match(status(gladys).message.fr, /demande d’attendre/);
  // Retry-After of 1 s: the pause is never shorter than a poll.
  assert.equal(store.data.pause.until, clock.now + PAUSE_MIN);
  const before = fake.calls.length;
  await tick(30_000);
  assert.equal(fake.calls.length, before);
  // A restart keeps the pause; a pause from /data far in the future is capped.
  const far = createMemoryStore({
    pause: { until: clock.now + 1000 * HOUR, count: 3, code: 'server' },
  });
  const again = await setup({ routes: r, store: far, now: clock.now });
  await again.app.start(CONFIG);
  await again.app.idle();
  assert.equal(again.fake.calls.length, 0);
  assert.match(status(again.gladys).message.fr, /6 h/);
  // A 503 doubles the pause.
  r['/data'] = () => json({}, { status: 503 });
  await tick(PAUSE_MIN);
  assert.equal(store.data.pause.count, 2);
  assert.equal(store.data.pause.code, 'server');
  assert.equal(store.data.pause.until, clock.now + 2 * PAUSE_MIN);
  // Back to normal: the pause ends, written in /data.
  r['/data'] = imeonRoutes()['/data'];
  await tick(2 * PAUSE_MIN);
  assert.equal(status(gladys).connected, true);
  assert.equal(store.data.pause, null);
});

test('unreachable: retries from 1 min, doubled; a reconnection keeps the delay', async () => {
  const r = imeonRoutes();
  r['/login'] = () => {
    throw refusedError();
  };
  const { app, gladys, tick, fake } = await setup({ routes: r });
  await app.start(CONFIG);
  await app.idle();
  assert.match(status(gladys).message.fr, /injoignable.*1 min/);
  await tick(RETRY_MIN);
  assert.equal(calls(fake, '/login'), 2);
  assert.match(status(gladys).message.fr, /2 min/);
  await app.start(CONFIG);
  await app.idle();
  assert.equal(calls(fake, '/login'), 2, 'a reconnection does not retry sooner');
  assert.match(status(gladys).message.fr, /injoignable/);
});

test('a secondary page failing never holds back the main values', async () => {
  const r = imeonRoutes();
  r['/api/temp'] = () => json({}, { status: 404 });
  r['/api/manager'] = () => json({ result: '{"inverter_state": "??"}' });
  const { app, gladys } = await setup({ routes: r, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.en, /temperatures, state and mode/);
  assert.equal(last(gladys, 'battery_soc'), 78);
  assert.equal(last(gladys, 'consumption_index'), 6);
});

test('an index jump is held, shown, and taken only by the accept button', async () => {
  const r = imeonRoutes();
  const store = createMemoryStore();
  const device = created({ index: { value: 1000, at: NOW - MINUTE } });
  const { app, gladys, tick } = await setup({ routes: r, devices: [device], store });
  await app.start(CONFIG);
  await app.idle();
  // Gladys held 1000: the index goes on from there.
  assert.equal(last(gladys, 'consumption_index'), 1000);
  // The counter of the day jumps by 500 kWh in a minute: held.
  energy(r, { grid_consumed: 506_000 });
  await tick();
  assert.equal(last(gladys, 'consumption_index'), 1000);
  assert.match(status(gladys).message.fr, /a sauté de 1000 à 1500 kWh/);
  assert.equal(store.data.indexes[F('consumption_index')].guard.held.to, 1500);
  // A save of the form accepts nothing.
  await app.start(CONFIG, { fresh: true });
  await app.idle();
  assert.equal(last(gladys, 'consumption_index'), 1000);
  // The button: exactly what was shown.
  const answer = await gladys.fake.action(ACTIONS.ACCEPT_HELD);
  assert.match(answer.data.message.en, /500 kWh/);
  await app.idle();
  assert.equal(last(gladys, 'consumption_index'), 1500);
  assert.doesNotMatch(status(gladys).message.fr, /retenu/);
  const nothing = await gladys.fake.action(ACTIONS.ACCEPT_HELD);
  assert.match(nothing.data.message.en, /nothing to accept/);
});

test('the test button: the model and serial; the unreachable case in our words', async () => {
  const r = imeonRoutes();
  const { app, gladys } = await setup({ routes: r });
  await app.start(CONFIG);
  await app.idle();
  const ok = await gladys.fake.action(ACTIONS.TEST);
  assert.match(ok.data.message.fr, new RegExp(`IMEON 3-25, numéro de série ${SERIAL}`));
  r['/data'] = () => {
    throw refusedError();
  };
  const down = await gladys.fake.action(ACTIONS.TEST);
  assert.match(down.data.message.fr, /injoignable/);
});

test('every connection publishes the status and the device again', async () => {
  const { app, gladys } = await setup({ devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  const discovered = gladys.fake.discoveredDevices.length;
  await app.start(CONFIG);
  await app.idle();
  assert.equal(status(gladys).connected, true);
  assert.ok(gladys.fake.discoveredDevices.length >= 1);
  assert.ok(discovered >= 1);
});
