// Adversary checks on the money path (lib/trade.js): live trading must never switch on by accident, orders go to the
// paper host unless it is fully on, and in live mode the guard refuses short sales, naked options and anything over LIVE_MAX_USD.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setEnv, fakeFetch } from './helpers.js';
import { tradingMode, LIVE_PHRASE, ppost, ppatch } from '../lib/trade.js';

const LIVE_ENV = { ALPACA_KEY_ID: 'PKTEST', ALPACA_SECRET_KEY: 'sk-test', TRADING_MODE: 'live', LIVE_CONFIRM: LIVE_PHRASE, ALPACA_LIVE_KEY_ID: 'AKLIVE', ALPACA_LIVE_SECRET_KEY: 'sk-live', LIVE_MAX_USD: '100' };
let net;
afterEach(() => net?.restore());

test('paper unless every live setting is present and exact', () => {
  setEnv({}); assert.equal(tradingMode().live, false);
  const drop = (k) => { const e = { ...LIVE_ENV }; delete e[k]; return e; };
  for (const k of ['LIVE_CONFIRM', 'ALPACA_LIVE_KEY_ID', 'ALPACA_LIVE_SECRET_KEY', 'LIVE_MAX_USD']) {
    setEnv(drop(k)); const m = tradingMode(); assert.equal(m.live, false, k); assert.match(m.blocked, /stay on paper/);
  }
  for (const [k, v] of [['LIVE_CONFIRM', LIVE_PHRASE.toLowerCase()], ['LIVE_CONFIRM', LIVE_PHRASE + '.'], ['LIVE_MAX_USD', '0'], ['LIVE_MAX_USD', '-5'], ['LIVE_MAX_USD', 'lots'], ['TRADING_MODE', 'paper']]) {
    setEnv({ ...LIVE_ENV, [k]: v }); assert.equal(tradingMode().live, false, `${k}=${v}`);
  }
  setEnv(LIVE_ENV); assert.deepEqual(tradingMode(), { live: true, mode: 'live', cap: 100 });
});

test('paper mode sends orders to the paper host with the paper keys', async () => {
  setEnv({ ALPACA_KEY_ID: 'PKTEST', ALPACA_SECRET_KEY: 'sk-test', ALPACA_LIVE_KEY_ID: 'AKLIVE', ALPACA_LIVE_SECRET_KEY: 'sk-live' });
  net = fakeFetch({ 'paper-api.alpaca.markets/v2/orders': { id: 'o1' } });
  await ppost('/v2/orders', { symbol: 'AAPL', qty: 1, side: 'buy', type: 'market' });
  assert.equal(net.calls.length, 1); assert.match(net.calls[0].url, /^https:\/\/paper-api\.alpaca\.markets\//);
});

// Live account stand-in: $40 already held in BTC, one open $20 buy, 0.5 SPY held at $50.
const liveAccount = (extra = {}) => fakeFetch({
  'api.alpaca.markets/v2/positions/SPY': { qty: '0.5', current_price: '50' },
  'api.alpaca.markets/v2/positions/': (u) => { throw new Error('404 ' + u); },
  'api.alpaca.markets/v2/positions': [{ market_value: '40' }],
  'api.alpaca.markets/v2/orders?status=open': [{ side: 'buy', qty: '1', limit_price: '20', symbol: 'ETHUSD' }],
  'api.alpaca.markets/v2/orders': { id: 'sent' },
  ...extra,
});
const posted = () => net.calls.filter(c => c.method === 'POST');

test('live: a buy within LIVE_MAX_USD goes to the live host', async () => {
  setEnv(LIVE_ENV); net = liveAccount();
  await ppost('/v2/orders', { symbol: 'AAPL', qty: 1, side: 'buy', type: 'limit', limit_price: 30 });
  assert.equal(posted().length, 1); assert.match(posted()[0].url, /^https:\/\/api\.alpaca\.markets\//);
});

test('live: refuses what it must refuse, and sends nothing', async () => {
  setEnv(LIVE_ENV);
  const bad = {
    'over the cap': { symbol: 'AAPL', qty: 1, side: 'buy', type: 'limit', limit_price: 41 },
    'over the cap by notional': { symbol: 'BTC/USD', notional: 50, side: 'buy', type: 'market' },
    'short sale (nothing held)': { symbol: 'TSLA', qty: 1, side: 'sell', type: 'market' },
    'selling more than held': { symbol: 'SPY', qty: 1, side: 'sell', type: 'market' },
    'option sold to open': { symbol: 'AAPL261218C00200000', qty: 1, side: 'sell', type: 'limit', limit_price: 1 },
    'spread without a limit': { order_class: 'mleg', qty: 1, legs: [] },
    'unknown side': { symbol: 'AAPL', qty: 1, side: 'short', type: 'market', limit_price: 1 },
    'unpriceable buy': { symbol: 'AAPL', qty: 1, side: 'buy', type: 'market' },
  };
  for (const [name, order] of Object.entries(bad)) {
    net = liveAccount({ 'data.alpaca.markets': {} });
    await assert.rejects(ppost('/v2/orders', order), (e) => e.status === 403 && /Live money guard/.test(e.message), name);
    assert.equal(posted().length, 0, name + ': nothing sent');
    assert.ok(net.calls.filter(c => !c.url.startsWith('https://data.alpaca.markets/')).every(c => c.url.startsWith('https://api.alpaca.markets/')), name + ': live checks read the live account');
    net.restore();
  }
  net = null;
});

test('live: selling what you hold is allowed; resizing an open order is not', async () => {
  setEnv(LIVE_ENV); net = liveAccount();
  await ppost('/v2/orders', { symbol: 'SPY', qty: 0.5, side: 'sell', type: 'market' });
  assert.equal(posted().length, 1);
  await assert.rejects(ppatch('/v2/orders/o1', { qty: 2 }), (e) => e.status === 403);
});
