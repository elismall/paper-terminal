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

// Live account stand-in: $40 already held in BTC, one open $20 buy, 0.5 SPY held at $50. `extra` routes win and match first.
const liveAccount = (extra = {}) => fakeFetch(Object.fromEntries([...Object.entries(extra), ...Object.entries({
  'api.alpaca.markets/v2/positions/SPY': { qty: '0.5', current_price: '50' },
  'api.alpaca.markets/v2/positions/': (u) => { throw new Error('404 ' + u); },
  'api.alpaca.markets/v2/positions': [{ market_value: '40' }],
  'api.alpaca.markets/v2/orders?status=open': [{ side: 'buy', qty: '1', limit_price: '20', symbol: 'ETHUSD', status: 'new' }],
  'api.alpaca.markets/v2/orders': { id: 'sent' },
}).filter(([k]) => !(k in extra))]));
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

// v0.20.0 (audit #7): order shapes the cap used to miss.
test('live: credit spreads, calendars, odd legs and sells with attached legs are refused', async () => {
  setEnv(LIVE_ENV);
  const leg = (symbol, side) => ({ symbol, side, ratio_qty: '1' });
  const bad = {
    'credit call spread': { order_class: 'mleg', qty: 1, limit_price: 0.5, legs: [leg('AAPL261218C00210000', 'buy'), leg('AAPL261218C00200000', 'sell')] },
    'credit put spread': { order_class: 'mleg', qty: 1, limit_price: 0.5, legs: [leg('AAPL261218P00190000', 'buy'), leg('AAPL261218P00200000', 'sell')] },
    'two short legs': { order_class: 'mleg', qty: 1, limit_price: 0.1, legs: [leg('AAPL261218C00200000', 'sell'), leg('AAPL261218P00190000', 'sell')] },
    'calendar': { order_class: 'mleg', qty: 1, limit_price: 0.1, legs: [leg('AAPL261218C00200000', 'buy'), leg('AAPL261120C00205000', 'sell')] },
    'two stocks': { order_class: 'mleg', qty: 1, limit_price: 0.1, legs: [leg('AAPL261218C00200000', 'buy'), leg('MSFT261218C00205000', 'sell')] },
    'sell bracket': { symbol: 'SPY', qty: 0.5, side: 'sell', type: 'market', order_class: 'bracket', stop_loss: { stop_price: '60' }, take_profit: { limit_price: '40' } },
  };
  for (const [name, order] of Object.entries(bad)) {
    net = liveAccount();
    await assert.rejects(ppost('/v2/orders', order), (e) => e.status === 403 && /Live money guard/.test(e.message), name);
    assert.equal(posted().length, 0, name + ': nothing sent'); net.restore();
  }
  net = liveAccount();
  await ppost('/v2/orders', { order_class: 'mleg', qty: 1, limit_price: 0.3, legs: [leg('AAPL261218C00200000', 'buy'), leg('AAPL261218C00205000', 'sell')] });
  assert.equal(posted().length, 1, 'a debit spread within the cap still goes through');
});

test('live: a resting market buy counts at the live price, not $0', async () => {
  setEnv(LIVE_ENV);
  net = liveAccount({ 'api.alpaca.markets/v2/orders?status=open': [{ id: 'm1', side: 'buy', qty: '1', type: 'market', symbol: 'MSFT', status: 'accepted' }],
    'data.alpaca.markets': { MSFT: { latestTrade: { p: 50, t: new Date().toISOString() } }, snapshots: { MSFT: { latestTrade: { p: 50, t: new Date().toISOString() } } } } });
  // $40 held + $50 resting market buy + $15 = $105 > $100
  await assert.rejects(ppost('/v2/orders', { symbol: 'AAPL', qty: 1, side: 'buy', type: 'limit', limit_price: 15 }), (e) => e.status === 403 && /above LIVE_MAX_USD/.test(e.message));
  assert.equal(posted().length, 0);
});

test('live: raising a resting buy\'s price is checked against the cap; moving a stop is not', async () => {
  setEnv(LIVE_ENV);
  net = liveAccount({ 'api.alpaca.markets/v2/orders/b1': { id: 'b1', side: 'buy', qty: '1', symbol: 'AAPL', limit_price: '5' },
    'api.alpaca.markets/v2/orders/s1': { id: 's1', side: 'sell', qty: '1', symbol: 'AAPL', stop_price: '5' } });
  await assert.rejects(ppatch('/v2/orders/b1', { limit_price: '70' }), (e) => e.status === 403 && /above LIVE_MAX_USD/.test(e.message));
  await ppatch('/v2/orders/b1', { limit_price: '30' });
  await ppatch('/v2/orders/s1', { stop_price: '500' });
  assert.equal(net.calls.filter(c => c.method === 'PATCH').length, 2);
});

// v0.20.0 review findings.
test('live: two buys sent at once cannot both pass the cap', async () => {
  setEnv({ ...LIVE_ENV, LIVE_MAX_USD: '1000' });
  const book = [];
  net = fakeFetch({ 'api.alpaca.markets/v2/positions': [{ market_value: '600' }], 'api.alpaca.markets/v2/orders?status=open': () => book.slice(),
    'api.alpaca.markets/v2/orders': (u, init) => { book.push({ ...JSON.parse(init.body), status: 'new', id: String(book.length) }); return { id: 'x' }; } });
  const r = await Promise.allSettled([ppost('/v2/orders', { symbol: 'AAPL', qty: 1, side: 'buy', type: 'limit', limit_price: 300 }), ppost('/v2/orders', { symbol: 'BTC/USD', notional: 300, side: 'buy', type: 'market' })]);
  assert.deepEqual(r.map(x => x.status).sort(), ['fulfilled', 'rejected']); assert.equal(posted().length, 1);
});

test('live: a filled bracket parent is not counted again on top of its position', async () => {
  setEnv({ ...LIVE_ENV, LIVE_MAX_USD: '1000' });
  net = liveAccount({ 'api.alpaca.markets/v2/positions': [{ market_value: '400' }],
    'api.alpaca.markets/v2/orders?status=open': [{ id: 'p', status: 'filled', side: 'buy', qty: '10', filled_qty: '10', symbol: 'AAPL', order_class: 'bracket',
      legs: [{ id: 'l1', status: 'new', side: 'sell', type: 'limit', limit_price: '50', qty: '10', symbol: 'AAPL' }, { id: 'l2', status: 'held', side: 'sell', type: 'stop', stop_price: '35', qty: '10', symbol: 'AAPL' }] }] });
  await ppost('/v2/orders', { symbol: 'MSFT', qty: 1, side: 'buy', type: 'limit', limit_price: 300 });
  assert.equal(posted().length, 1);
});

test('live: the bot\'s protective OCO sell on a held position is sent', async () => {
  setEnv(LIVE_ENV); net = liveAccount();
  await ppost('/v2/orders', { symbol: 'SPY', side: 'sell', type: 'limit', qty: '0.5', time_in_force: 'gtc', order_class: 'oco', take_profit: { limit_price: '60' }, stop_loss: { stop_price: '45' } });
  assert.equal(posted().length, 1);
});
