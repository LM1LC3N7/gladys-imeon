// -----------------------------------------------------------------------------
// The Gladys device of an IMEON inverter and its states. Pure.
//
// External id (forever): inverter:<serial>, the serial of the `/data` page.
// Feature keys (forever): see FEATURE below.
//
// Energy rules of the Gladys core (server/utils/constants.js and the
// energy-monitoring service):
// - `consumption_index` is the ONLY energy-sensor / index feature: the
//   electricity taken from the grid, a cumulative index built from the
//   inverter's counter of the day (src/daily.js) and checked by the guard
//   (src/guard.js). The core derives the consumption and its cost from it;
// - `production_index` is the ONLY energy-production-sensor / index feature:
//   the solar production, built and guarded the same way, with its
//   `thirty-minutes-production` feature declared here (the core derives that
//   one for a consumption index only), ids computed (UUID v5) so an "Update"
//   in Discovery keeps the same rows; the integration never publishes it;
// - the counters of the day (injection, house, battery, and the two above as
//   they are) are plain sensors, kWh in the name: never an index, never
//   `daily-consumption`, never publishEnergyConsumption;
// - `grid_power` (taken from the grid) is the only energy-sensor / power
//   feature (the energy contracts read it for the peaks), `pv_power` the
//   only energy-production-sensor / power; every other power is a plain
//   sensor, W in the name (signed values included);
// - units: only the ones the core lists for the category
//   (DEVICE_FEATURE_UNITS_BY_CATEGORY): W, V, A, kWh for energy-sensor, W and
//   kWh for energy-production-sensor, % for battery, °C for
//   device-temperature-sensor, none for unknown (the unit is then in the name).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { DAY_ENERGY_MAX, EXTERNAL_ID_TYPE, POWER_MAX } from './constants.js';

/** Feature keys (forever). */
export const FEATURE = {
  GRID_POWER: 'grid_power',
  GRID_INJECTION_POWER: 'grid_injection_power',
  GRID_FLOW: 'grid_power_flow',
  BUILDING_POWER: 'building_power',
  METER_POWER: 'meter_power',
  PV_POWER: 'pv_power',
  PV_POWER_1: 'pv_power_1',
  PV_POWER_2: 'pv_power_2',
  PV_CONSUMED: 'pv_consumed_power',
  PV_INJECTED: 'pv_injected_power',
  BATTERY_SOC: 'battery_soc',
  BATTERY_POWER: 'battery_power',
  BATTERY_STATUS: 'battery_status',
  BATTERY_STORED: 'battery_stored_power',
  BATTERY_CONSUMED: 'battery_consumed_power',
  GRID_FREQUENCY: 'grid_frequency',
  OUTPUT_FREQUENCY: 'output_frequency',
  INPUT_POWER_TOTAL: 'input_power_total',
  OUTPUT_POWER_TOTAL: 'output_power_total',
  TEMP_AIR: 'temperature_air',
  TEMP_COMPONENT: 'temperature_component',
  SELF_CONSUMPTION: 'self_consumption',
  SELF_SUFFICIENCY: 'self_sufficiency',
  CONSUMPTION_INDEX: 'consumption_index',
  PRODUCTION_INDEX: 'production_index',
  /** 30-minute production: fed by the Gladys core from the index, never by the integration. */
  PRODUCTION_30MIN: 'production_index_production',
  DAY_PV: 'energy_pv_today',
  DAY_GRID_CONSUMED: 'energy_grid_consumed_today',
  DAY_GRID_INJECTED: 'energy_grid_injected_today',
  DAY_BUILDING: 'energy_building_today',
  DAY_BATTERY_STORED: 'energy_battery_stored_today',
  DAY_BATTERY_CONSUMED: 'energy_battery_consumed_today',
  FORECAST_CONSUMPTION: 'forecast_consumption_today',
  FORECAST_PRODUCTION: 'forecast_production_today',
  INVERTER_STATE: 'inverter_state',
  INVERTER_MODE: 'inverter_mode',
  CHARGING_CURRENT_LIMIT: 'charging_current_limit',
  INJECTION_POWER_LIMIT: 'injection_power_limit',
  gridVoltage: (n) => `grid_voltage_l${n}`,
  gridCurrent: (n) => `grid_current_l${n}`,
  inputPower: (n) => `input_power_l${n}`,
  outputPower: (n) => `output_power_l${n}`,
  outputVoltage: (n) => `output_voltage_l${n}`,
  outputCurrent: (n) => `output_current_l${n}`,
};

/** The external ids of the inverter with this serial. */
export const ids = (gladys, serial) => gladys.externalIds(EXTERNAL_ID_TYPE, serial);

/** Namespace of the feature ids of this integration (random, fixed forever). */
const ID_NAMESPACE = Buffer.from('5c0e6f1a9b2d4c8e8f3a7b6d2e1c0a94', 'hex');

/** A deterministic UUID (version 5, RFC 9562) of a name (as gladys-apsystems). */
export function uuidOf(name) {
  const hash = createHash('sha1').update(ID_NAMESPACE).update(String(name), 'utf8').digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const feature = (external, key, name, category, type, extra = {}) => ({
  name,
  external_id: external.feature(key),
  category,
  type,
  min: 0,
  max: 1_000_000_000,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});

/** A value shown, never summed nor billed: no energy category, no unit (it is in the name). */
const plain = (external, key, name, extra = {}) =>
  feature(external, key, name, C.UNKNOWN, T.SENSOR.DECIMAL, extra);

/** A power that may be negative (a flow, a battery): a plain sensor in W. */
const signedPower = (external, key, name) =>
  plain(external, key, `${name} (W)`, { min: -POWER_MAX, max: POWER_MAX });

const positivePower = (external, key, name) =>
  plain(external, key, `${name} (W)`, { max: POWER_MAX });

const dayCounter = (external, key, name) =>
  plain(external, key, `${name} (kWh, today)`, { max: DAY_ENERGY_MAX });

const code = (external, key, name, max) =>
  feature(external, key, name, C.UNKNOWN, T.SENSOR.INTEGER, { max });

const voltage = (external, key, name) =>
  feature(external, key, name, C.ENERGY_SENSOR, T.ENERGY_SENSOR.VOLTAGE, {
    unit: U.VOLT,
    max: 1000,
    keep_history: false,
  });

const current = (external, key, name) =>
  feature(external, key, name, C.ENERGY_SENSOR, T.ENERGY_SENSOR.CURRENT, {
    unit: U.AMPERE,
    min: -1000,
    max: 1000,
    keep_history: false,
  });

const temperature = (external, key, name) =>
  feature(external, key, name, C.DEVICE_TEMPERATURE_SENSOR, T.SENSOR.DECIMAL, {
    unit: U.CELSIUS,
    min: -50,
    max: 150,
  });

/** The phases shown: L1, or L1 to L3 once the inverter showed three phases. */
const phaseList = (capabilities) => (capabilities?.threePhase ? [1, 2, 3] : [1]);

/**
 * The device of the inverter. `info` is the `/data` page (serial, model,
 * software); `capabilities` what the readings showed (src/imeon/model.js).
 * The features are fixed when the user creates it.
 */
export function buildDevice(gladys, info, capabilities, address) {
  const external = ids(gladys, info.serial);
  const productionIndexId = external.feature(FEATURE.PRODUCTION_INDEX);
  const phases = phaseList(capabilities);
  const features = [
    feature(
      external,
      FEATURE.GRID_POWER,
      'Power taken from the grid',
      C.ENERGY_SENSOR,
      T.ENERGY_SENSOR.POWER,
      { unit: U.WATT, max: POWER_MAX },
    ),
    positivePower(external, FEATURE.GRID_INJECTION_POWER, 'Power injected into the grid'),
    signedPower(external, FEATURE.GRID_FLOW, 'Grid power flow'),
    positivePower(external, FEATURE.BUILDING_POWER, 'House consumption'),
    signedPower(external, FEATURE.METER_POWER, 'Energy meter power'),
    feature(
      external,
      FEATURE.PV_POWER,
      'Solar production',
      C.ENERGY_PRODUCTION_SENSOR,
      T.ENERGY_PRODUCTION_SENSOR.POWER,
      { unit: U.WATT, max: POWER_MAX },
    ),
    positivePower(external, FEATURE.PV_POWER_1, 'Solar string 1'),
    positivePower(external, FEATURE.PV_POWER_2, 'Solar string 2'),
    positivePower(external, FEATURE.PV_CONSUMED, 'Solar used in the house'),
    positivePower(external, FEATURE.PV_INJECTED, 'Solar injected into the grid'),
    feature(external, FEATURE.BATTERY_SOC, 'Battery charge', C.BATTERY, T.BATTERY.INTEGER, {
      unit: U.PERCENT,
      max: 100,
    }),
    signedPower(external, FEATURE.BATTERY_POWER, 'Battery power'),
    code(
      external,
      FEATURE.BATTERY_STATUS,
      'Battery status (1 = charging, 2 = discharging, 3 = charged)',
      3,
    ),
    signedPower(external, FEATURE.BATTERY_STORED, 'Battery stored power'),
    signedPower(external, FEATURE.BATTERY_CONSUMED, 'Battery consumed power'),
  ];
  for (const n of phases) {
    features.push(
      voltage(external, FEATURE.gridVoltage(n), `Grid voltage L${n}`),
      current(external, FEATURE.gridCurrent(n), `Grid current L${n}`),
    );
  }
  // No frequency category or Hz unit in the core: a plain decimal, named with its unit.
  features.push(plain(external, FEATURE.GRID_FREQUENCY, 'Grid frequency (Hz)', { max: 100 }));
  for (const n of phases) {
    features.push(
      signedPower(external, FEATURE.inputPower(n), `AC input L${n}`),
      signedPower(external, FEATURE.outputPower(n), `AC output L${n}`),
      voltage(external, FEATURE.outputVoltage(n), `AC output voltage L${n}`),
      current(external, FEATURE.outputCurrent(n), `AC output current L${n}`),
    );
  }
  features.push(
    signedPower(external, FEATURE.INPUT_POWER_TOTAL, 'AC input total'),
    signedPower(external, FEATURE.OUTPUT_POWER_TOTAL, 'AC output total'),
    plain(external, FEATURE.OUTPUT_FREQUENCY, 'AC output frequency (Hz)', { max: 100 }),
    temperature(external, FEATURE.TEMP_AIR, 'Inverter air temperature'),
    temperature(external, FEATURE.TEMP_COMPONENT, 'Inverter component temperature'),
    plain(external, FEATURE.SELF_CONSUMPTION, 'Self-consumption, last 24 h (%)', { max: 100 }),
    plain(external, FEATURE.SELF_SUFFICIENCY, 'Self-sufficiency, last 24 h (%)', { max: 100 }),
    feature(
      external,
      FEATURE.CONSUMPTION_INDEX,
      'Grid consumption index',
      C.ENERGY_SENSOR,
      T.ENERGY_SENSOR.INDEX,
      { unit: U.KILOWATT_HOUR },
    ),
    feature(
      external,
      FEATURE.PRODUCTION_INDEX,
      'Solar production index',
      C.ENERGY_PRODUCTION_SENSOR,
      T.ENERGY_PRODUCTION_SENSOR.INDEX,
      { id: uuidOf(productionIndexId), unit: U.KILOWATT_HOUR },
    ),
    feature(
      external,
      FEATURE.PRODUCTION_30MIN,
      'Solar production index (30-minute production)',
      C.ENERGY_PRODUCTION_SENSOR,
      T.ENERGY_PRODUCTION_SENSOR.THIRTY_MINUTES_PRODUCTION,
      {
        id: uuidOf(external.feature(FEATURE.PRODUCTION_30MIN)),
        energy_parent_id: uuidOf(productionIndexId),
        unit: U.KILOWATT_HOUR,
      },
    ),
    dayCounter(external, FEATURE.DAY_PV, 'Solar production'),
    dayCounter(external, FEATURE.DAY_GRID_CONSUMED, 'Taken from the grid'),
    dayCounter(external, FEATURE.DAY_GRID_INJECTED, 'Injected into the grid'),
    dayCounter(external, FEATURE.DAY_BUILDING, 'House consumption'),
    dayCounter(external, FEATURE.DAY_BATTERY_STORED, 'Stored in the battery'),
    dayCounter(external, FEATURE.DAY_BATTERY_CONSUMED, 'Taken from the battery'),
    dayCounter(external, FEATURE.FORECAST_CONSUMPTION, 'Forecast consumption left'),
    dayCounter(external, FEATURE.FORECAST_PRODUCTION, 'Forecast production left'),
    code(
      external,
      FEATURE.INVERTER_STATE,
      'Inverter state (0 = not connected, 1 = unsynchronized, 2 = grid consumption, 3 = grid injection, 4 = grid synchronized but not used)',
      4,
    ),
    code(
      external,
      FEATURE.INVERTER_MODE,
      'Inverter mode (1 = smart grid, 2 = backup, 3 = on-grid, 4 = off-grid)',
      4,
    ),
    plain(external, FEATURE.CHARGING_CURRENT_LIMIT, 'Battery charging current limit (A)', {
      max: 1000,
    }),
    positivePower(external, FEATURE.INJECTION_POWER_LIMIT, 'Injection power limit'),
  );
  return {
    name: ['IMEON', info.model, info.serial].filter(Boolean).join(' '),
    external_id: external.device,
    features,
    params: [
      { name: 'address', value: address },
      { name: 'serial', value: info.serial },
      { name: 'model', value: info.model ?? '' },
      { name: 'software', value: info.software ?? '' },
    ],
  };
}

/**
 * The capabilities a CREATED device carries (its features): the device
 * published again never has fewer features than the one the user created
 * (a missing one would read as a change, and "Update" would drop its history).
 */
export function capabilitiesOfDevice(device) {
  const keys = new Set(
    (device?.features ?? []).map((f) => String(f.external_id).split(':').at(-1)),
  );
  if (keys.size === 0) {
    return undefined;
  }
  return {
    threePhase: [2, 3].some(
      (n) => keys.has(FEATURE.gridVoltage(n)) || keys.has(FEATURE.outputVoltage(n)),
    ),
  };
}

export const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const state = (external, key, value, digits) =>
  isNumber(value)
    ? [{ device_feature_external_id: external.feature(key), state: round(value, digits) }]
    : [];

/** A value of a feature whose minimum is 0: a negative one is a glitch, not sent. */
const positive = (value) => (isNumber(value) && value >= 0 ? value : undefined);

/**
 * The states of a poll. `pages`: the parsed pages read this time (a page
 * missing gives nothing), `data`: the `/data` page (limits), `indexes`: the
 * values the guards let through (`{ consumption, production }`, undefined:
 * not published this time). keptOut: the index names whose counter of the
 * day was the day before shown again (fix 0.1.2): that counter is not sent.
 */
export function pollStates(external, pages, data, indexes = {}, keptOut = []) {
  const { battery, grid, pv, input, output, meter, temp, energy, forecast } = pages;
  const { monitoring, monitoringMinute: minute, manager } = pages;
  return [
    ...state(external, FEATURE.GRID_POWER, positive(minute?.gridConsumption), 0),
    ...state(external, FEATURE.GRID_INJECTION_POWER, positive(minute?.gridInjection), 0),
    ...state(external, FEATURE.GRID_FLOW, minute?.gridFlow, 0),
    ...state(external, FEATURE.BUILDING_POWER, positive(minute?.building), 0),
    ...state(external, FEATURE.METER_POWER, meter?.power, 0),
    ...state(external, FEATURE.PV_POWER, positive(pv?.total), 0),
    ...state(external, FEATURE.PV_POWER_1, positive(pv?.power1), 0),
    ...state(external, FEATURE.PV_POWER_2, positive(pv?.power2), 0),
    ...state(external, FEATURE.PV_CONSUMED, positive(pv?.consumed), 0),
    ...state(external, FEATURE.PV_INJECTED, positive(pv?.injected), 0),
    ...state(external, FEATURE.BATTERY_SOC, battery?.soc, 0),
    ...state(external, FEATURE.BATTERY_POWER, battery?.power, 0),
    ...state(external, FEATURE.BATTERY_STATUS, battery?.status, 0),
    ...state(external, FEATURE.BATTERY_STORED, battery?.stored, 0),
    ...state(external, FEATURE.BATTERY_CONSUMED, battery?.consumed, 0),
    ...[1, 2, 3].flatMap((n) => [
      ...state(external, FEATURE.gridVoltage(n), grid?.voltage?.[n - 1], 1),
      ...state(external, FEATURE.gridCurrent(n), grid?.current?.[n - 1], 2),
      ...state(external, FEATURE.inputPower(n), input?.power?.[n - 1], 0),
      ...state(external, FEATURE.outputPower(n), output?.power?.[n - 1], 0),
      ...state(external, FEATURE.outputVoltage(n), output?.voltage?.[n - 1], 1),
      ...state(external, FEATURE.outputCurrent(n), output?.current?.[n - 1], 2),
    ]),
    ...state(external, FEATURE.GRID_FREQUENCY, grid?.frequency, 2),
    ...state(external, FEATURE.INPUT_POWER_TOTAL, input?.total, 0),
    ...state(external, FEATURE.OUTPUT_POWER_TOTAL, output?.total, 0),
    ...state(external, FEATURE.OUTPUT_FREQUENCY, output?.frequency, 2),
    ...state(external, FEATURE.TEMP_AIR, temp?.air, 1),
    ...state(external, FEATURE.TEMP_COMPONENT, temp?.component, 1),
    ...state(external, FEATURE.SELF_CONSUMPTION, monitoring?.selfConsumption, 1),
    ...state(external, FEATURE.SELF_SUFFICIENCY, monitoring?.selfSufficiency, 1),
    // The indexes: never 0 (the guard never lets 0 through, checked again here).
    ...(isNumber(indexes.consumption) && indexes.consumption > 0
      ? state(external, FEATURE.CONSUMPTION_INDEX, indexes.consumption, 3)
      : []),
    ...(isNumber(indexes.production) && indexes.production > 0
      ? state(external, FEATURE.PRODUCTION_INDEX, indexes.production, 3)
      : []),
    ...state(external, FEATURE.DAY_PV, keptOut.includes('production') ? undefined : energy?.pv, 3),
    ...state(
      external,
      FEATURE.DAY_GRID_CONSUMED,
      keptOut.includes('consumption') ? undefined : energy?.gridConsumed,
      3,
    ),
    ...state(external, FEATURE.DAY_GRID_INJECTED, energy?.gridInjected, 3),
    ...state(external, FEATURE.DAY_BUILDING, energy?.building, 3),
    ...state(external, FEATURE.DAY_BATTERY_STORED, energy?.batteryStored, 3),
    ...state(external, FEATURE.DAY_BATTERY_CONSUMED, energy?.batteryConsumed, 3),
    ...state(external, FEATURE.FORECAST_CONSUMPTION, forecast?.consumption, 3),
    ...state(external, FEATURE.FORECAST_PRODUCTION, forecast?.production, 3),
    ...state(external, FEATURE.INVERTER_STATE, manager?.state, 0),
    ...state(external, FEATURE.INVERTER_MODE, manager?.mode, 0),
    ...state(external, FEATURE.CHARGING_CURRENT_LIMIT, data?.chargingCurrentLimit, 1),
    ...state(external, FEATURE.INJECTION_POWER_LIMIT, positive(data?.injectionPowerLimit), 0),
  ];
}
