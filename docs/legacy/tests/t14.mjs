// v0.12.1 audit fixes (updated for v0.12.2): per-coin price history + coverage, chronological DCA backtest, honest "proven", lab without leakage,
// run lock that outlasts a run, emergency stop that covers every bot (incl. the bull-run core), missing data = unknown
// (BTC trend, news), stock time exits that keep their entry-time holding period, the $100 plan's entry candle.
import { blob, M, orders, closedPos } from './mock.mjs';
import { BAR_OPT } from './mockdata.mjs';
const T = new URL('../', import.meta.url).href;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
M.assets = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD', 'AVAX/USD', 'LTC/USD', 'ADA/USD', 'DOT/USD', 'DOGE/USD', 'SHIB/USD', 'PEPE/USD'];
const core = await import(T + 'lib/core.js'), D = await import(T + 'lib/dca.js'), C = await import(T + 'lib/control.js'), N = await import(T + 'lib/news.js'), Sm = await import(T + 'lib/small.js');
const k = core.tokenFor('pw');

// ---- 1. price history: one coin per request, every page, coverage per coin (v0.12.2: crypto bars() and the stored history) ----
const full = (await core.barRange('BTC/USD', { timeframe: '1Hour', start: Date.now() - 60 * 864e5 })).bars;
BAR_OPT.limit = 500;
const each = await core.bars(['AVAX/USD', 'BTC/USD', 'ETH/USD', 'SOL/USD'], { timeframe: '1Hour', days: 60, limitPages: 2 });
ok(Object.keys(each).length === 4 && Object.values(each).every(a => a.length === full.length), `crypto bars() gets all 4 coins with every page, even with a small shared page size (${Object.entries(each).map(([s, a]) => `${s} ${a.length}`).join(', ')}; want ${full.length})`);
BAR_OPT.limit = 0; BAR_OPT.fail['DOT/USD'] = 500; BAR_OPT.short['ADA/USD'] = 50;
const P = await D._sim.prep('crypto', { syms: ['BTC/USD', 'ETH/USD', 'ADA/USD', 'DOT/USD'], days: 60, timeframe: '1Hour' });
const cv = Object.fromEntries(P.coverage.map(c => [c.s, c]));
ok(P.syms.join() === 'BTC/USD,ETH/USD' && cv['DOT/USD'].used === false && /download failed/.test(cv['DOT/USD'].why) && cv['ADA/USD'].used === false && /only 50 bars/.test(cv['ADA/USD'].why) && cv['BTC/USD'].used,
  `coverage says why coins were left out: ${P.coverage.filter(c => !c.used).map(c => `${c.s}: ${c.why}`).join(' | ')}`);
BAR_OPT.fail = {}; BAR_OPT.short = {};
for (const key of Object.keys(blob)) if (key.startsWith('hist/')) delete blob[key]; // the shortened test coins must not stay in the stored history

// ---- 2. chronological DCA backtest ----
// 40 flat candles at 100, then: candle 31 trades up to 103 (take profit at 102 fills), candle 32 opens at 101, candle 33 reaches 104.
const n = 40, t = Array.from({ length: n }, (_, i) => Date.UTC(2026, 0, 1) + i * 36e5), o = Array(n).fill(100), h = Array(n).fill(100.5), l = Array(n).fill(99.5), c = Array(n).fill(100);
h[31] = 103; c[31] = 101; o[32] = 101; h[32] = 101.5; l[32] = 100.8; c[32] = 101; o[33] = 101; h[33] = 104; c[33] = 103;
for (let i = 34; i < n; i++) { o[i] = 103; h[i] = 103.5; l[i] = 102.5; c[i] = 103; }
const X = { t, o, h, l, c, rsi: new Float64Array(n).fill(50), trend: new Uint8Array(n).fill(1) };
const sp = (x) => ({ market: 'crypto', syms: ['X/USD'], x: { 'X/USD': x }, T: x.t, at: { 'X/USD': Int32Array.from(x.t.map((_, i) => i)) }, run: x.t.map(() => true), fee: 0, budget: 1000, maxDeals: 1, caps: { reg: 1, meme: 0 }, meme: [false], active: 3, bull: new Uint8Array(n) });
const S1 = { n: 2, d: 5, k: 1, v: 1, tp: 2, x: 0, f: 'a', tr: 0, p: 0 }; // p: 0 = the pre-v0.13.1 sizing (first buy = deal ÷ ladder factor), which these checks were written for
let r = D._sim.simulate(sp(X), S1);
ok(r.deals[0]?.in === t[30] && r.deals[0]?.out === t[31] && r.deals[1]?.in === t[32], `a deal that takes profit inside candle 31 restarts at candle 32's open, not at candle 31's earlier open (deals: ${r.deals.map(d => `${(d.in - t[0]) / 36e5}→${(d.out - t[0]) / 36e5}`).join(', ')})`);
ok(r.deals[1] && Math.abs(r.deals[1].pnl - 1000 / 3 * (103.02 / 101 - 1)) < 0.05, `second deal bought at 101 (the real next price) and sold at +2%: $${r.deals[1]?.pnl.toFixed(2)}`);
const l2 = [...l]; l2[30] = 94; const X2 = { ...X, l: l2 };
r = D._sim.simulate(sp(X2), S1);
ok(r.deals[0]?.k >= 1, 'a dip buy can fill in the same candle the deal opened in (the order rests from the open on)');
const h3 = [...h], l3 = [...l]; l3[31] = 94.5; const X3 = { ...X, h: h3, l: l3 };
r = D._sim.simulate(sp(X3), S1);
ok(r.ambiguous >= 1, `a candle that touches both a dip buy and the take profit is counted as ambiguous (${r.ambiguous})`);

// ---- 3. honest "proven" ----
delete blob[D.TRAIN_KEY];
const tr = await D.dcaTraining({ force: true });
const cr = tr.crypto, need = cr.walk.test.ret > 0 && cr.walk.test.n >= D.DCA.minTest;
ok(D.TRAIN_KEY === 'dca/train-v6.json' && typeof cr.provenWhy === 'string' && (!cr.proven || need), `"proven" also needs the unseen third (proven ${cr.proven}: ${cr.provenWhy})`);
ok(Array.isArray(cr.coverage) && cr.coverage.length === cr.coverage.filter(x => x.used).length + cr.coverage.filter(x => x.used === false).length, `training reports per-coin coverage (${cr.coverage.filter(x => x.used).length} of ${cr.coverage.length} usable)`);

// ---- 4. lab without leakage ----
const L = await import(T + 'lib/dcalab.js');
blob[D.TRAIN_KEY] = JSON.stringify({ at: new Date().toISOString(), crypto: { chosen: { S: { n: 4, d: 9, k: 1, v: 1, tp: 9, x: 5, f: 'a', tr: 0 } } } }); // a poisoned daily training the lab must ignore
const lab = await L.runLab({ save: false, days: 240 });
ok(/picked by the lab on .* only/.test(lab.settings.source) && lab.settings.S.d !== 9, `lab picks its own settings on its first two thirds: ${lab.settings.text}`);
const A0 = lab.pick.pickedOnFirstPart, want = A0.length >= 3 ? A0 : D.DCA.crypto.syms.filter(s => lab.coins.some(c => c.s === s));
ok(lab.bull.testList.join() === want.join() && Array.isArray(lab.coverage), `bull-run test uses a coin list known before the unseen third (${A0.length >= 3 ? 'picked on the first two thirds' : 'the hand list'}: ${lab.bull.testList.length} coins) and the lab reports coverage`);

// ---- 5. run lock ----
ok(C.RISK.lockSec * 1000 > 300 * 1000, `the lock (${C.RISK.lockSec} s) outlasts the longest run (300 s)`);
delete blob['control/lock.json']; M.blobDown = true;
const lk = await C.acquireLock(); M.blobDown = false;
const lad = await C.ladder({ dry: false, clock: { is_open: false }, equity: 100000, last: 100000, lockUnconfirmed: !!lk?.unconfirmed });
ok(lk?.unconfirmed && lad.level === 3 && !lad.entries.stocks && !lad.entries.crypto && !lad.entries.dca, 'storage down: the lock is marked unconfirmed and the ladder blocks new trades (exits still run): ' + lad.reasons[0]);

// ---- 6. emergency stop covers the core and reports leftovers; manual holdings stay ----
const ago = (hh) => new Date(Date.now() - hh * 36e5).toISOString();
orders.push({ id: 'btc-core', symbol: 'BTC/USD', side: 'buy', qty: '0.01', filled_qty: '0.01', filled_avg_price: '80000', filled_at: ago(5), submitted_at: ago(5), client_order_id: 'tbhodl-2609291000-BTCUSD-b-zx1' },
  { id: 'msft-me', symbol: 'MSFT', side: 'buy', qty: '2', filled_qty: '2', filled_avg_price: '400', filled_at: ago(3), submitted_at: ago(3), client_order_id: 'manual-1' });
M.extraPos = [{ symbol: 'BTCUSD', qty: '0.01', qty_available: '0.01', avg_entry_price: '80000', current_price: '81000', market_value: '810', unrealized_pl: '10', unrealized_plpc: '0.01', unrealized_intraday_plpc: '0', asset_class: 'crypto', side: 'long' },
  { symbol: 'MSFT', qty: '2', qty_available: '2', avg_entry_price: '400', current_price: '410', market_value: '820', unrealized_pl: '20', unrealized_plpc: '0.02', unrealized_intraday_plpc: '0', asset_class: 'us_equity', side: 'long' }];
closedPos.length = 0;
const es = await C.emergencyStop([...orders].sort((a, z) => z.submitted_at.localeCompare(a.submitted_at)));
ok(closedPos.includes('BTCUSD') && !closedPos.includes('MSFT'), `emergency stop closes the bull-run core (tbhodl) and leaves your own MSFT alone (closed: ${closedPos.join(', ')})`);
ok(es.checked && es.left.some(x => x.s === 'BTCUSD'), `it re-checks and reports what is still open instead of assuming success (left in the mock: ${es.left.map(x => x.s).join(', ')})`);
M.extraPos = []; await C.setMode('run', 'test', 'resume');

// ---- 7. missing data = unknown ----
D.resetLab(); BAR_OPT.fail['BTC/USD'] = 500;
const bs = await D.bullState(); BAR_OPT.fail = {}; D.resetLab();
ok(bs.unknown && bs.on === false && /unknown/.test(bs.why) && /kept/.test(bs.why), 'no BTC history: bull-run state is UNKNOWN (core kept, no new core buys), not "BTC left its uptrend": ' + bs.why);
const vf = N.newsVerdict({ n24: 0, n72: 0, tone: 0, cats: [], heads: [], status: { headlines: 'failed', sec: 'ok', calendar: 'ok' }, earnStatus: 'unknown' });
ok(vf.tag.includes('Q') && vf.act === 'half' && /unknown/.test(vf.why), `failed headline lookup → flag Q, "news unknown", half size in gate mode (${vf.why})`);
const st = N.newsState({ n24: 0, n72: 0, tone: 0, cats: [], heads: [], status: { headlines: 'failed', sec: 'failed', calendar: 'failed' }, earnStatus: 'unknown' });
ok(st.headlines_24h === null && st.recent_headlines === null && st.data_status.headlines === 'failed' && st.earnings_date_status === 'unknown' && st.market_moving_releases_soon === null, 'Jev gets null + data_status for failed lookups, never "0 headlines"');
ok(N.parseNewsTag('tbbot-20260929-AAPL-pullback-sc70-h10-s190-n0Q').caution === true, 'the Q flag reads back from the order id as a caution');

// ---- 8. stock time exits keep their entry-time holding period; a later manual buy is never sold ----
M.clockOpen = true;
const aapl = orders.find(x => x.id === 'aapl-bot'), old = { ...aapl };
Object.assign(aapl, { filled_at: ago(24 * 9), submitted_at: ago(24 * 9), client_order_id: 'tbbot-20260920-AAPL-pullback-sc70-h3-s190' });
const bot = await import(T + 'routes/bot.js');
let j = await (await bot.GET(new Request(`http://x/api/bot?k=${k}&dry=1&only=stocks`))).json();
const ex = (j.exits || []).find(x => x.s === 'AAPL');
ok(ex && /limit 3, set at entry/.test(ex.why), `AAPL entered with a 3-day hold is exited on its own 3-day limit, whatever the latest training says (${ex?.why})`);
orders.push({ id: 'aapl-me', symbol: 'AAPL', side: 'buy', qty: '3', filled_qty: '3', filled_avg_price: '205', filled_at: ago(2), submitted_at: ago(2), client_order_id: 'manual-2' });
j = await (await bot.GET(new Request(`http://x/api/bot?k=${k}&dry=1&only=stocks`))).json();
const ex2 = (j.exits || []).find(x => x.s === 'AAPL');
ok(ex2 && /not touched/.test(ex2.why), `after you buy AAPL yourself, the bot does not time-exit it (${ex2?.why})`);
orders.splice(orders.findIndex(x => x.id === 'aapl-me'), 1); Object.assign(aapl, old); M.clockOpen = false;

// ---- 9. $100 plan: the entry candle is managed too ----
// 40 flat 4-hour candles at $1; the deal starts at candle 31's open and that same candle trades up to $1.04 (take profit +3% = $1.03).
const m = 40, zo = Array(m).fill(1), zh = Array(m).fill(1.001), zl = Array(m).fill(0.999); zh[31] = 1.04;
const Pm = { T: Array.from({ length: m }, (_, i) => i * 144e5), syms: ['Z/USD'], at: { 'Z/USD': Int32Array.from({ length: m }, (_, i) => i) }, bull: new Uint8Array(m).fill(1),
  x: { 'Z/USD': { o: zo, h: zh, l: zl, c: Array(m).fill(1), trend: new Uint8Array(m).fill(1), rsi: new Float64Array(m).fill(50) } } };
const rz = Sm.simSmall(Pm, 'dca', { n: 3, d: 2, k: 1, v: 2, tp: 3, x: 10, f: 'a', tr: 0 });
ok(rz.n >= 1, `the $100 simulator manages the candle a position opened in (take profit inside the entry candle: ${rz.n} trade${rz.n === 1 ? '' : 's'}; it used to skip that candle)`);
