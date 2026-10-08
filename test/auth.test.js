// Adversary checks on sign-in: forged, expired and tampered sessions, the daily market-data key, cross-site requests,
// passcode lockout, and that every route refuses a stranger before touching any outside service.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { setEnv, signedOut, fakeFetch, req, PASS, CRON } from './helpers.js';
import { authorized, sessionToken, sessionOf, gateFor, cronOk, SESSION } from '../lib/core.js';
import { _resetGuard, GUARD } from '../lib/authguard.js';
import * as router from '../api/router.js';

const cookie = (v) => ({ cookie: `${SESSION.cookie}=${v}` });
let net;
beforeEach(() => { signedOut(); _resetGuard(); net = fakeFetch(); });
afterEach(() => net.restore());

test('no passcode set: market data open, account locked', () => {
  setEnv({});
  assert.equal(authorized(req('/api/quotes')), true);
  assert.equal(authorized(req('/api/account'), { strict: true }), false);
});

test('a real session cookie signs in; forged, tampered, expired and padded ones do not', () => {
  const { value } = sessionToken();
  assert.ok(sessionOf(req('/', { headers: cookie(value) })));
  const [exp, nonce, sig] = value.split('.');
  const bad = {
    forged: `${exp}.${nonce}.${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`,
    'longer expiry': `${+exp + 86400}.${nonce}.${sig}`,
    'other nonce': `${exp}.${nonce[0] === 'x' ? 'y' : 'x'}${nonce.slice(1)}.${sig}`,
    'extra segment': `${value}.x`,
    expired: sessionToken(Date.now() - (SESSION.days + 1) * 864e5).value,
    empty: '',
  };
  for (const [name, v] of Object.entries(bad)) assert.equal(authorized(req('/', { headers: cookie(v) }), { strict: true }), false, name);
});

test('changing the passcode or the cron secret signs every device out', () => {
  const { value } = sessionToken();
  process.env.DASH_PASSCODE = PASS + '!';
  assert.equal(authorized(req('/', { headers: cookie(value) }), { strict: true }), false);
  signedOut(); process.env.CRON_SECRET = CRON + 'x';
  assert.equal(authorized(req('/', { headers: cookie(value) }), { strict: true }), false);
});

test('the market-data key unlocks market data only, and only today or yesterday', () => {
  const g = { [SESSION.gateHeader]: gateFor() };
  assert.equal(authorized(req('/api/quotes', { headers: g })), true);
  assert.equal(authorized(req('/api/account', { headers: g }), { strict: true }), false);
  assert.equal(authorized(req('/api/quotes', { headers: { [SESSION.gateHeader]: gateFor('2001-01-01') } })), false);
});

test('cron secret: exact Bearer match only, and never when unset', () => {
  assert.equal(cronOk(req('/', { headers: { authorization: `Bearer ${CRON}` } })), true);
  for (const a of [CRON, `Bearer ${CRON} `.trim() + 'x', `bearer ${CRON}`, 'Bearer ']) assert.equal(cronOk(req('/', { headers: { authorization: a } })), false, a);
  process.env.CRON_SECRET = '';
  assert.equal(cronOk(req('/', { headers: { authorization: 'Bearer ' } })), false);
});

test('router refuses cross-site POST and DELETE', async () => {
  const cases = [{ 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }, { origin: 'https://evil.test' }, { origin: 'not a url' }];
  for (const headers of cases) for (const method of ['POST', 'DELETE']) {
    const r = await router[method](req('/api/router?__p=order', { method, headers, body: method === 'POST' ? {} : undefined }));
    assert.equal(r.status, 403, `${method} ${JSON.stringify(headers)}`);
  }
});

test('router: unknown names and the router itself are 404, missing methods 405', async () => {
  assert.equal((await router.GET(req('/api/router?__p=nope'))).status, 404);
  assert.equal((await router.GET(req('/api/router?__p=router'))).status, 404);
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) assert.equal((await router.GET(req(`/api/router?__p=${name}`))).status, 404, name);
  assert.equal((await router.DELETE(req('/api/router?__p=quotes', { method: 'DELETE' }))).status, 405);
});

test('every route refuses a stranger before calling any outside service', async () => {
  const open = new Set(['health', 'session']); // health answers true/false only; session is the sign-in itself
  for (const f of readdirSync(new URL('../routes/', import.meta.url))) {
    const name = f.replace(/\.js$/, ''); if (open.has(name)) continue;
    const mod = await import(`../routes/${f}`);
    for (const method of ['GET', 'POST', 'DELETE']) {
      if (!mod[method]) continue;
      const r = await mod[method](req(`/api/${name}?run=1`, { method, body: method === 'POST' ? { symbol: 'AAPL', qty: 1, side: 'buy' } : undefined }));
      assert.equal(r.status, 401, `${method} /api/${name} should be 401 without sign-in, got ${r.status}`);
    }
  }
  assert.deepEqual(net.calls, [], 'no network call without sign-in');
});

test('the market-data key opens no account, order or bot route', async () => {
  // Public market-data GETs: the daily key is enough by design (lib/core.js). Everything else must still say 401.
  const market = new Set(['bars', 'benchmark', 'brief', 'crypto', 'intraday', 'longterm', 'macro', 'news', 'options', 'quotes', 'swing', 'symbols']);
  const open = new Set(['health', 'session']), headers = { [SESSION.gateHeader]: gateFor() };
  for (const f of readdirSync(new URL('../routes/', import.meta.url))) {
    const name = f.replace(/\.js$/, ''); if (open.has(name)) continue;
    const mod = await import(`../routes/${f}`);
    for (const method of ['GET', 'POST', 'DELETE']) {
      if (!mod[method] || (method === 'GET' && market.has(name))) continue;
      const r = await mod[method](req(`/api/${name}?run=1`, { method, headers, body: method === 'POST' ? { symbol: 'AAPL', qty: 1, side: 'buy' } : undefined }));
      assert.equal(r.status, 401, `${method} /api/${name} must need a signed-in device, not just the market-data key`);
    }
  }
  assert.deepEqual(net.calls, [], 'no network call with only the market-data key');
});

test('health never leaks values and locks every probe', async () => {
  const { GET } = await import('../routes/health.js');
  const j = await (await GET(req('/api/health'))).json();
  const text = JSON.stringify(j);
  for (const secret of [PASS, CRON, 'PKTEST', 'sk-test']) assert.ok(!text.includes(secret), 'health must not echo ' + secret.slice(0, 3));
  assert.equal(j.authorized, false); assert.equal(j.trading, undefined);
  assert.equal((await GET(req('/api/health?probe=store'))).status, 401);
});

test('sign-in: wrong passcode 401, right one sets a locked-down cookie', async () => {
  const { POST } = await import('../routes/session.js');
  assert.equal((await POST(req('/api/session', { method: 'POST', body: { passcode: 'nope' } }))).status, 401);
  assert.equal((await POST(req('/api/session', { method: 'POST', body: { passcode: [PASS] } }))).status, 401);
  const ok = await POST(req('/api/session', { method: 'POST', body: { passcode: PASS } }));
  assert.equal(ok.status, 200);
  const c = ok.headers.get('set-cookie');
  for (const part of [`${SESSION.cookie}=`, 'HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(c.includes(part), part);
  assert.equal(authorized(req('/', { headers: { cookie: c.split(';')[0] } }), { strict: true }), true);
});

test('sign-in refuses to run without a cron secret (sessions would be weak)', async () => {
  const { POST } = await import('../routes/session.js');
  process.env.CRON_SECRET = '';
  assert.equal((await POST(req('/api/session', { method: 'POST', body: { passcode: PASS } }))).status, 400);
});

test(`lockout: ${GUARD.ipMax} wrong passcodes lock that device, even for the right one`, async () => {
  const { POST } = await import('../routes/session.js');
  const from = { 'x-real-ip': '203.0.113.9' };
  const codes = [];
  for (let i = 0; i < GUARD.ipMax; i++) codes.push((await POST(req('/api/session', { method: 'POST', headers: from, body: { passcode: 'guess' + i } }))).status);
  assert.deepEqual(codes, [...Array(GUARD.ipMax - 1).fill(401), 429]);
  assert.equal((await POST(req('/api/session', { method: 'POST', headers: from, body: { passcode: PASS } }))).status, 429);
  assert.equal((await POST(req('/api/session', { method: 'POST', headers: { 'x-real-ip': '198.51.100.1' }, body: { passcode: PASS } }))).status, 200, 'other devices still sign in');
});
