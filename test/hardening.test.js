// Adversary checks added with v0.20.0: parallel passcode guessing (audit #5), the owner getting past the "everyone" lock (#10),
// what /api/health tells strangers (#11), cross-site GETs that run jobs, sign out everywhere (#13), duplicate bot orders (#4) and
// the evening run catch-up (#8). Sign-out-everywhere changes this process's state, so it runs last and lives in its own file.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { signedOut, fakeFetch, req, PASS, setEnv, CRON, status } from './helpers.js';
import { authorized, sessionToken, SESSION } from '../lib/core.js';
import { _resetGuard, GUARD } from '../lib/authguard.js';
import { recentlyOrdered, ppostSure, timedOut } from '../lib/trade.js';
import { planTick } from '../lib/schedule.js';
import * as router from '../api/router.js';
import * as session from '../routes/session.js';

let net;
beforeEach(() => { signedOut(); _resetGuard(); net = fakeFetch(); });
afterEach(() => net.restore());
const cookieOf = (t) => ({ cookie: `${SESSION.cookie}=${t.value}` });
const guess = (ip, passcode = 'wrong', headers = {}) => session.POST(req('/api/session', { method: 'POST', headers: { 'x-real-ip': ip, ...headers }, body: { passcode } }));

test(`parallel guesses from one device: at most ${GUARD.ipMax} passcodes are checked`, async () => {
  const codes = (await Promise.all(Array.from({ length: 20 }, (_, i) => guess('203.0.113.50', 'guess' + i)))).map(r => r.status);
  assert.ok(codes.filter(c => c === 401).length <= GUARD.ipMax - 1, codes.join(','));
  assert.equal(codes.filter(c => c !== 429).length <= GUARD.ipMax, true, codes.join(','));
  assert.equal((await guess('203.0.113.50', PASS)).status, 429, 'locked even for the right passcode');
});

test('a right passcode does not count toward the lock', async () => {
  for (let i = 0; i < GUARD.ipMax * 2; i++) assert.equal((await guess('203.0.113.60', PASS)).status, 200);
});

test('the "everyone" lock stops strangers but not a device that was signed in before', async () => {
  await Promise.all(Array.from({ length: GUARD.allMax }, (_, i) => guess(`198.51.100.${i + 1}`)));
  assert.equal((await guess('192.0.2.7', PASS)).status, 429, 'a new device is locked out');
  const expired = sessionToken(Date.now() - (SESSION.days + 2) * 864e5);
  assert.equal((await guess('192.0.2.8', PASS, cookieOf(expired))).status, 200, 'the owner\'s phone (cookie expired 2 days ago) still signs in');
  const ancient = sessionToken(Date.now() - (SESSION.days + GUARD.graceDays + 1) * 864e5);
  assert.equal((await guess('192.0.2.9', PASS, cookieOf(ancient))).status, 429, 'a cookie older than the grace period does not help');
  assert.equal(authorized(req('/', { headers: cookieOf(expired) }), { strict: true }), false, 'an expired cookie still unlocks nothing by itself');
});

test('health tells a stranger nothing about the passcode or the bots', async () => {
  const { GET } = await import('../routes/health.js');
  const out = await (await GET(req('/api/health'))).json();
  for (const k of ['passStrong', 'botPaused', 'jev', 'cryptoSwing', 'trading']) assert.equal(out[k], undefined, k);
  const mine = await (await GET(req('/api/health', { headers: cookieOf(sessionToken()) }))).json();
  assert.equal(typeof mine.passStrong, 'boolean');
});

test('router refuses cross-site GETs that run something', async () => {
  for (const p of ['bot&run=1', 'hist&run=1', 'bot-check&dry=1']) {
    const r = await router.GET(req(`/api/router?__p=${p}`, { headers: { 'sec-fetch-site': 'cross-site' } }));
    assert.equal(r.status, 403, p);
  }
  assert.equal((await router.GET(req('/api/router?__p=health', { headers: { 'sec-fetch-site': 'cross-site' } }))).status, 200, 'plain reads still work');
});

test('duplicate check: a live order with the same id stands the second run down; canceled ones do not count', async () => {
  net.restore(); net = fakeFetch({ 'paper-api.alpaca.markets/v2/orders': [{ client_order_id: 'tbbot-20261008-AAPL-x', status: 'new' }, { client_order_id: 'tbbot-20261008-MSFT-x', status: 'canceled' }] });
  assert.equal(await recentlyOrdered('AAPL', 'tbbot-20261008-AAPL-'), true);
  assert.equal(await recentlyOrdered('MSFT', 'tbbot-20261008-MSFT-'), false);
  assert.equal(await recentlyOrdered('BTC/USD', /^tbdca-\d{10}-BTCUSD-b-/), false);
  assert.match(net.calls[0].url, /symbols=AAPL&after=/);
});

test('evening run: caught up once after 7 PM when the backup tick comes late', () => {
  const summer = Date.parse('2026-07-15T00:40:00Z'), winter = Date.parse('2026-12-16T00:40:00Z'); // the backup: 8:40 PM EDT / 7:40 PM EST
  assert.equal(planTick(summer, null, { step: 60, eveningDone: false }).crypto, 'evening', 'summer backup catches up');
  assert.equal(planTick(summer, null, { step: 60, eveningDone: true }).crypto, 'check', 'already done today: not twice');
  assert.equal(planTick(summer, null, { step: 60, eveningDone: null }).crypto, 'check', 'unknown: only the usual window');
  assert.equal(planTick(winter, null, { step: 60, eveningDone: null }).crypto, 'evening', 'winter backup is in the window');
  assert.equal(planTick(Date.parse('2026-07-15T22:00:00Z'), null, { step: 15, eveningDone: false }).crypto, 'check', 'not before 7 PM');
});

test('the session cookie outlives the 7-day session by the grace period (so the owner\'s device can pass the everyone lock)', async () => {
  const c = (await guess('192.0.2.30', PASS)).headers.get('set-cookie');
  assert.ok(+/Max-Age=(\d+)/.exec(c)[1] >= (SESSION.days + GUARD.graceDays) * 86400, c);
});

test('a stranger\'s requests never read Blob', async () => {
  setEnv({ DASH_PASSCODE: PASS, CRON_SECRET: CRON, BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_STORE3_testsecret' });
  const real = Date.now; let t = real();
  try { for (let i = 0; i < 50; i++) { Date.now = () => (t += 31 * 6e4); await router.GET(req('/api/router?__p=health')); } } finally { Date.now = real; }
  assert.equal(net.calls.filter(c => c.url.includes('blob.vercel-storage.com')).length, 0);
});

test('evening marker is dated by when the run started', async () => {
  setEnv({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_STORE4_testsecret' });
  net.restore(); net = fakeFetch({ 'store4.public.blob.vercel-storage.com/control/last.json': {}, 'vercel.com/api/blob': {} });
  const { saveLastRun } = await import('../lib/control.js');
  await saveLastRun({ slot: 'cx', level: 1 }, Date.parse('2026-10-09T03:55:00Z')); // 11:55 PM EDT on Oct 8
  assert.equal(JSON.parse(net.calls.find(c => c.method === 'PUT').body).evening, '2026-10-08');
});

test('an exit sell that timed out still reports the timeout when the retry is refused (no close-all fallback)', async () => {
  let n = 0;
  net.restore(); net = fakeFetch({ 'paper-api.alpaca.markets/v2/orders': () => { if (n++ === 0) { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e; } return status(403, { message: 'insufficient qty available for order' }); } });
  const err = await ppostSure('/v2/orders', { symbol: 'AAPL', qty: 1, side: 'sell', type: 'market', client_order_id: 'tbbot-x-exit' }).catch(e => e);
  assert.equal(timedOut(err), true, 'the caller must treat it as maybe sent');
  assert.equal(n, 2);
});

test('sign out everywhere: every earlier session stops working, new ones work', async () => {
  setEnv({ DASH_PASSCODE: PASS, CRON_SECRET: CRON, BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_STORE2_testsecret' });
  net.restore(); net = fakeFetch({ 'vercel.com/api/blob': {} });
  const old = sessionToken(Date.now() - 5000), other = sessionToken(Date.now() - 2000);
  assert.equal((await session.DELETE(req('/api/session?all=1', { method: 'DELETE' }))).status, 401, 'needs a signed-in device');
  const r = await session.DELETE(req('/api/session?all=1', { method: 'DELETE', headers: cookieOf(old) }));
  assert.equal(r.status, 200);
  assert.equal(net.calls.filter(c => c.method === 'PUT').length, 1, 'the cut-off is saved');
  for (const t of [old, other]) assert.equal(authorized(req('/', { headers: cookieOf(t) }), { strict: true }), false);
  const mine = /=([^;]+)/.exec(r.headers.get('set-cookie'))[1];
  assert.equal(authorized(req('/', { headers: cookieOf({ value: mine }) }), { strict: true }), true, 'the device that pressed it stays signed in (and keeps its everyone-lock grace)');
  assert.equal((await r.json()).authorized, true);
  assert.equal(authorized(req('/', { headers: cookieOf(sessionToken()) }), { strict: true }), true);
});
