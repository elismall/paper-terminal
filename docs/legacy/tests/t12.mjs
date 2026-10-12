// v0.11.0 crypto signals (shadow): perp funding from Hyperliquid (no key) + money conditions from FRED, recorded on new DCA deals,
// the gate switch, the scorecard, the Macro tab's new series, and the chart route's live mode.
import { blob, posted, M, orders, open, positions } from './mock.mjs';
const T = new URL('../', import.meta.url).href;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
M.assets = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD', 'AVAX/USD', 'LTC/USD', 'BCH/USD', 'ADA/USD', 'DOT/USD', 'AAVE/USD', 'UNI/USD', 'DOGE/USD', 'SHIB/USD', 'PEPE/USD', 'WIF/USD'];
process.env.FRED_API_KEY = 'fredkey';
const DAY = 864e5, base = global.fetch, day = (i) => new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
// Hyperliquid: hourly funding. BTC 0.00002/h = 17.5%/yr (normal), SOL 0.00004 = 35% (hot), DOGE 0.0001 = 87.6% (very hot), kPEPE -0.00001 (negative)
const HL = [{ name: 'BTC', f: 0.00002 }, { name: 'ETH', f: 0.0000125 }, { name: 'SOL', f: 0.00004 }, { name: 'DOGE', f: 0.0001 }, { name: 'kPEPE', f: -0.00001 }, { name: 'XRP', f: 0.00001 }];
const series = (id, n) => {           // newest first, like FRED with sort_order=desc
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = id === 'DTWEXBGS' ? 120 + i * 0.06 : id === 'DFII10' ? 1.8 + i * 0.006 : id === 'M2SL' ? 20000 * Math.exp(0.0004 * (40 - i) ** 2 / 10 + 0.003 * (40 - i)) : 100 + (i % 7);
    out.push({ date: id === 'M2SL' || id === 'CPIAUCSL' || id === 'UNRATE' ? new Date(Date.UTC(2026, 8 - i, 1)).toISOString().slice(0, 10) : day(i), value: String(v) });
  }
  return out;
};
global.fetch = async (url, opt = {}) => {
  const u = new URL(url);
  if (u.hostname === 'api.hyperliquid.xyz') { M.hl = (M.hl || 0) + 1; if (M.hlDown) return new Response('no', { status: 503 });
    return new Response(JSON.stringify([{ universe: HL.map(x => ({ name: x.name })) }, HL.map(x => ({ funding: String(x.f), openInterest: '1000', markPx: '10', dayNtlVlm: '50000', premium: '0.0001' }))])); }
  if (u.hostname === 'api.stlouisfed.org' && u.pathname === '/fred/series/observations') { M.fred = (M.fred || 0) + 1; const id = u.searchParams.get('series_id'); return new Response(JSON.stringify({ observations: series(id, +u.searchParams.get('limit')) })); }
  return base(url, opt);
};
const Lv = await import(T + 'lib/leverage.js'), Mc = await import(T + 'lib/macro.js'), D = await import(T + 'lib/dca.js');
const { tokenFor } = await import(T + 'lib/core.js'), k = tokenFor('pw');

// ---- funding ----
const PS = await Lv.perpStats();
ok(PS.BTC.apr === 17.5 && PS.SOL.apr === 35 && PS.DOGE.apr === 87.6 && PS.kPEPE.apr === -8.8, 'hourly funding turned into %/yr: BTC 17.5, SOL 35, DOGE 87.6, kPEPE −8.8');
ok(Lv.perpOf(PS, 'PEPE/USD')?.apr === -8.8 && Lv.perpOf(PS, 'BTC/USD').apr === 17.5 && Lv.perpOf(PS, 'LINK/USD') === null, 'coin mapping: PEPE/USD -> kPEPE (1,000-unit contract), unknown coins -> none');
ok(['n', '0', '1', '2'].join() === [-1, 5, 30, 80].map(Lv.levBucket).join() && Lv.levTag(35) === '-h1' && Lv.levOf('tbdca-2609281700-SOLUSD-b-u10-b1-n4-d1-k1-v1-t1-x5-fa-j20-h1-qe-zq') === '1' && Lv.levOf('tbdca-2609281700-SOLUSD-hx-u10-zq') === null, 'buckets n/0/1/2, tag round-trip, hard-exit ids (-hx) never read as funding');
const calls = M.hl; await Lv.perpStats(); ok(M.hl === calls, 'funding cached 10 minutes (one Hyperliquid call)');

// ---- money conditions ----
const LQ = await Mc.liquidity();
ok(LQ.state === 'easing' && LQ.score === 3 && LQ.detail.dollar.change < 0 && LQ.detail.m2.change > 0 && LQ.detail.realYield.change < 0, 'dollar falling + M2 growth rising + real yield falling = easing: ' + LQ.text);
ok(Mc.liqTag(LQ) === '-qe' && Mc.liqOf('tbdca-x-j20-h1-qe-zq') === 'e', 'money-conditions tag round-trip (-qe)');
const mac = await (await (await import(T + 'routes/macro.js')).GET(new Request(`http://x/api/macro?k=${k}`))).json();
ok(mac.series.length === 13 && mac.series.some(x => x.id === 'M2SL' && x.v != null) && mac.series.some(x => x.id === 'WALCL' && /billions/.test(x.name)) && mac.series.some(x => x.id === 'DFII10'), 'Macro tab: 13 series incl. M2 growth, real yield, Fed balance sheet');

// ---- new DCA deals carry both signals ----
const S0 = { n: 4, d: 1.5, k: 1, v: 1.3, tp: 1, x: 5, f: 'a', tr: 0 };
blob['dca/train-v6.json'] = JSON.stringify({ at: new Date().toISOString(), budget: D.DCA.budget, split: D.DCA.split, crypto: { chosen: { S: S0, text: D.describe(S0) }, proven: true, walk: {} }, etf: { error: 'skip' } });
const ctx = (dry) => ({ dry, positions: positions(), openAll: open, recent: orders, clock: { is_open: false }, taken: new Set(), allowNew: true, judge: null, markets: ['crypto'] });
let out = await D.runDca(ctx(true));
const st = out.started;
ok(st.length > 0 && st.every(x => 'funding' in x && x.liquidity === 'easing') && st.some(x => x.funding != null && /perp funding/.test(x.why)), 'shadow: new deals show funding + money conditions: ' + st.map(x => `${x.s} ${x.funding ?? '—'}`).join(', '));
ok(out.signals?.mode === 'shadow' && out.signals.funding.BTC === 17.5 && out.signals.liquidity.state === 'easing', 'run output carries the signals');
posted.length = 0; out = await D.runDca(ctx(false));
const b = posted.filter(o => /^tbdca-\d{10}-[A-Z]+-b-/.test(o.client_order_id || ''));
const hasTags = b.filter(o => /-h[n012]-qe-z/.test(o.client_order_id) || /-qe-z/.test(o.client_order_id));
ok(b.length > 0 && hasTags.length === b.length && b.every(o => D.parseDca(o.client_order_id) && o.client_order_id.length <= 128), 'real base orders carry -h<funding>-qe and still parse as DCA deals: ' + b[0]?.client_order_id);
const doge = b.find(o => o.symbol === 'DOGE/USD'); ok(!doge || /-h2-qe/.test(doge.client_order_id), 'DOGE (very hot funding) still opens in shadow mode, tagged -h2' + (doge ? '' : ' (not picked this run)'));
// gate: very hot funding skips
process.env.LEVERAGE_MODE = 'gate'; out = await D.runDca(ctx(true));
const gSkip = out.skipped.find(x => x.s === 'DOGE/USD');
ok(!out.started.some(x => x.s === 'DOGE/USD') && gSkip && /87.6%\/yr: longs very crowded \(LEVERAGE_MODE=gate\)/.test(gSkip.why) && out.signals.mode === 'gate', 'LEVERAGE_MODE=gate: DOGE (very hot funding) skipped: ' + gSkip?.why);
process.env.LEVERAGE_MODE = 'off'; const hl0 = M.hl; posted.length = 0; out = await D.runDca(ctx(false));
ok(M.hl === hl0 && !out.signals && posted.filter(o => /-b-/.test(o.client_order_id || '')).every(o => !/-h[n012]-|-q[emt]-/.test(o.client_order_id)), 'LEVERAGE_MODE=off: no lookups, no tags');
process.env.LEVERAGE_MODE = '';

// ---- scorecard from closed deals ----
const mk = (id, sym, lev, liq, pnl) => { const c = `tbdca-2609200000-${sym.replace('/', '')}-b-u100-b10-n4-d1.5-k1-v1.3-t1-x5-fa-j20${lev ? '-h' + lev : ''}${liq ? '-q' + liq : ''}-z${id}`;
  return [{ id: id + 'b', symbol: sym, side: 'buy', qty: '10', filled_qty: '10', filled_avg_price: '10', filled_at: new Date(Date.now() - 5 * DAY).toISOString(), submitted_at: new Date(Date.now() - 5 * DAY).toISOString(), status: 'filled', client_order_id: c },
    { id: id + 's', symbol: sym, side: 'sell', qty: '10', filled_qty: '10', filled_avg_price: String(10 + pnl / 10), filled_at: new Date(Date.now() - 4 * DAY).toISOString(), submitted_at: new Date(Date.now() - 4 * DAY).toISOString(), status: 'filled', client_order_id: c.replace('-b-', '-tp-') }]; };
const L = D.dcaLive([...mk('a', 'LTC/USD', '2', 'e', -30), ...mk('b', 'BCH/USD', '0', 't', 12), ...mk('c', 'ADA/USD', '0', 'e', 8)], []);
ok(L.closed.length === 3 && L.closed.find(d => d.s === 'LTC/USD').lev === '2' && L.closed.find(d => d.s === 'BCH/USD').liq === 't', 'closed deals keep the funding and money tags from their start');
orders.push(...mk('a', 'LTC/USD', '2', 'e', -30), ...mk('b', 'BCH/USD', '0', 't', 12));
const pj = await (await (await import(T + 'routes/performance.js')).GET(new Request(`http://x/api/performance?k=${k}`))).json();
const row = (l) => pj.dcaSignals?.rows.find(r => r.label === l);
ok(pj.dcaSignals?.rows.length === 7 && row('Funding very hot (50%+/yr)')?.n === 1 && row('Funding very hot (50%+/yr)').realized === -30 && row('Money conditions tightening')?.n === 1, 'performance: DCA signal scorecard (very hot funding: 1 deal, −$30)');
const hj = await (await (await import(T + 'routes/health.js')).GET(new Request('http://x/api/health?probe=signals'))).json();
ok(hj.signals?.funding?.BTC?.apr === 17.5 && hj.signals.liquidity?.state === 'easing' && hj.signals.mode === 'shadow', 'health ?probe=signals');

// ---- chart route live mode ----
const R = await import(T + 'routes/bars.js');
let r = await R.GET(new Request(`http://x/api/bars?k=${k}&symbol=BTC/USD&range=M5&live=1`)), j = await r.json();
ok(/s-maxage=5\b/.test(r.headers.get('cache-control')) && j.bars.at(-1).c === j.quote.p, 'live chart: 5-second cache and the latest trade folded into the last candle');
r = await R.GET(new Request(`http://x/api/bars?k=${k}&symbol=BTC/USD&range=M5`)); ok(/s-maxage=20\b/.test(r.headers.get('cache-control')), 'normal chart requests keep the 20-second cache');
r = await R.GET(new Request(`http://x/api/bars?k=${k}&symbol=BTC/USD&range=6M&live=1`)); ok(/s-maxage=15\b/.test(r.headers.get('cache-control')), 'live daily chart: 15-second cache');
