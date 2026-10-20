// -----------------------------------------------------------------------------
// The local HTTP API of an IMEON inverter (the "API module" of OS One), plain
// HTTP on the home network, no cloud, after imeon_inverter_api (Imeon Energy,
// Apache-2.0, see THIRD_PARTY_NOTICES.md):
// - POST /login (form: do_login, email, passwd) answers { accessGranted }
//   and a session cookie;
// - GET /data (serial, model, limits) and GET /api/<page>?time=minute, with
//   that cookie; an answer that is not JSON means the session ended (the
//   inverter shows its login page).
// The library waits 1.2 s between two requests (the inverter is slow): so do
// we. Read-only: the settings endpoint of the library (api/set) is never called.
//
// Errors carry our own words and codes, never a text of the inverter, never
// the password, the cookie or a URL.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, MAX_BODY_BYTES, PATHS, REQUEST_SPACING } from '../constants.js';
import { PARSERS, hasValues, parseData, resultOf } from './model.js';

export class ImeonError extends Error {
  /**
   * @param {'timeout'|'unreachable'|'http'|'server'|'rate_limited'|'too_large'|'not_data'|
   *   'unknown_answer'|'auth_refused'|'login_required'} code
   */
  constructor(code, { status, retryAfter } = {}) {
    super(code);
    this.name = 'ImeonError';
    this.code = code;
    this.status = status;
    /** ms, from a Retry-After header (429, 503), when given. */
    this.retryAfter = retryAfter;
  }
}

/** A network failure (while connecting or while reading the body), in our words. */
function networkError(err) {
  if (err instanceof ImeonError) {
    return err;
  }
  const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
  return new ImeonError(timeout ? 'timeout' : 'unreachable');
}

/** The body, read up to `limit` bytes: a longer one is not an IMEON answer. */
async function readBounded(response, limit) {
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new ImeonError('too_large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/** Retry-After in seconds (or an HTTP date) -> ms, undefined when absent or odd. */
function retryAfterOf(response, now) {
  const raw = response.headers?.get?.('retry-after');
  if (!raw) {
    return undefined;
  }
  if (/^\d{1,9}$/.test(raw.trim())) {
    return Number(raw.trim()) * 1000;
  }
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - now()) : undefined;
}

const COOKIE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}=[A-Za-z0-9!#$%&'()*+./:<>?@[\]^_`{|}~-]{0,512}$/;

/** The `name=value` pairs of the Set-Cookie headers, checked (never sent back if odd). */
function cookiesOf(response) {
  const headers = response.headers;
  const list =
    typeof headers?.getSetCookie === 'function'
      ? headers.getSetCookie()
      : [headers?.get?.('set-cookie')].filter(Boolean);
  return list
    .slice(0, 10)
    .map((line) => String(line).split(';')[0].trim())
    .filter((pair) => COOKIE.test(pair));
}

const isJson = (response) =>
  String(response.headers?.get?.('content-type') ?? '')
    .toLowerCase()
    .includes('application/json');

export class ImeonClient {
  constructor({
    address,
    fetchImpl = (...args) => globalThis.fetch(...args),
    timeout = HTTP_TIMEOUT,
    spacing = REQUEST_SPACING,
    monotonic = () => performance.now(),
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }) {
    this.address = address;
    this.fetch = fetchImpl;
    this.timeout = timeout;
    this.spacing = spacing;
    this.monotonic = monotonic;
    this.now = now;
    this.sleep = sleep;
    /** The session cookie (`a=b; c=d`), '' without one; undefined when not logged in. */
    this.session = undefined;
    /** The number of logins granted so far (a new one is a new session). */
    this.sessionId = 0;
    this.lastRequestAt = undefined;
    /** Requests one after the other, never two at once (the inverter is slow). */
    this.queue = Promise.resolve();
  }

  get loggedIn() {
    return this.session !== undefined;
  }

  /** The session is over (its answer was the login page): the next read logs in again. */
  logout() {
    this.session = undefined;
  }

  /** One request, spaced from the previous one; its status, headers and bounded body. */
  request(path, init) {
    const run = async () => {
      if (this.lastRequestAt !== undefined && this.spacing > 0) {
        const wait = this.spacing - (this.monotonic() - this.lastRequestAt);
        if (wait > 0) {
          await this.sleep(wait);
        }
      }
      try {
        const response = await this.fetch(`http://${this.address}${path}`, {
          ...init,
          // A redirect is never followed: the requests stay on this address.
          redirect: 'manual',
          signal: AbortSignal.timeout(this.timeout),
        });
        // The body can fail too (timeout, connection cut): same errors.
        const text = await readBounded(response, MAX_BODY_BYTES);
        return { response, text };
      } catch (err) {
        throw networkError(err);
      } finally {
        this.lastRequestAt = this.monotonic();
      }
    };
    const job = this.queue.then(run, run);
    this.queue = job.catch(() => {});
    return job;
  }

  /** The HTTP status in our words: 429 and 5xx apart (a pause), anything else not 2xx. */
  checkStatus(response) {
    const status = response.status;
    if (status === 429 || status >= 500) {
      throw new ImeonError(status === 429 ? 'rate_limited' : 'server', {
        status,
        retryAfter: retryAfterOf(response, this.now),
      });
    }
  }

  /** POST /login. Resolves when the inverter grants access; `auth_refused` otherwise. */
  async login(username, password) {
    this.session = undefined;
    const body = new URLSearchParams({ do_login: 'True', email: username, passwd: password });
    const { response, text } = await this.request(PATHS.LOGIN, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    this.checkStatus(response);
    if (response.status === 401 || response.status === 403) {
      throw new ImeonError('auth_refused', { status: response.status });
    }
    if (response.status < 200 || response.status >= 300) {
      throw new ImeonError('http', { status: response.status });
    }
    let answer;
    try {
      answer = JSON.parse(text);
    } catch {
      // No JSON at /login: not an IMEON inverter, or its API module is off.
      throw new ImeonError('unknown_answer');
    }
    if (answer === null || typeof answer !== 'object' || !Object.hasOwn(answer, 'accessGranted')) {
      throw new ImeonError('unknown_answer');
    }
    if (answer.accessGranted !== true) {
      throw new ImeonError('auth_refused');
    }
    this.session = cookiesOf(response).join('; ');
    // Each session counts: the app confirms the serial again after every login.
    this.sessionId += 1;
  }

  /** GET of a page with the session: its JSON, or `login_required` when the session ended. */
  async getJson(path, query = {}) {
    if (!this.loggedIn) {
      throw new ImeonError('login_required');
    }
    const search = new URLSearchParams(query).toString();
    const headers = { Accept: 'application/json' };
    if (this.session) {
      headers.Cookie = this.session;
    }
    const { response, text } = await this.request(`${path}${search ? `?${search}` : ''}`, {
      method: 'GET',
      headers,
    });
    this.checkStatus(response);
    const status = response.status;
    if (status === 401 || status === 403 || (status >= 300 && status < 400)) {
      this.logout();
      throw new ImeonError('login_required', { status });
    }
    if (status < 200 || status >= 300) {
      throw new ImeonError('http', { status });
    }
    if (!isJson(response)) {
      // The library's own test: anything but JSON is the login page.
      this.logout();
      throw new ImeonError('login_required');
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new ImeonError('not_data');
    }
  }

  /** The `/data` page: serial, model, software, limits. */
  async readData() {
    const data = parseData(await this.getJson(PATHS.DATA));
    if (!data) {
      throw new ImeonError('unknown_answer');
    }
    return data;
  }

  /** One `/api/<page>` (src/constants.js PAGES), parsed. */
  async readPage(page) {
    const result = resultOf(await this.getJson(page.path, page.query));
    if (!result) {
      throw new ImeonError('unknown_answer');
    }
    const values = PARSERS[page.name](result);
    if (!hasValues(values)) {
      throw new ImeonError('unknown_answer');
    }
    return values;
  }
}
