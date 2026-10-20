// -----------------------------------------------------------------------------
// The integration itself: the inverter read once a minute (login, the `/data`
// page hourly, the `/api` pages), its device, the two energy indexes built
// from the counters of the day and checked by their guards, the pauses and
// stops kept in /data, the test and accept buttons. index.js only wires the
// SDK handlers to it. Read-only: nothing is ever sent to the inverter but the
// login and the reads.
//
// The created devices are read from `gladys.devices`, which the SDK keeps up
// to date (connection, creation, update, deletion): never a copy of our own.
//
// Two clocks: `now` (wall clock) dates the indexes and the pauses kept in
// /data; `monotonic` paces the reads and retries, so that a wall clock set
// back never stops them.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { isComplete, normalizeConfig } from './config.js';
import {
  AUTH_RETRY_MAX,
  AUTH_RETRY_MIN,
  DATA_INTERVAL,
  DAY_RESET_MAX_KWH,
  DAY_RESET_MIN_GAP,
  DAY_RESET_UNDO_WITHIN,
  INDEX_MAX_KW,
  INDEX_SLACK_KWH,
  PAGES,
  PAUSE_MAX,
  PAUSE_MIN,
  POLL_INTERVAL,
  RETRY_MAX,
  RETRY_MIN,
  STATE_HEARTBEAT,
  TEST_ANSWER_WITHIN,
} from './constants.js';
import { DailyIndex } from './daily.js';
import { FEATURE, buildDevice, capabilitiesOfDevice, ids, pollStates, round } from './devices.js';
import { IndexGuard } from './guard.js';
import { T } from './i18n.js';
import { ImeonClient } from './imeon/client.js';
import { capabilitiesOf, mergeCapabilities } from './imeon/model.js';
import { createFileStore } from './store.js';

const defaultTimers = { setTimeout, clearTimeout, setInterval, clearInterval };

/** The two indexes: their feature and the counter of the day they are built from. */
const INDEXES = [
  { name: 'consumption', key: FEATURE.CONSUMPTION_INDEX, day: (energy) => energy?.gridConsumed },
  { name: 'production', key: FEATURE.PRODUCTION_INDEX, day: (energy) => energy?.pv },
];

const GUARD_LIMITS = { maxKw: INDEX_MAX_KW, slackKwh: INDEX_SLACK_KWH };
const DAILY_LIMITS = {
  resetMaxKwh: DAY_RESET_MAX_KWH,
  minGapMs: DAY_RESET_MIN_GAP,
  undoWithinMs: DAY_RESET_UNDO_WITHIN,
  maxKw: INDEX_MAX_KW,
  slackKwh: INDEX_SLACK_KWH,
};

/** Errors that stop the whole read (the inverter itself does not answer well). */
const FATAL = new Set(['timeout', 'unreachable', 'rate_limited', 'server', 'auth_refused']);

/** The index Gladys already holds for a feature of a created device, when it says so. */
function lastValueOf(device, featureId) {
  const feature = (device?.features ?? []).find((f) => f.external_id === featureId);
  const value = Number(feature?.last_value);
  const at = Date.parse(feature?.last_value_changed ?? '');
  return feature?.last_value !== null &&
    feature?.last_value !== undefined &&
    Number.isFinite(value) &&
    Number.isFinite(at)
    ? { value, at }
    : undefined;
}

/**
 * A pause or a stop read back from /data: `{ until, count }` (and, for a
 * pause, the `code` and `status` shown), its end capped from now.
 */
function validHold(hold, now, max) {
  if (!hold || !Number.isFinite(hold.until) || !Number.isInteger(hold.count) || hold.count < 1) {
    return undefined;
  }
  const valid = { until: Math.min(hold.until, now + max), count: Math.min(hold.count, 32) };
  if (hold.code === 'rate_limited' || hold.code === 'server') {
    valid.code = hold.code;
    valid.status = Number.isInteger(hold.status) ? hold.status : null;
  }
  return valid;
}

const SERIAL = /^[A-Za-z0-9_-]{4,40}$/;

export class ImeonApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'imeon' }),
    now = Date.now,
    monotonic = () => performance.now(),
    timers = defaultTimers,
    clientFactory = (options) => new ImeonClient(options),
    store = createFileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.clientFactory = clientFactory;
    /** /data: indexes, guards, serial, pause, stop. */
    this.store = store;
    this.savedKey = undefined;
    this.config = normalizeConfig();
    this.client = undefined;
    /** The `/data` page: `{ serial, model, software, ... }`; the serial alone when read back. */
    this.info = undefined;
    this.dataAt = undefined;
    this.capabilities = undefined;
    /** By index feature external id: IndexGuard and DailyIndex. */
    this.guards = new Map();
    this.dailies = new Map();
    /** Index names with no index this read (a drop of the counter that is no new day). */
    this.noIndex = [];
    this.failingPages = [];
    /** Network retries: in memory, kept across reconnections, reset by a save of the form. */
    this.failures = 0;
    this.nextTryAt = 0;
    this.lastError = undefined;
    /** 429/5xx pause and credentials stop: `{ until, count }`, kept in /data. */
    const kept = store.load();
    this.pause = validHold(kept.pause, now(), PAUSE_MAX);
    this.authStop = validHold(kept.authStop, now(), AUTH_RETRY_MAX);
    if (typeof kept.serial === 'string' && SERIAL.test(kept.serial)) {
      this.info = { serial: kept.serial };
    }
    this.timer = undefined;
    this.busy = undefined;
    this.busyGeneration = undefined;
    this.firstRun = Promise.resolve();
    this.lastStatus = undefined;
    this.generation = 0;
    this.lifecycle = Promise.resolve();
  }

  // --- Lifecycle -------------------------------------------------------------

  /**
   * `fresh`: the user saved the form (not a reconnection): the retry delays,
   * the pause and the credentials stop end. It accepts no index held back.
   */
  start(raw = {}, { fresh = false } = {}) {
    return this.serialize(() => this.doStart(raw, { fresh }));
  }

  stop() {
    return this.serialize(() => this.doStop());
  }

  /** Resolves once every queued start/stop and the first read after it are done (tests). */
  async idle() {
    await this.lifecycle;
    await this.firstRun;
  }

  serialize(job) {
    const run = this.lifecycle.then(job, job);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  async doStart(raw, { fresh = false } = {}) {
    await this.doStop();
    const generation = ++this.generation;
    const config = normalizeConfig(raw);
    const changed =
      config.address !== this.config.address ||
      config.username !== this.config.username ||
      config.password !== this.config.password;
    this.config = config;
    if (changed || !this.client) {
      this.client = isComplete(config)
        ? this.clientFactory({ address: config.address })
        : undefined;
      this.dataAt = undefined;
      this.failures = 0;
      this.nextTryAt = 0;
      this.lastError = undefined;
    }
    if (fresh) {
      this.failures = 0;
      this.nextTryAt = 0;
      this.lastError = undefined;
      if (this.pause || this.authStop) {
        this.pause = undefined;
        this.authStop = undefined;
        await this.saveState();
      }
    }
    // The core keeps the connection status and the Discovery list in memory:
    // a restarted Gladys has lost them, so they are always sent again.
    this.lastStatus = undefined;
    if (!this.client) {
      await this.setStatus(false, config.invalidAddress ? T.badAddress : T.incomplete);
      return;
    }
    this.gladys.forgetPublishedStates();
    this.capabilities = this.knownCapabilities();
    await this.discover();
    await this.showWaiting();
    // Always armed, whatever the first read gives: never a dead integration.
    this.timer = this.timers.setInterval(
      () => this.run(generation, () => this.tick()),
      POLL_INTERVAL,
    );
    // Not awaited: a start (a save of the form) answers at once.
    this.firstRun = this.run(generation, () => this.tick());
  }

  async doStop() {
    this.generation += 1;
    if (this.timer !== undefined) {
      this.timers.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Run a job of a generation: nothing after a restart. */
  async run(generation, job) {
    if (generation !== this.generation) {
      return;
    }
    try {
      await job();
    } catch (err) {
      this.logger.error(`IMEON: unexpected error (${err?.name ?? 'Error'})`);
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  /** A pause, a stop or a retry still running: its status, with the time left. True if so. */
  async showWaiting() {
    const message = this.waitingMessage();
    if (message) {
      await this.setStatus(false, message);
      return true;
    }
    return false;
  }

  waitingMessage() {
    const now = this.now();
    const notes = this.heldNotes();
    if (this.authStop && now < this.authStop.until) {
      return T.authRefused(this.authStop.until - now, notes);
    }
    if (this.pause && now < this.pause.until) {
      return T.paused(this.config.address, this.pause, this.pause.until - now, notes);
    }
    const mono = this.monotonic();
    if (this.lastError && mono < this.nextTryAt) {
      return T.unreachable(this.config.address, this.lastError, this.nextTryAt - mono, notes);
    }
    return undefined;
  }

  // --- /data -------------------------------------------------------------------------

  /** Keeps the serial, the pause, the stop and the indexes in /data when they changed. */
  async saveState() {
    const indexes = {};
    for (const [id, guard] of this.guards) {
      indexes[id] = { guard: guard.state(), daily: this.dailies.get(id)?.state() ?? null };
    }
    const kept = this.store.load();
    const state = {
      serial: this.info?.serial ?? null,
      pause: this.pause ?? null,
      authStop: this.authStop ?? null,
      indexes: { ...(kept.indexes ?? {}), ...indexes },
    };
    const key = JSON.stringify(state);
    if (key === this.savedKey) {
      return;
    }
    try {
      await this.store.save(state);
      this.savedKey = key;
    } catch (err) {
      this.logger.warn(`Saving the IMEON state in /data failed (${err?.code ?? 'error'})`);
    }
  }

  // --- Devices -----------------------------------------------------------------------

  external() {
    return this.info ? ids(this.gladys, this.info.serial) : undefined;
  }

  /** The created Gladys device of the inverter, undefined until the user creates it. */
  createdDevice() {
    const id = this.external()?.device;
    return id ? (this.gladys.devices ?? []).find((d) => d.external_id === id) : undefined;
  }

  /** The capabilities known so far, with the features of the created device (never fewer). */
  knownCapabilities(seen) {
    return mergeCapabilities(
      mergeCapabilities(this.capabilities, capabilitiesOfDevice(this.createdDevice())),
      seen,
    );
  }

  async discover() {
    if (!this.info || !this.client) {
      return;
    }
    await this.gladys
      .publishDiscoveredDevices([
        buildDevice(this.gladys, this.info, this.capabilities, this.config.address),
      ])
      .catch((err) => this.logger.warn(`Publishing the IMEON device failed: ${err.message}`));
  }

  /** The Discover tab asks: the known device, or a read now to find it. */
  async scan() {
    if (this.info && this.client) {
      await this.discover();
    } else if (this.client) {
      await this.run(this.generation, () => this.tick());
    }
  }

  async onDeviceCreated(device) {
    const external = this.external();
    if (this.client && external && device?.external_id === external.device) {
      // A new device: no reference of its indexes yet (nor a state kept in
      // /data for a deleted device of the same id), its values right away.
      const kept = this.store.load();
      for (const { key } of INDEXES) {
        const id = external.feature(key);
        this.guards.delete(id);
        this.dailies.delete(id);
        if (kept.indexes) delete kept.indexes[id];
      }
      await this.store
        .save(kept)
        .catch((err) =>
          this.logger.warn(`Clearing the IMEON index state failed (${err?.code ?? 'error'})`),
        );
      this.savedKey = undefined;
      await this.run(this.generation, () => this.tick());
    }
  }

  async onDeviceUpdated(device) {
    if (this.client && device?.external_id === this.external()?.device) {
      await this.run(this.generation, () => this.tick());
    }
  }

  // --- Reads -------------------------------------------------------------------------

  /** One read; a read still running (a slow inverter) is never doubled. */
  tick() {
    if (this.busy) {
      if (this.busyGeneration === this.generation) {
        return this.busy;
      }
      return this.busy.then(() => this.tick());
    }
    this.busyGeneration = this.generation;
    this.busy = this.doTick().finally(() => {
      this.busy = undefined;
    });
    return this.busy;
  }

  async doTick() {
    const generation = this.generation;
    const client = this.client;
    const mono = this.monotonic();
    if (!client || mono < this.nextTryAt) {
      return;
    }
    const now = this.now();
    if ((this.authStop && now < this.authStop.until) || (this.pause && now < this.pause.until)) {
      // Never a read before its time: the status shows the time left.
      await this.showWaiting();
      return;
    }
    /** A start (other settings, a stop) during an await: this read gives up. */
    const gone = () => client !== this.client || generation !== this.generation;
    let read;
    try {
      read = await this.readAll(client, mono, gone);
    } catch (err) {
      if (gone()) return;
      await this.failed(err, mono);
      return;
    }
    if (gone() || !read) {
      return;
    }
    this.failures = 0;
    this.nextTryAt = 0;
    this.lastError = undefined;
    if (this.authStop || this.pause) {
      this.authStop = undefined;
      this.pause = undefined;
    }
    const target = this.knownCapabilities(capabilitiesOf(read.pages));
    // Another serial, model or software (or the first full /data after a
    // restart that only knew the serial): the device is published again.
    const infoChanged = read.info && JSON.stringify(read.info) !== JSON.stringify(this.info);
    if (read.info) {
      this.info = read.info;
    }
    if (infoChanged || JSON.stringify(target) !== JSON.stringify(this.capabilities)) {
      this.capabilities = target;
      await this.discover();
      if (gone()) return;
    }
    this.failingPages = read.failing;
    await this.publish(read.pages);
    if (gone()) return;
    await this.saveState();
    await this.setStatus(true, this.createdDevice() ? this.okMessage() : T.noDevice);
  }

  /**
   * The reads of one poll: login when needed, `/data` at start and hourly,
   * then every page, one after the other. A session that ended is opened
   * again ONCE per poll; a page failing alone is noted, never fatal.
   */
  async readAll(client, mono, gone) {
    let relogged = false;
    const login = () => client.login(this.config.username, this.config.password);
    const withSession = async (job) => {
      try {
        return await job();
      } catch (err) {
        if (err?.code !== 'login_required' || relogged) throw err;
        relogged = true;
        await login();
        return job();
      }
    };
    if (!client.loggedIn) {
      relogged = true;
      await login();
    }
    if (gone()) return undefined;
    const failing = [];
    let info;
    if (this.dataAt === undefined || mono - this.dataAt >= DATA_INTERVAL) {
      try {
        info = await withSession(() => client.readData());
        this.dataAt = mono;
      } catch (err) {
        if (FATAL.has(err?.code) || err?.code === 'login_required' || !this.info) throw err;
        failing.push('data');
      }
      if (gone()) return undefined;
    }
    const pages = {};
    let firstError;
    for (const page of PAGES) {
      try {
        pages[page.name] = await withSession(() => client.readPage(page));
      } catch (err) {
        if (FATAL.has(err?.code) || err?.code === 'login_required') throw err;
        firstError ??= err;
        if (!page.main) failing.push(page.name);
      }
      if (gone()) return undefined;
    }
    if (!PAGES.some((p) => p.main && pages[p.name])) {
      // Not one main page: not an IMEON answer.
      throw firstError;
    }
    return { info, pages, failing };
  }

  async failed(err, mono) {
    const code = err?.code ?? 'error';
    const now = this.now();
    this.lastError = err;
    // Our own words only (ImeonError codes): never a text of the inverter.
    this.logger.warn(`IMEON read failed: ${code}${err?.status ? ` ${err.status}` : ''}`);
    if (code === 'auth_refused') {
      const count = (this.authStop?.count ?? 0) + 1;
      const wait = Math.min(AUTH_RETRY_MIN * 2 ** (count - 1), AUTH_RETRY_MAX);
      this.authStop = { until: now + wait, count };
      this.nextTryAt = mono + wait;
      await this.saveState();
      await this.setStatus(false, T.authRefused(wait, this.heldNotes()));
      return;
    }
    if (code === 'rate_limited' || code === 'server') {
      const count = (this.pause?.count ?? 0) + 1;
      const asked = err.retryAfter ?? PAUSE_MIN * 2 ** (count - 1);
      const wait = Math.min(Math.max(asked, PAUSE_MIN), PAUSE_MAX);
      this.pause = { until: now + wait, count, code, status: err.status ?? null };
      this.nextTryAt = mono + wait;
      await this.saveState();
      await this.setStatus(false, T.paused(this.config.address, err, wait, this.heldNotes()));
      return;
    }
    const wait = Math.min(RETRY_MIN * 2 ** this.failures, RETRY_MAX);
    this.failures += 1;
    this.nextTryAt = mono + wait;
    await this.setStatus(false, T.unreachable(this.config.address, err, wait, this.heldNotes()));
  }

  okMessage() {
    const notes = [];
    if (this.failingPages.length > 0) notes.push(T.notes.pages(this.failingPages));
    if (this.noIndex.length > 0) notes.push(T.notes.noIndex(this.noIndex));
    notes.push(...this.heldNotes());
    return T.ok(this.config.address, notes);
  }

  /** The indexes held back, for every status (the user must see them while waiting). */
  heldNotes() {
    const created = this.createdDevice();
    if (!created) {
      return [];
    }
    return INDEXES.flatMap(({ name, key }) => {
      const held = this.guardOf(created, this.external().feature(key)).held;
      return held ? [T.notes.held(name, held)] : [];
    });
  }

  /** The guard of an index of the created device, from Gladys and /data. */
  guardOf(created, id) {
    if (!this.guards.has(id)) {
      const saved = this.store.load().indexes?.[id];
      this.guards.set(
        id,
        new IndexGuard(lastValueOf(created, id), saved?.guard, this.now(), GUARD_LIMITS),
      );
      this.dailies.set(id, new DailyIndex(saved?.daily, DAILY_LIMITS));
    }
    return this.guards.get(id);
  }

  /** The states of a read, the indexes through their daily counter and their guard. */
  async publish(pages) {
    const created = this.createdDevice();
    if (!created) {
      return;
    }
    const external = this.external();
    const now = this.now();
    const values = {};
    this.noIndex = [];
    for (const { name, key, day } of INDEXES) {
      const id = external.feature(key);
      const guard = this.guardOf(created, id);
      const today = day(pages.energy);
      if (today === undefined) {
        // No energy page this time: the last accepted value keeps its date in Gladys.
        values[name] = guard.held ? guard.last?.value : undefined;
        continue;
      }
      const built = this.dailies.get(id).read(today, now, guard.last ?? lastValueOf(created, id));
      const total = built === undefined ? undefined : round(built, 3);
      if (total === undefined) {
        this.noIndex.push(name);
      }
      const plausible = total !== undefined && guard.accept(total, now);
      if (total !== undefined && !plausible && total > 0) {
        this.logger.warn(
          `IMEON ${name} index ${guard.held?.direction === 'down' ? 'drop' : 'jump'} held back: the "Accept the held index" button takes it`,
        );
      }
      // While a value is held, the last accepted one is sent again (no delta for the core).
      values[name] = plausible ? total : guard.held ? guard.last?.value : undefined;
    }
    const states = pollStates(external, pages, this.info, values);
    // Only the features the created device has (they are fixed at its creation).
    const features = created.features ? new Set(created.features.map((f) => f.external_id)) : null;
    const allowed = features
      ? states.filter((s) => features.has(s.device_feature_external_id))
      : states;
    if (allowed.length === 0) {
      return;
    }
    await this.gladys
      .publishChangedStates(allowed, { heartbeat: STATE_HEARTBEAT })
      .catch((err) => this.logger.warn(`Publishing the IMEON values failed: ${err.message}`));
  }

  // --- Configuration screen buttons -------------------------------------------------

  /**
   * The "Accept the held index" button: takes each value held as shown now
   * (plus what may come until the next read, src/guard.js), never anything
   * else. Answers with what will be counted.
   */
  async acceptHeldIndex() {
    const created = this.createdDevice();
    if (!created) {
      return T.accept.nothing;
    }
    const accepted = INDEXES.flatMap(({ name, key }) => {
      const taken = this.guardOf(created, this.external().feature(key)).acceptHeld();
      return taken ? [{ name, ...taken }] : [];
    });
    if (accepted.length === 0) {
      return T.accept.nothing;
    }
    for (const { name, direction } of accepted) {
      this.logger.info(
        `IMEON ${name} index ${direction === 'down' ? 'drop' : 'jump'} accepted by the user`,
      );
    }
    // Published at the next read, which comes now (unless a pause or a stop runs).
    this.firstRun = this.run(this.generation, () => this.tick());
    return T.accept.done(accepted);
  }

  /** The test button: log in and read the `/data` page once. */
  async testConnection() {
    if (!this.client) {
      return this.config.invalidAddress ? T.badAddress : T.incomplete;
    }
    const waiting = this.authStop && this.now() < this.authStop.until;
    const paused = this.pause && this.now() < this.pause.until;
    if (waiting || paused) {
      // A click never makes a request the pause or the stop forbids.
      return this.waitingMessage();
    }
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve(T.test.slow), TEST_ANSWER_WITHIN);
    });
    try {
      return await Promise.race([this.check(), late]);
    } finally {
      this.timers.clearTimeout(timer);
    }
  }

  async check() {
    const client = this.client;
    const mono = this.monotonic();
    try {
      if (!client.loggedIn) {
        await client.login(this.config.username, this.config.password);
      }
      let info;
      try {
        info = await client.readData();
      } catch (err) {
        if (err?.code !== 'login_required') throw err;
        await client.login(this.config.username, this.config.password);
        info = await client.readData();
      }
      if (client === this.client) {
        // A good answer ends the retry delay: the next tick reads it.
        this.failures = 0;
        this.nextTryAt = 0;
        this.lastError = undefined;
      }
      return T.test.ok(info);
    } catch (err) {
      if (
        client === this.client &&
        ['auth_refused', 'rate_limited', 'server'].includes(err?.code)
      ) {
        // The same rules as a read: a refusal stops, a 429/5xx pauses.
        await this.failed(err, mono);
        return this.waitingMessage();
      }
      return T.unreachable(this.config.address, err, RETRY_MIN);
    }
  }
}
