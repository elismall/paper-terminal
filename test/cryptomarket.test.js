// The Crypto tab's whole-market list (routes/crypto.js ?all=1, v0.19.0) with Alpaca's answers faked: every listed USD coin
// comes back once with its name, pages are followed to the end, swing plays are left out, and without keys it falls back to
// the bot's coins without asking the trading API. Read-only: no order endpoint is ever called.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setEnv, signedOut, fakeFetch, req } from './helpers.js';
import { CRYPTO_UNIVERSE, PACE } from '../lib/core.js';
import { GET, _resetMarket } from '../routes/crypto.js';

const EXTRA = ['PEPE/USD', 'ONDO/USD'];
const assets = [...CRYPTO_UNIVERSE, ...EXTRA].map(s => ({ symbol: s, name: `${s === 'PEPE/USD' ? 'Pepe' : s.replace('/USD', '')} / US Dollar`, tradable: true }))
  .concat([{ symbol: 'BTC/USDT', name: 'Bitcoin / USD Tether', tradable: true }, { symbol: 'OLD/USD', name: 'Gone', tradable: false }]);
const symsOf = (url) => decodeURIComponent(new URL(url).searchParams.get('symbols')).split(',');
// Hourly and daily bars, split over two pages by coin (Alpaca shares a page across coins); price 10 rising to 12, PEPE trades most.
function barsPage(url) {
  const u = new URL(url), syms = symsOf(url), hourly = u.searchParams.get('timeframe') === '1Hour', half = Math.ceil(syms.length / 2);
  const mine = u.searchParams.get('page_token') === 'p2' ? syms.slice(half) : syms.slice(0, half), n = hourly ? 50 : 35;
  const bars = Object.fromEntries(mine.map(s => [s, Array.from({ length: n }, (_, i) => ({ t: new Date(Date.now() - (n - i) * (hourly ? 36e5 : 864e5)).toISOString(), c: 10 + 2 * i / (n - 1), v: s === 'PEPE/USD' ? 1e9 : 100 }))]));
  return { bars, next_page_token: u.searchParams.get('page_token') ? null : 'p2' };
}
const snaps = (url) => ({ snapshots: Object.fromEntries(symsOf(url).map(s => [s, { latestTrade: { p: 12, t: new Date().toISOString() }, dailyBar: { c: 12 }, prevDailyBar: { c: 11 } }])) });
let net;
beforeEach(() => { setEnv({ ALPACA_KEY_ID: 'PKTEST', ALPACA_SECRET_KEY: 'sk-test' }); _resetMarket(); });
afterEach(() => net.restore());

test('whole market: every tradable USD coin, named, biggest volume first, no plays', async () => {
  net = fakeFetch({ '/v2/assets': assets, '/crypto/us/snapshots': snaps, '/crypto/us/bars': barsPage });
  const r = await GET(req('/api/crypto?all=1'));
  assert.equal(r.status, 200);
  const j = await r.json(), syms = j.board.map(x => x.s);
  assert.deepEqual([...syms].sort(), [...CRYPTO_UNIVERSE, ...EXTRA].sort(), 'every USD coin once; USDT pairs and untradable coins left out');
  assert.equal(j.board[0].s, 'PEPE/USD'); assert.equal(j.board[0].n, 'Pepe');
  assert.equal(j.board.find(x => x.s === 'ONDO/USD').bot, false); assert.equal(j.board.find(x => x.s === 'BTC/USD').bot, true);
  for (const x of j.board) { assert.ok(x.chg24 > 0 && x.d7 > 0 && x.d30 > 0 && x.spark.length === 48, `${x.s} has both pages of bars`); }
  assert.equal(j.plays, undefined);
  assert.ok(net.calls.every(c => c.method === 'GET' && !c.url.includes('/v2/orders')), 'reads only');
});

test('whole market without keys: the bot coins, and the trading API is never asked', async () => {
  setEnv({});
  net = fakeFetch({ '/crypto/us/snapshots': snaps, '/crypto/us/bars': barsPage });
  const j = await (await GET(req('/api/crypto?all=1'))).json();
  assert.deepEqual(j.board.map(x => x.s).sort(), [...CRYPTO_UNIVERSE].sort());
  assert.match(j.note, /Alpaca keys/);
  assert.ok(!net.calls.some(c => c.url.includes('/v2/assets')));
});

test('whole market needs the market-data key once a passcode is set', async () => {
  signedOut(); net = fakeFetch({});
  assert.equal((await GET(req('/api/crypto?all=1'))).status, 401);
  assert.deepEqual(net.calls, []);
});

test('whole market downloads once a minute per instance and refuses cache-busting copies', async () => {
  net = fakeFetch({ '/v2/assets': assets, '/crypto/us/snapshots': snaps, '/crypto/us/bars': barsPage });
  const [a, b] = await Promise.all([GET(req('/api/crypto?all=1')), GET(req('/api/crypto?all=1'))]);
  assert.equal((await a.json()).board.length, (await b.json()).board.length);
  assert.equal((await GET(req('/api/crypto?all=1&z=1'))).status, 400);
  assert.equal(net.calls.filter(c => c.url.includes('/v2/assets')).length, 1);
  assert.equal(net.calls.filter(c => c.url.includes('/crypto/us/bars')).length, 4, 'two pages per timeframe, once');
});

test('a download cut short never shows partial bars as complete', async () => {
  // Endless pages, one coin each: the page cap or the deadline stops it, and XRP comes back without its newest hours.
  let k = 0;
  const endless = (url) => { const syms = symsOf(url), hourly = new URL(url).searchParams.get('timeframe') === '1Hour', i = k++ % syms.length;
    const n = hourly ? 50 : 35, stale = syms[i] === 'XRP/USD' ? 10 : 0;
    const bars = { [syms[i]]: Array.from({ length: n - stale }, (_, j) => ({ t: new Date(Date.now() - (n - j) * (hourly ? 36e5 : 864e5)).toISOString(), c: 10 + j / 10, v: 100 })) };
    return { bars, next_page_token: 'more' }; };
  net = fakeFetch({ '/v2/assets': assets, '/crypto/us/snapshots': snaps, '/crypto/us/bars': endless });
  const rate = PACE.perSec; PACE.perSec = 1e6; // the pacer would otherwise make this wait for the deadline
  const j = await (await GET(req('/api/crypto?all=1'))).json(); PACE.perSec = rate;
  assert.equal(net.calls.filter(c => c.url.includes('/crypto/us/bars')).length, 120, 'stops at 60 pages per timeframe');
  assert.equal(j.partial, true);
  for (const x of j.board) assert.ok(x.spark?.length === 48 || (x.chg24 === null && x.spark === null && x.vol === null), `${x.s} is whole or blank`);
  assert.equal(j.board.find(x => x.s === 'XRP/USD').spark, null, 'a coin missing its newest hours is blank');
});
