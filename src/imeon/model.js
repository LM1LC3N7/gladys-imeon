// -----------------------------------------------------------------------------
// The pages of the inverter -> plain snapshots. Pure.
//
// Field names after imeon_inverter_api (Imeon Energy, Apache-2.0, see
// THIRD_PARTY_NOTICES.md) and the Home Assistant integration that uses it:
// each `/api/<page>` answers `{ "result": "<JSON text>" }`, the JSON text a
// flat object of values (`battery`: power, soc, status, stored, consumed...).
// Units as Home Assistant declares them: W, %, V, A, Hz, °C, and Wh for the
// energies (converted here to kWh).
//
// Stricter than the library: a value missing, not a number, or out of a sane
// range is undefined, never 0; only the object's own keys are read.
// -----------------------------------------------------------------------------

import { DAY_ENERGY_MAX, POWER_MAX } from '../constants.js';

const NUMERIC = /^-?\d{1,12}(?:\.\d{1,12})?$/;

/** A number, or a strictly numeric string; anything else is undefined. */
export function num(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && NUMERIC.test(value.trim())) {
    return Number(value.trim());
  }
  return undefined;
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** An own key of a plain object, never one of its prototype. */
const own = (object, key) =>
  isObject(object) && Object.hasOwn(object, key) ? object[key] : undefined;

const inRange = (value, min, max) =>
  value !== undefined && value >= min && value <= max ? value : undefined;

const power = (object, key) => inRange(num(own(object, key)), -POWER_MAX, POWER_MAX);
const voltage = (object, key) => inRange(num(own(object, key)), 0, 1000);
const current = (object, key) => inRange(num(own(object, key)), -1000, 1000);
const frequency = (object, key) => inRange(num(own(object, key)), 0, 100);
const percent = (object, key) => inRange(num(own(object, key)), 0, 100);
const temperature = (object, key) => inRange(num(own(object, key)), -50, 150);
/** A counter of the day in Wh -> kWh, never below 0. */
const dayEnergy = (object, key) => {
  const wh = num(own(object, key));
  return wh === undefined ? undefined : inRange(wh / 1000, 0, DAY_ENERGY_MAX);
};

const code = (object, key, codes) => {
  const value = own(object, key);
  return typeof value === 'string' && Object.hasOwn(codes, value) ? codes[value] : undefined;
};

/** Battery status (Home Assistant `ATTR_BATTERY_STATUS`) -> the integer published. */
export const BATTERY_STATUS = { charging: 1, discharging: 2, charged: 3 };
/** Inverter state (`ATTR_INVERTER_STATE`) -> the integer published. */
export const INVERTER_STATE = {
  not_connected: 0,
  unsynchronized: 1,
  grid_consumption: 2,
  grid_injection: 3,
  grid_synchronized_but_not_used: 4,
};
/** Inverter mode (`ATTR_INVERTER_MODE`) -> the integer published (read only). */
export const INVERTER_MODE = { smg: 1, bup: 2, ong: 3, ofg: 4 };

const phases = (object, read, name) => [1, 2, 3].map((n) => read(object, `${name}_l${n}`));

/**
 * The `result` of an `/api/<page>` answer: a JSON text (as the library reads
 * it) or already an object; undefined when it is neither.
 */
export function resultOf(body) {
  const result = own(body, 'result');
  if (typeof result === 'string') {
    try {
      const parsed = JSON.parse(result);
      return isObject(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return isObject(result) ? result : undefined;
}

/** Each page, its result -> its values. */
export const PARSERS = {
  battery: (r) => ({
    power: power(r, 'power'),
    soc: percent(r, 'soc'),
    status: code(r, 'status', BATTERY_STATUS),
    stored: power(r, 'stored'),
    consumed: power(r, 'consumed'),
  }),
  grid: (r) => ({
    current: phases(r, current, 'current'),
    voltage: phases(r, voltage, 'voltage'),
    frequency: frequency(r, 'frequency'),
  }),
  pv: (r) => ({
    power1: power(r, 'power_1'),
    power2: power(r, 'power_2'),
    total: power(r, 'power_total'),
    consumed: power(r, 'consumed'),
    injected: power(r, 'injected'),
  }),
  input: (r) => ({
    power: phases(r, power, 'power'),
    total: power(r, 'power_total'),
  }),
  output: (r) => ({
    current: phases(r, current, 'current'),
    voltage: phases(r, voltage, 'voltage'),
    power: phases(r, power, 'power'),
    total: power(r, 'power_total'),
    frequency: frequency(r, 'frequency'),
  }),
  meter: (r) => ({ power: power(r, 'power') }),
  temp: (r) => ({
    air: temperature(r, 'air_temperature'),
    component: temperature(r, 'component_temperature'),
  }),
  energy: (r) => ({
    pv: dayEnergy(r, 'pv'),
    gridInjected: dayEnergy(r, 'grid_injected'),
    gridConsumed: dayEnergy(r, 'grid_consumed'),
    building: dayEnergy(r, 'building_consumption'),
    batteryStored: dayEnergy(r, 'battery_stored'),
    batteryConsumed: dayEnergy(r, 'battery_consumed'),
  }),
  forecast: (r) => ({
    consumption: dayEnergy(r, 'cons_remaining_today'),
    production: dayEnergy(r, 'prod_remaining_today'),
  }),
  monitoring: (r) => ({
    selfConsumption: percent(r, 'self_consumption'),
    selfSufficiency: percent(r, 'self_sufficiency'),
  }),
  monitoringMinute: (r) => ({
    building: power(r, 'building_consumption'),
    gridConsumption: power(r, 'grid_consumption'),
    gridInjection: power(r, 'grid_injection'),
    gridFlow: power(r, 'grid_power_flow'),
    solar: power(r, 'solar_production'),
  }),
  manager: (r) => ({
    state: code(r, 'inverter_state', INVERTER_STATE),
    mode: code(r, 'inverter_mode', INVERTER_MODE),
  }),
};

/** Whether a parsed page holds at least one value (an empty page is not an IMEON one). */
export function hasValues(values) {
  return Object.values(values).some((v) =>
    Array.isArray(v) ? v.some((x) => x !== undefined) : v !== undefined,
  );
}

const SERIAL = /^[A-Za-z0-9_-]{4,40}$/;
const LABEL = /^[\w .,()+/-]{1,40}$/;

const label = (value) =>
  typeof value === 'string' && LABEL.test(value.trim()) ? value.trim() : undefined;

/**
 * The `/data` page: the serial (the external id of the device, required),
 * the model and software (params), the charging current and injection power
 * limits (sensors). Undefined without a valid serial.
 */
export function parseData(body) {
  const serial = own(body, 'serial');
  if (typeof serial !== 'string' || !SERIAL.test(serial)) {
    return undefined;
  }
  return {
    serial,
    model: label(own(body, 'type')),
    software: label(own(body, 'software')),
    chargingCurrentLimit: inRange(num(own(body, 'max_ac_charging_current')), 0, 1000),
    injectionPowerLimit: inRange(num(own(body, 'injection_power')), 0, POWER_MAX),
  };
}

/** What the readings show the inverter has: three phases once L2 or L3 shows a voltage. */
export function capabilitiesOf(pages) {
  const l23 = [
    pages.grid?.voltage?.[1],
    pages.grid?.voltage?.[2],
    pages.output?.voltage?.[1],
    pages.output?.voltage?.[2],
  ];
  return { threePhase: l23.some((v) => v !== undefined && v > 0) };
}

/** The union of two capabilities (they only grow). */
export function mergeCapabilities(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { threePhase: Boolean(a.threePhase || b.threePhase) };
}
