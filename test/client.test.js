// -----------------------------------------------------------------------------
// The HTTP client against a fake inverter: login, session, errors, bounds,
// spacing. No network.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGES } from '../src/constants.js';
import { ImeonClient } from '../src/imeon/client.js';
import { createFetch, refusedError, timeoutError } from './helpers/fakeFetch.js';
import { ADDRESS, COOKIE, PASSWORD, SERIAL, USERNAME, json, routes } from './fixtures/imeon.js';

const page = (name) => PAGES.find((p) => p.name === name);

function client(fake, extra = {}) {
  return new ImeonClient({ address: ADDRESS, fetchImpl: fake.fetch, spacing: 0, ...extra });
}

test('login: the form of the library, the cookie kept and sent back', async () => {
  const fake = createFetch(routes());
  const c = client(fake);
  assert.equal(c.loggedIn, false);
  await c.login(USERNAME, PASSWORD);
  assert.equal(c.loggedIn, true);
  const [login] = fake.calls;
  assert.equal(login.url, `http://${ADDRESS}/login`);
  assert.equal(login.init.method, 'POST');
  assert.equal(login.init.redirect, 'manual');
  assert.equal(login.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(login.init.body)), {
    do_login: 'True',
    email: USERNAME,
    passwd: PASSWORD,
  });
  assert.equal(login.headers['User-Agent'], undefined, 'no User-Agent of ours');
  const data = await c.readData();
  assert.equal(data.serial, SERIAL);
  assert.equal(fake.calls[1].headers.Cookie, COOKIE);
  const battery = await c.readPage(page('battery'));
  assert.equal(battery.soc, 78);
  assert.deepEqual(fake.calls[2].query, { time: 'minute' });
  await c.readPage(page('grid'));
  assert.deepEqual(fake.calls[3].query, { time: 'minute', threephase: 'true' });
});

test('login refused, or not an IMEON answer', async () => {
  const refused = client(createFetch(routes({ granted: false })));
  await assert.rejects(refused.login(USERNAME, PASSWORD), { code: 'auth_refused' });
  assert.equal(refused.loggedIn, false);
  const r = routes();
  r['/login'] = () => json({}, { status: 403 });
  await assert.rejects(client(createFetch(r)).login(USERNAME, PASSWORD), { code: 'auth_refused' });
  r['/login'] = () => new Response('<html>', { headers: { 'content-type': 'text/html' } });
  await assert.rejects(client(createFetch(r)).login(USERNAME, PASSWORD), {
    code: 'unknown_answer',
  });
  r['/login'] = () => json({ hello: 1 });
  await assert.rejects(client(createFetch(r)).login(USERNAME, PASSWORD), {
    code: 'unknown_answer',
  });
});

test('a session that ended: login_required, the session dropped', async () => {
  const r = routes();
  const fake = createFetch(r);
  const c = client(fake);
  await c.login(USERNAME, PASSWORD);
  r['/api/battery'] = () => new Response('<html>', { headers: { 'content-type': 'text/html' } });
  await assert.rejects(c.readPage(page('battery')), { code: 'login_required' });
  assert.equal(c.loggedIn, false);
  await assert.rejects(c.readData(), { code: 'login_required' }, 'never a call without a session');
  await c.login(USERNAME, PASSWORD);
  r['/data'] = () => new Response('', { status: 302, headers: { location: '/login' } });
  await assert.rejects(c.readData(), { code: 'login_required' });
});

test('errors in our words: 429 with Retry-After, 5xx, timeout, refused, too large', async () => {
  const r = routes();
  const c = client(createFetch(r));
  await c.login(USERNAME, PASSWORD);
  r['/data'] = () => json({}, { status: 429, headers: { 'retry-after': '120' } });
  await assert.rejects(c.readData(), (err) => {
    assert.equal(err.code, 'rate_limited');
    assert.equal(err.retryAfter, 120_000);
    return true;
  });
  r['/data'] = () => json({}, { status: 503 });
  await assert.rejects(c.readData(), { code: 'server', status: 503 });
  r['/data'] = () => json({}, { status: 404 });
  await assert.rejects(c.readData(), { code: 'http', status: 404 });
  r['/data'] = () => {
    throw timeoutError();
  };
  await assert.rejects(c.readData(), { code: 'timeout' });
  r['/data'] = () => {
    throw refusedError();
  };
  await assert.rejects(c.readData(), { code: 'unreachable' });
  r['/data'] = () => json({ serial: 'x'.repeat(300 * 1024) });
  await assert.rejects(c.readData(), { code: 'too_large' });
  r['/data'] = () => new Response('{not json', { headers: { 'content-type': 'application/json' } });
  await assert.rejects(c.readData(), { code: 'not_data' });
  r['/data'] = () => json({ serial: '../etc' });
  await assert.rejects(c.readData(), { code: 'unknown_answer' });
  r['/api/battery'] = () => json({ result: '{"soc": "x"}' });
  await assert.rejects(c.readPage(page('battery')), { code: 'unknown_answer' });
});

test('no error ever carries the password, the cookie or a URL', async () => {
  const r = routes();
  const c = client(createFetch(r));
  await c.login(USERNAME, PASSWORD);
  const errors = [];
  for (const handler of [
    () => json({}, { status: 500 }),
    () => {
      throw refusedError();
    },
    () => new Response('<html>secret page</html>', { headers: { 'content-type': 'text/html' } }),
  ]) {
    r['/data'] = handler;
    await c.readData().catch((err) => errors.push(err));
    await c.login(USERNAME, PASSWORD);
  }
  assert.equal(errors.length, 3);
  for (const err of errors) {
    const text = `${err.message} ${JSON.stringify(err)}`;
    for (const secret of [PASSWORD, COOKIE, ADDRESS, 'secret page', 'http']) {
      assert.ok(!text.includes(secret), `${err.code}: ${secret}`);
    }
  }
});

test('requests one after the other, 1.2 s apart, as the library', async () => {
  let mono = 0;
  const waits = [];
  const fake = createFetch(routes());
  const c = new ImeonClient({
    address: ADDRESS,
    fetchImpl: fake.fetch,
    monotonic: () => mono,
    sleep: async (ms) => {
      waits.push(ms);
      mono += ms;
    },
  });
  await c.login(USERNAME, PASSWORD);
  mono += 200;
  await Promise.all([c.readData(), c.readPage(page('battery'))]);
  assert.deepEqual(waits, [1000, 1200]);
});
