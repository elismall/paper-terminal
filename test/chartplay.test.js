// The Options tab's chart mode (routes/options.js strategy=chart) end to end, with Alpaca's answers faked: it names the pattern,
// builds a play with defined risk, and never calls the trading API's order endpoints.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const DAY = 864e5, seen = [], B = {};
let realFetch;
// 300 trading days (+3, -2, +2, -3, +2, -2 plus `drift` a day; from day `turn` on, `drift2`), then the last day trades in a tight range.
// TSLA trends up; FLAT rolls over, so it has no trend and the tight day could break either way.
function daily(drift = 1, turn = Infinity, drift2 = 0) {
  const b = [], zig = [3, -2, 2, -3, 2, -2]; let c = 100;
  for (let i = 0; i < 300; i++) { const o = c; c = o + (i >= turn ? drift2 : drift) + zig[i % 6]; b.push({ t: new Date(Date.now() - (300 - i) * DAY).toISOString(), o, h: Math.max(o, c) + 0.5, l: Math.min(o, c) - 0.5, c, v: 1e6 }); }
  const x = b.at(-1); x.o = b.at(-2).c; x.c = x.o + 0.1; x.h = x.c + 0.3; x.l = x.o - 0.3;
  return b;
}
// Calls and puts every $5 around the price for three Fridays-ish; iv 40%, delta falling with the strike.
function chainFor(sym, type, px) {
  const out = {};
  for (const days of [9, 16, 30, 44]) {
    const d = new Date(Date.now() + days * DAY), exp = d.toISOString().slice(2, 10).replace(/-/g, '');
    for (let k = Math.round(px / 5) * 5 - 30; k <= px + 30; k += 5) {
      const m = (px - k) / px * (type === 'call' ? 1 : -1), delta = Math.max(0.03, Math.min(0.97, 0.5 + m * 5)) * (type === 'call' ? 1 : -1);
      const intrinsic = Math.max(0, type === 'call' ? px - k : k - px), price = intrinsic + 2 + days / 10;
      out[`${sym}${exp}${type === 'call' ? 'C' : 'P'}${String(k * 1000).padStart(8, '0')}`] = { latestQuote: { bp: price - 0.1, ap: price + 0.1, t: new Date().toISOString() }, latestTrade: { p: price }, greeks: { delta, theta: -0.05, gamma: 0.01, vega: 0.1 }, impliedVolatility: 0.4 };
    }
  }
  return out;
}
before(() => {
  process.env.ALPACA_KEY_ID = 'test'; process.env.ALPACA_SECRET_KEY = 'test'; delete process.env.DASH_PASSCODE;
  realFetch = globalThis.fetch; B.TSLA = daily(); B.FLAT = daily(0.4, 280, -0.4);
  globalThis.fetch = async (url) => {
    const u = new URL(url); seen.push(u.host + u.pathname);
    const ok = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    const sym = u.searchParams.get('symbols') || u.pathname.split('/').pop(), b = B[sym];
    if (!b) return new Response('not found', { status: 404 });
    if (u.pathname === '/v2/stocks/bars') return ok({ bars: { [sym]: b }, next_page_token: null });
    if (u.pathname === '/v2/stocks/snapshots') return ok({ [sym]: { latestTrade: { p: b.at(-1).c, t: new Date().toISOString() }, dailyBar: { ...b.at(-1) }, prevDailyBar: { ...b.at(-2) } } });
    if (u.pathname.startsWith('/v1beta1/options/snapshots/')) return ok({ snapshots: chainFor(sym, u.searchParams.get('type'), b.at(-1).c), next_page_token: null });
    return new Response('not found', { status: 404 });
  };
});
after(() => { globalThis.fetch = realFetch; });

const chart = async (sym) => {
  const { GET } = await import('../routes/options.js');
  const r = await GET(new Request(`https://x.test/api/options?symbol=${sym}&strategy=chart`)), j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  return j;
};
test('chart mode: names the pattern, counts history, builds a defined-risk play, places nothing', async () => {
  const j = await chart('TSLA');
  assert.equal(j.pattern.key, 'tight'); assert.equal(j.pattern.dir, 'up');
  assert.match(j.pattern.trigger, /closes above \$/); assert.match(j.pattern.off, /closes below \$/);
  assert.ok(j.history && typeof j.history.n === 'number');
  assert.ok(j.idea, j.message); assert.match(j.idea.strategy, /Call debit spread|Long call/);
  assert.ok(j.vol.rv > 0 && j.vol.iv > 0 && j.vol.label);
  assert.ok(!seen.some(p => /paper-api|api\.alpaca|\/v2\/orders/.test(p)), 'no trading API calls: ' + seen.join(' '));
});

test('chart mode: no trend means a straddle or strangle (pays if it breaks either way)', async () => {
  const j = await chart('FLAT');
  assert.equal(j.pattern.dir, 'either'); assert.match(j.pattern.trigger, /or below/);
  assert.match(j.idea.strategy, /Long (straddle|strangle)/);
  assert.ok(j.idea.beUp > j.px && j.idea.beDown < j.px && j.idea.maxLoss > 0);
});

test('chart mode fetches each option chain once, skips a second snapshot, and caches per stock', async () => {
  seen.length = 0; B.ONCE = daily(0.4, 280, -0.4);
  const j = await chart('ONCE'), opt = seen.filter(p => p.includes('/v1beta1/options/'));
  assert.match(j.idea.strategy, /Long (straddle|strangle)/);
  assert.equal(opt.length, 2, 'one call chain and one put chain: ' + opt.join(' '));
  assert.equal(seen.filter(p => p.endsWith('/v2/stocks/snapshots')).length, 2, 'one snapshot lookup (inside the bars step; real-time + delayed feed)');
  const n = seen.length; await chart('ONCE'); assert.equal(seen.length, n, 'a second read within 5 minutes costs no Alpaca calls');
});
