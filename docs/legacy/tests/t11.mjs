// v0.11.0 crypto DCA: the DCA lab (coin picking checked on unseen data, bull runs vs holding, bull-run mode) and the live
// bull-run core (buys BTC/ETH in a BTC uptrend, sells when it ends, never touches a coin a deal holds) + lab-picked coin list.
import { blob, posted, M, orders, open, positions } from './mock.mjs';
const T = new URL('../', import.meta.url).href;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const CANDS = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD', 'AVAX/USD', 'LTC/USD', 'BCH/USD', 'ADA/USD', 'DOT/USD', 'AAVE/USD', 'UNI/USD', 'ARB/USD', 'CRV/USD', 'FIL/USD', 'RENDER/USD', 'DOGE/USD', 'SHIB/USD', 'PEPE/USD', 'WIF/USD'];
M.assets = [...CANDS, 'USDC/USD', 'PAXG/USD'];
// BTC daily bars can be forced into an uptrend (M.btc = 'up') or a downtrend ('down') for the regime check
const DAY = 864e5, base = global.fetch;
const btcDaily = (dir) => Array.from({ length: 330 }, (_, i) => { const t = new Date(Date.now() - (330 - i) * DAY); t.setUTCHours(0, 0, 0, 0); const c = 50000 * (dir === 'up' ? 1.003 ** i : 0.997 ** i); return { t: t.toISOString(), o: c, h: c * 1.01, l: c * 0.99, c, v: 1 }; });
const extraPos = [];
global.fetch = async (url, opt = {}) => {
  const u = new URL(url);
  if (M.btc && u.pathname.includes('/bars') && u.searchParams.get('timeframe') === '1Day' && u.searchParams.get('symbols') === 'BTC/USD') return new Response(JSON.stringify({ bars: { 'BTC/USD': btcDaily(M.btc) } }));
  if (u.pathname === '/v2/positions' && extraPos.length) { const r = await (await base(url, opt)).json(); return new Response(JSON.stringify([...r, ...extraPos])); }
  if (u.pathname === '/v2/orders' && u.searchParams.get('symbols')) { M.coreHistQ = u.searchParams.get('symbols'); }
  return base(url, opt);
};
const D = await import(T + 'lib/dca.js'), L = await import(T + 'lib/dcalab.js');
const { tokenFor } = await import(T + 'lib/core.js'), k = tokenFor('pw');
const setLab = async (obj) => { blob[D.LAB_KEY] = JSON.stringify(obj); D.resetLab(); await D.labLatest({ fresh: true }); };   // direct store writes skip the 30 s read memo
const S0 = { n: 4, d: 1.5, k: 1, v: 1.3, tp: 1, x: 5, f: 'a', tr: 0 };
blob['dca/train-v6.json'] = JSON.stringify({ at: new Date().toISOString(), budget: D.DCA.budget, split: D.DCA.split, crypto: { chosen: { S: S0, text: D.describe(S0) }, proven: true, walk: {} }, etf: { error: 'skip' } });

// ---- candidates + fallback list ----
const cands = await D.tradableCandidates();
ok(cands.length === CANDS.length && !cands.includes('USDC/USD') && !cands.includes('PAXG/USD'), `candidates = every listed non-stablecoin in the candidate list (${cands.length})`);
let act = await D.tradableSyms('crypto');
ok(act.length === D.DCA.crypto.syms.filter(s => M.assets.includes(s)).length && !act.includes('ARB/USD'), 'no lab yet: the bot trades the hand-picked list (' + act.length + ' coins)');

// ---- simulator: core coins blocked, wider trail in bull runs ----
const P = await D._sim.prep('crypto', { syms: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD'], days: 400, timeframe: '4Hour', group: 2 });
ok(P.syms.length === 4 && P.bull.length === P.T.length && P.first['SOL/USD'] && P.tf === '4Hour', `prep for the lab: 4 coins, ${P.T.length} bars, bull regime ${Math.round(P.bull.reduce((a, x) => a + x, 0) / P.T.length * 100)}% of the time`);
const allOn = new Uint8Array(P.T.length).fill(1), r1 = D._sim.simulate({ ...P, coreOn: allOn, coreSyms: new Set(D.DCA.crypto.core) }, S0);
ok(r1.deals.length > 0 && r1.deals.every(d => d.s !== 'BTC/USD' && d.s !== 'ETH/USD'), `while the core holds BTC/ETH no deal starts in them (${r1.deals.length} deals, all in SOL/XRP)`);
const St = { ...S0, tr: 1, tp: 1 }, rA = D._sim.simulate({ ...P, bull: allOn }, St), rB = D._sim.simulate({ ...P, bull: allOn }, { ...St, tb: 8 });
const avgH = (r) => r.deals.reduce((a, d) => a + d.h, 0) / Math.max(1, r.deals.length);
ok(rB.deals.length !== rA.deals.length || avgH(rB) !== avgH(rA), `bull-run trail changes the deals (1% trail: ${rA.deals.length} deals, avg ${avgH(rA).toFixed(0)} h · 8% trail in bull runs: ${rB.deals.length} deals, avg ${avgH(rB).toFixed(0)} h)`);
const ce = L.coreEq({ ...P, bull: allOn }, 0.3, 10000), ce0 = L.coreEq({ ...P, bull: new Uint8Array(P.T.length) }, 0.3, 10000);
ok(ce.switches === 1 && Math.abs(ce0.eq.at(-1) - 3000) < 1e-6 && ce.eq.at(-1) !== 3000, `core: holds BTC+ETH through a bull regime (${ce.eq.at(-1).toFixed(0)} from $3,000), stays cash outside one`);

// ---- the lab through its route ----
let r = await (await import(T + 'routes/dcalab.js')).GET(new Request('http://x/api/dcalab'));
ok(r.status === 401, 'lab route needs the passcode');
const t0 = Date.now(); r = await (await import(T + 'routes/dcalab.js')).GET(new Request(`http://x/api/dcalab?k=${k}&run=1`)); const j = await r.json(), secs = (Date.now() - t0) / 1000;
const lab = j.lab;
ok(r.status === 200 && lab && lab.coins.length === CANDS.length && blob[D.LAB_KEY], `lab ran through the route in ${secs.toFixed(1)} s (local), ${lab?.coins.length} coins tested, saved to ${D.LAB_KEY}`);
ok(lab.coins.every((c, i, a) => i === 0 || a[i - 1].all.ret >= c.all.ret) && lab.coins.every(c => c.since && c.all && c.a && c.b), 'coins ranked best first, each with whole / first 2/3 / last 1/3 results');
const P1 = lab.pick, hand = D.DCA.crypto.syms.filter(s => CANDS.includes(s));
ok(P1.pickedOnFirstPart.every(s => { const c = lab.coins.find(x => x.s === s); return c.a.n >= L.LAB.minA && c.a.pnl > 0; }), `picking rule on the first two thirds keeps only coins that made money there (${P1.pickedOnFirstPart.length})`);
const helpsExpected = !!P1.test.picked && P1.test.picked.b.ret > 0 && P1.test.picked.b.ret > P1.test.every.b.ret && (!P1.test.hand || P1.test.picked.b.ret > P1.test.hand.b.ret);
ok(P1.use === helpsExpected && (P1.use || JSON.stringify(P1.active) === JSON.stringify(hand)), `pick used only if it beat every-coin and the hand list on the last third: use=${P1.use} (picked ${P1.test.picked?.b.ret}% vs every ${P1.test.every.b.ret}% vs hand ${P1.test.hand?.b.ret}%)`);
if (P1.use) ok(P1.active.filter(s => !D.isMeme(s)).length >= L.LAB.minReg, 'at least 6 regular coins traded');
const Bu = lab.bull, base0 = Bu.combos.find(c => !c.share && !c.tb);
ok(Bu.combos.length === 12 && Bu.combos.every(c => c.all && c.a && c.b && c.regime), 'bull-run mode: 12 mixes (core 0/30/50% × trail normal/3/5/8%) with results per period and per regime');
const bestExp = Bu.combos.filter(c => c.a.ret > 0).reduce((x, c) => !x || c.a.calmar > x.a.calmar ? c : x, null) || Bu.combos.reduce((x, c) => !x || c.a.calmar > x.a.calmar ? c : x, null);
ok(Bu.best.share === bestExp.share && Bu.best.tb === bestExp.tb && Bu.use === (bestExp !== base0 && bestExp.b.ret > base0.b.ret && bestExp.all.ret > base0.all.ret), `bull mix picked on the first two thirds (${Bu.best.share * 100}% core, trail ${Bu.best.tb}), used only if it also won on the last third and overall: use=${Bu.use}`);
ok(lab.holds['BTC/USD'] && lab.holds.activeEqual && lab.regime.base.bullTime >= 0 && Array.isArray(lab.regime.periods), `buy-and-hold comparisons + regime split: bot ${lab.regime.base.bullPct}% in BTC uptrends vs BTC ${lab.regime.base.btcBullPct}%`);
ok(/4-hour bars/.test(lab.assumptions) && /never saw|last third/.test(lab.assumptions), 'assumptions spelled out');
ok(j.bull && typeof j.bull.why === 'string', 'route also returns today\'s bull-run state: ' + j.bull.why);

// ---- live: the lab's picks and bull-run mode ----
const ACT = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD', 'AVAX/USD', 'ARB/USD', 'DOGE/USD'];
const LAB1 = { ...lab, at: new Date().toISOString(), pick: { ...lab.pick, use: true, active: ACT }, bull: { ...lab.bull, use: true, chosen: { share: 0.3, tb: 5 } } };
await setLab(LAB1); act = await D.tradableSyms('crypto');
ok(JSON.stringify(act) === JSON.stringify(ACT), 'lab picks become the traded list (ARB included, hand-list coins it left out dropped)');
M.btc = 'up'; await setLab(LAB1); let B = await D.bullState();
ok(B.use && B.on && B.share === 0.3 && B.tb === 5 && /uptrend/.test(B.why), 'BTC in an uptrend + lab says use it: bull-run mode ON (30% core, 5% trail): ' + B.why);
const ctx = (dry) => ({ dry, positions: positions().concat(extraPos), openAll: open, recent: orders, clock: { is_open: false }, taken: new Set(), allowNew: true, judge: null, markets: ['crypto'] });
let out = await D.runDca(ctx(true));
const cb = out.core.actions.filter(a => /would start bull-run core/.test(a.why));
ok(cb.length === 2 && cb.every(a => /\$2100/.test(a.why)), 'core would buy $2,100 each of BTC and ETH (30% of $14k over 2 coins): ' + cb.map(a => a.s).join(', '));
ok(out.started.every(x => x.s !== 'BTC/USD' && x.s !== 'ETH/USD') && out.started.length > 0 && out.started.every(x => Math.abs(x.usd - 980 * 0.15) < 0.01), `new deals skip BTC/ETH and are sized from $980 (70% of $14k over 10; first buy 15%): ${out.started.map(x => x.s).join(', ')}`);
ok(out.actions.some(a => a.s === 'SOL/USD' && /trailing take profit/.test(a.why)), 'the open SOL deal switches to a trailing take profit (5%) in bull-run mode: ' + out.actions.find(a => a.s === 'SOL/USD')?.why);
ok(out.notes.some(n => /^Bull-run mode: BTC is in an uptrend/.test(n)), 'run output explains bull-run mode');
posted.length = 0; out = await D.runDca({ ...ctx(false), markets: ['crypto'] });
const cp = posted.filter(o => /^tbhodl-\d{10}-(BTCUSD|ETHUSD)-b-/.test(o.client_order_id || ''));
ok(cp.length === 2 && cp.every(o => o.side === 'buy' && +o.qty > 0 && o.type === 'market'), 'real run: core market buys with tbhodl-… order ids: ' + cp.map(o => `${o.symbol} ${o.qty}`).join(', '));
ok(M.coreHistQ === 'BTC/USD,ETH/USD', 'core ownership looked up from each core coin\'s own order history (finds months-old holds)');
// held core + BTC leaves its uptrend -> sell
orders.unshift({ id: 'core-btc', symbol: 'BTC/USD', side: 'buy', qty: '0.03', filled_qty: '0.03', filled_avg_price: '60000', filled_at: new Date(Date.now() - 50 * DAY).toISOString(), submitted_at: new Date(Date.now() - 50 * DAY).toISOString(), status: 'filled', client_order_id: 'tbhodl-2608090000-BTCUSD-b-zabc' });
extraPos.push({ symbol: 'BTCUSD', qty: '0.03', qty_available: '0.03', avg_entry_price: '60000', current_price: '65000', market_value: '1950', unrealized_pl: '150', unrealized_plpc: '0.083', unrealized_intraday_plpc: '0', asset_class: 'crypto' });
M.btc = 'down'; await setLab(LAB1); B = await D.bullState(); ok(!B.on && B.use && /not in an uptrend/.test(B.why), 'BTC below its 200-day: bull-run mode off');
posted.length = 0; out = await D.runDca(ctx(false));
const cs = posted.find(o => /^tbhodl-\d{10}-BTCUSD-x-/.test(o.client_order_id || ''));
ok(cs && cs.side === 'sell' && +cs.qty === 0.03 && out.core.holdings.length === 1, 'core sells its BTC when the uptrend ends: ' + JSON.stringify(cs && { s: cs.symbol, qty: cs.qty }));
ok(!out.deals.some(d => d.s === 'BTC/USD') && !out.started.some(x => x.s === 'BTC/USD') && out.started.every(x => Math.abs(x.usd - 1400 * 0.15) < 0.01), 'the core BTC is never treated as a DCA deal; deals back to $1,400 each with bull mode off');
// a DCA deal already in ETH: the core waits instead of mixing into it
M.btc = 'up'; await setLab(LAB1); orders.splice(0, 1); extraPos.length = 0;
extraPos.push({ symbol: 'ETHUSD', qty: '1', qty_available: '1', avg_entry_price: '3000', current_price: '3000', market_value: '3000', unrealized_pl: '0', unrealized_plpc: '0', unrealized_intraday_plpc: '0', asset_class: 'crypto' });
orders.unshift({ id: 'dca-eth', symbol: 'ETH/USD', side: 'buy', qty: '1', filled_qty: '1', filled_avg_price: '3000', filled_at: new Date(Date.now() - 3600e3).toISOString(), submitted_at: new Date(Date.now() - 3600e3).toISOString(), status: 'filled', client_order_id: 'tbdca-2609281700-ETHUSD-b-u100-b3000-n4-d1.5-k1-v1.3-t1-x5-fa-zq9' });
out = await D.runDca(ctx(true));
ok(out.core.actions.some(a => a.s === 'ETH/USD' && /core waits: ETH\/USD is in a DCA deal/.test(a.why)) && out.core.actions.some(a => a.s === 'BTC/USD' && /would start/.test(a.why)), 'ETH is in a DCA deal: the core waits for it and still buys BTC');
orders.splice(0, 1); extraPos.length = 0;
// safety ladder blocks new trades: no core buys
out = await D.runDca({ ...ctx(true), allowNew: false, blockReason: 'Level 3 test' });
ok(out.core.actions.some(a => /core buys paused: Level 3 test/.test(a.why)) && !out.core.actions.some(a => /would start/.test(a.why)), 'safety ladder pause also pauses core buys');

// ---- stale lab ignored; health probe; history + bot view ----
await setLab({ ...LAB1, at: new Date(Date.now() - 11 * DAY).toISOString() });
ok((await D.labLatest()) === null && JSON.stringify(await D.tradableSyms('crypto')) === JSON.stringify(D.DCA.crypto.syms.filter(s => M.assets.includes(s))) && !(await D.bullState()).on, 'a lab older than 10 days is ignored: back to the hand list, bull mode off');
await setLab(LAB1);
const hj = await (await (await import(T + 'routes/health.js')).GET(new Request('http://x/api/health?probe=lab'))).json();
ok(hj.lab?.pickUse === true && hj.lab.active.length === ACT.length && hj.bull?.on === true, 'health ?probe=lab: summary + bull state');
orders.unshift({ id: 'core-eth', symbol: 'ETH/USD', side: 'buy', qty: '0.5', filled_qty: '0.5', filled_avg_price: '3000', filled_at: new Date(Date.now() - 2 * 3600e3).toISOString(), submitted_at: new Date(Date.now() - 2 * 3600e3).toISOString(), status: 'filled', client_order_id: 'tbhodl-2609281600-ETHUSD-b-zc1' });
extraPos.push({ symbol: 'ETHUSD', qty: '0.5', qty_available: '0.5', avg_entry_price: '3000', current_price: '3100', market_value: '1550', unrealized_pl: '50', unrealized_plpc: '0.03', unrealized_intraday_plpc: '0', asset_class: 'crypto' });
const H = await import(T + 'lib/history.js'), snap = await H.dailySnapshot({ safety: { level: 1, label: 'Normal' } });
ok(snap.open.cryptoCore === 1 && snap.settings.dcaLab?.pickUse && snap.modes.bullRun?.on === true && snap.v === (await import(T + 'lib/version.js')).VERSION, 'daily snapshot: core position counted, lab coins and bull-run state recorded');
ok(/bull core/.test(H.historyMarkdown({ days: [snap] })) && /bull-run mode ON/.test(H.historyMarkdown({ days: [snap] })), 'history Markdown shows the core column and bull-run mode');
const bv = await (await (await import(T + 'routes/botview.js')).GET(new Request(`http://x/api/botview?k=${k}`))).json();
ok(bv.events?.some(e => e.bot === 'Bull-run core' && /Bull-run core bought/.test(e.text)) && bv.dca?.bull?.on === true && bv.dca.markets.crypto.syms.includes('ARB') && bv.dca.markets.crypto.perDeal === 980, 'bot view: core buy in the event list, bull-run state, lab coins, $980 deals');
