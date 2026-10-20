// -----------------------------------------------------------------------------
// The pure parts: pages -> values, the device and its states, the
// configuration and the /data store.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { isComplete, normalizeConfig, parseAddress } from '../src/config.js';
import {
  FEATURE,
  buildDevice,
  capabilitiesOfDevice,
  ids,
  pollStates,
  uuidOf,
} from '../src/devices.js';
import {
  PARSERS,
  capabilitiesOf,
  hasValues,
  mergeCapabilities,
  num,
  parseData,
  resultOf,
} from '../src/imeon/model.js';
import { createFileStore } from '../src/store.js';
import { ADDRESS, DATA, RESULTS, SERIAL } from './fixtures/imeon.js';

const parse = (name, result) => PARSERS[name](result);
const ALL = {
  battery: parse('battery', RESULTS.battery),
  grid: parse('grid', RESULTS.grid),
  pv: parse('pv', RESULTS.pv),
  input: parse('input', RESULTS.input),
  output: parse('output', RESULTS.output),
  meter: parse('meter', RESULTS.em),
  temp: parse('temp', RESULTS.temp),
  energy: parse('energy', RESULTS.energy),
  forecast: parse('forecast', RESULTS.forecast),
  monitoring: parse('monitoring', RESULTS.monitorHour),
  monitoringMinute: parse('monitoringMinute', RESULTS.monitorMinute),
  manager: parse('manager', RESULTS.manager),
};

test('numbers: numbers and numeric strings, nothing else', () => {
  assert.equal(num(12.5), 12.5);
  assert.equal(num(' 230.1 '), 230.1);
  assert.equal(num('-3.4'), -3.4);
  for (const bad of ['', 'abc', '1e5', '0x10', null, undefined, true, NaN, Infinity, [], {}]) {
    assert.equal(num(bad), undefined, String(bad));
  }
});

test('the envelope: a JSON text or an object, nothing else; own keys only', () => {
  assert.deepEqual(resultOf({ result: '{"soc": 50}' }), { soc: 50 });
  assert.deepEqual(resultOf({ result: { soc: 50 } }), { soc: 50 });
  for (const bad of [{ result: '[1]' }, { result: 'nope' }, { result: 3 }, {}, null, [], 'x']) {
    assert.equal(resultOf(bad), undefined, JSON.stringify(bad));
  }
  const polluted = JSON.parse('{"__proto__": {"soc": 99}}');
  assert.equal(parse('battery', polluted).soc, undefined, 'never a key of the prototype');
  assert.equal({}.soc, undefined);
});

test('the pages, as Home Assistant reads them; energies from Wh to kWh', () => {
  assert.deepEqual(ALL.battery, {
    power: 2500,
    soc: 78,
    status: 1,
    stored: 10200,
    consumed: 500,
  });
  assert.deepEqual(ALL.grid, {
    current: [12.5, 10.8, 11.2],
    voltage: [230, 229.5, 230.1],
    frequency: 50,
  });
  assert.deepEqual(ALL.energy, {
    pv: 12,
    gridInjected: 5,
    gridConsumed: 6,
    building: 15,
    batteryStored: 8,
    batteryConsumed: 2,
  });
  assert.deepEqual(ALL.forecast, { consumption: 3, production: 7 });
  assert.deepEqual(ALL.manager, { state: 2, mode: 1 });
  assert.equal(ALL.monitoringMinute.gridFlow, -3.4);
  assert.equal(ALL.temp.component, 45.5);
});

test('out of range or odd values are undefined, never 0', () => {
  const battery = parse('battery', { power: 1e9, soc: 120, status: 'boom', stored: 'x' });
  assert.deepEqual(battery, {
    power: undefined,
    soc: undefined,
    status: undefined,
    stored: undefined,
    consumed: undefined,
  });
  assert.equal(hasValues(battery), false);
  assert.equal(parse('energy', { pv: -5 }).pv, undefined);
  assert.equal(parse('energy', { pv: 5_000_000 }).pv, undefined, 'over 2 000 kWh a day');
  assert.equal(parse('temp', { air_temperature: 400 }).air, undefined);
  assert.equal(parse('manager', { inverter_state: 'toString' }).state, undefined);
  assert.equal(hasValues(parse('grid', { voltage_l1: 230 })), true);
});

test('the /data page: a valid serial or nothing; the labels checked', () => {
  assert.deepEqual(parseData(DATA), {
    serial: SERIAL,
    model: '3-25',
    software: '1.8.1.0',
    chargingCurrentLimit: 50,
    injectionPowerLimit: 5000,
  });
  for (const serial of [undefined, '', 'a b', '../x', 'x'.repeat(41), 123]) {
    assert.equal(parseData({ ...DATA, serial }), undefined, String(serial));
  }
  assert.equal(parseData({ ...DATA, type: '<script>' }).model, undefined);
});

test('capabilities: three phases once L2 or L3 shows a voltage; only growing', () => {
  assert.deepEqual(capabilitiesOf(ALL), { threePhase: true });
  const single = { grid: parse('grid', { voltage_l1: 230, voltage_l2: 0, voltage_l3: 0 }) };
  assert.deepEqual(capabilitiesOf(single), { threePhase: false });
  assert.deepEqual(mergeCapabilities({ threePhase: true }, { threePhase: false }), {
    threePhase: true,
  });
  assert.deepEqual(mergeCapabilities(undefined, { threePhase: false }), { threePhase: false });
});

test('the device: one index in each energy category, everything else plain', () => {
  const gladys = createFakeGladys({ selector: 'imeon' });
  const device = buildDevice(gladys, parseData(DATA), { threePhase: true }, ADDRESS);
  assert.equal(device.external_id, `ext:imeon:inverter:${SERIAL}`);
  assert.equal(device.name, `IMEON 3-25 ${SERIAL}`);
  const byKey = Object.fromEntries(
    device.features.map((f) => [f.external_id.split(':').at(-1), f]),
  );
  const of = (category, type) =>
    device.features.filter((f) => f.category === category && f.type === type).map((f) => f.name);
  assert.deepEqual(of('energy-sensor', 'index'), ['Grid consumption index']);
  assert.deepEqual(of('energy-production-sensor', 'index'), ['Solar production index']);
  assert.deepEqual(of('energy-sensor', 'power'), ['Power taken from the grid']);
  assert.deepEqual(of('energy-production-sensor', 'power'), ['Solar production']);
  for (const type of ['daily-consumption', 'energy', 'index-today', 'daily-production']) {
    assert.deepEqual(of('energy-sensor', type), [], type);
    assert.deepEqual(of('energy-production-sensor', type), [], type);
  }
  // The 30-minute production hangs off the production index (ids stable).
  const index = byKey[FEATURE.PRODUCTION_INDEX];
  const halfHour = byKey[FEATURE.PRODUCTION_30MIN];
  assert.equal(index.id, uuidOf(index.external_id));
  assert.equal(halfHour.energy_parent_id, index.id);
  assert.equal(halfHour.type, 'thirty-minutes-production');
  // The counters of the day: plain sensors, kWh in the name.
  for (const key of [FEATURE.DAY_PV, FEATURE.DAY_GRID_CONSUMED, FEATURE.DAY_GRID_INJECTED]) {
    assert.equal(byKey[key].category, 'unknown', key);
    assert.match(byKey[key].name, /kWh, today/);
  }
  // Units: only the ones of the core for each category; none for unknown.
  const allowed = {
    'energy-sensor': ['watt', 'volt', 'ampere', 'kilowatt-hour'],
    'energy-production-sensor': ['watt', 'kilowatt-hour'],
    battery: ['percent'],
    'device-temperature-sensor': ['celsius'],
  };
  for (const f of device.features) {
    if (f.category === 'unknown') {
      assert.equal(f.unit, undefined, f.name);
    } else {
      assert.ok(allowed[f.category]?.includes(f.unit), `${f.name}: ${f.category} ${f.unit}`);
    }
    assert.equal(f.read_only, true, `${f.name} is read-only`);
  }
  assert.ok(byKey.grid_voltage_l3);
  assert.deepEqual(capabilitiesOfDevice(device), { threePhase: true });
  // Single phase: L1 only.
  const single = buildDevice(gladys, parseData(DATA), { threePhase: false }, ADDRESS);
  const keys = single.features.map((f) => f.external_id.split(':').at(-1));
  assert.ok(keys.includes('grid_voltage_l1'));
  assert.ok(!keys.includes('grid_voltage_l2'));
  assert.ok(!keys.includes('output_power_l3'));
  assert.deepEqual(capabilitiesOfDevice(single), { threePhase: false });
  assert.equal(capabilitiesOfDevice({ features: [] }), undefined);
});

test('states: rounded, never 0 for an index, never negative for a power from 0', () => {
  const gladys = createFakeGladys({ selector: 'imeon' });
  const external = ids(gladys, SERIAL);
  const states = pollStates(external, ALL, parseData(DATA), {
    consumption: 1000.1234,
    production: 0,
  });
  const value = (key) =>
    states.find((s) => s.device_feature_external_id === external.feature(key))?.state;
  assert.equal(value(FEATURE.CONSUMPTION_INDEX), 1000.123);
  assert.equal(value(FEATURE.PRODUCTION_INDEX), undefined, 'never 0');
  assert.equal(value(FEATURE.BATTERY_SOC), 78);
  assert.equal(value(FEATURE.DAY_PV), 12);
  assert.equal(value(FEATURE.GRID_FLOW), -3);
  assert.equal(value(FEATURE.GRID_POWER), 8);
  assert.equal(value(FEATURE.INVERTER_STATE), 2);
  assert.equal(value(FEATURE.INJECTION_POWER_LIMIT), 5000);
  assert.equal(value('grid_voltage_l2'), 229.5);
  const negative = pollStates(external, {
    pv: { total: -5 },
    monitoringMinute: { gridConsumption: -1 },
  });
  assert.deepEqual(negative, []);
  for (const s of states) {
    assert.ok(Number.isFinite(s.state), s.device_feature_external_id);
  }
});

test('the configuration: address, user name, password; never credentials in the address', () => {
  assert.deepEqual(parseAddress(' 192.168.1.50 '), { address: '192.168.1.50' });
  assert.deepEqual(parseAddress('http://IMEON.local:8080/login'), { address: 'imeon.local:8080' });
  assert.deepEqual(parseAddress('192.168.1.50:80'), { address: '192.168.1.50' });
  assert.deepEqual(parseAddress(''), { address: '' });
  for (const bad of ['http://u:p@1.2.3.4', 'a b', '1.2.3.4:99999', '-x-']) {
    assert.deepEqual(parseAddress(bad), { error: 'invalid' }, bad);
  }
  const config = normalizeConfig({ address: ADDRESS, username: ' user@local ', password: ' pw ' });
  assert.deepEqual(config, {
    address: ADDRESS,
    invalidAddress: false,
    username: 'user@local',
    password: ' pw ',
  });
  assert.equal(isComplete(config), true);
  assert.equal(isComplete(normalizeConfig({ address: ADDRESS, username: 'u' })), false);
  assert.equal(normalizeConfig({ password: 'x'.repeat(300) }).password, '');
});

test('the /data store: written through a temporary file, read back, empty when absent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'imeon-'));
  try {
    const store = createFileStore(join(dir, 'state.json'));
    assert.deepEqual(store.load(), {});
    await store.save({ serial: SERIAL });
    assert.deepEqual(store.load(), { serial: SERIAL });
    assert.deepEqual(createFileStore(join(dir, 'missing', 'x.json')).load(), {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
