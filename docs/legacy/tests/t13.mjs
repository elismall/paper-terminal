// v0.12.0 $100 plan (lib/small.js): account math (3 slots, 75% compound / 25% vault, $1 minimum, $60 floor, real Alpaca crypto
// costs), both strategies' bar logic, the backtest + walk-forward pick in the DCA lab, the live virtual ledger (Blob writes only
// when something changed), and the routes that show it.
import { blob, M, ops } from './mock.mjs';
const T = new URL('../', import.meta.url).href;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
M.assets = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD', 'AVAX/USD', 'LTC/USD', 'ADA/USD', 'DOT/USD', 'DOGE/USD', 'SHIB/USD', 'PEPE/USD'];
const Sm = await import(T + 'lib/small.js'), D = await import(T + 'lib/dca.js'), L = await import(T + 'lib/dcalab.js');
const { tokenFor } = await import(T + 'lib/core.js'), k = tokenFor('pw');
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e, S = Sm.SMALL;

// ---- account math ----
let A = Sm.newAcct(0);
const Sd = { n: 3, d: 2, k: 1, v: 2, tp: 3, x: 10, f: 'a', tr: 0 };
let p = Sm.dcaOpen(A, 'SOL/USD', 100, Sd, 0, 100);
ok(near(p.res + p.cost, 100 / 3) && near(p.cost, 100 / 3 * 0.15) && near(p.qty, 100 / 3 * 0.15 * (1 - S.taker) / 100), `DCA deal: slot = $100 / 3 = $33.33, first buy = 15% of the slot (v0.13.1) = $${p.cost.toFixed(2)}, 0.25% market fee`);
ok(p.lv.map(L => +L.px.toFixed(2)).join() === '98,96,94' && p.lv.map(L => +L.usd.toFixed(2)).join() === [0, 1, 2].map(i => +(100 / 3 * 0.85 * 2 ** i / 7).toFixed(2)).join(), 'three dip buys at −2/−4/−6%, each 2× the last, sharing the other 85%: ' + p.lv.map(L => `$${L.usd.toFixed(2)} @ ${L.px.toFixed(2)}`).join(', '));
ok(near(Sm.freeCash(A), 100 - 100 / 3), 'the rest of the slot stays set aside for the dip buys (free cash $66.67)');
Sm.dcaBar(A, 'SOL/USD', { o: 99, h: 99.5, l: 97.9, c: 98.2 }, 1);
ok(p.k === 1 && near(p.cost, 100 / 3 * 0.15 + 100 / 3 * 0.85 / 7), 'dip buy #1 ($4.05) fills when the bar trades through $98 (limit order, 0.15% fee)');
const avg = p.cost / p.qty, cost = p.cost;
let tr = Sm.dcaBar(A, 'SOL/USD', { o: 99, h: avg * 1.031, l: 98.5, c: 101 }, 2);
const got = p.qty * avg * 1.03 * (1 - S.maker), pnl = got - cost;
ok(tr && tr.why === 'take profit' && near(tr.pnl, pnl, 0.01) && near(A.vault, pnl * 0.25) && near(A.cash, 100 - cost + got - pnl * 0.25), `take profit +3%: profit $${pnl.toFixed(2)} → 75% back into trading, 25% ($${A.vault.toFixed(2)}) to the vault`);
const big = Sm.newAcct(0); big.cash = 400; const p2 = Sm.dcaOpen(big, 'ADA/USD', 1, Sd, 0, 400);
ok(near(p2.cost + p2.res, 400 / 3), 'compounding: a bigger account gets bigger slots ($400 → $133.33 per deal)');
const tiny = Sm.newAcct(0); tiny.cash = 6; ok(Sm.dcaOpen(tiny, 'ADA/USD', 1, Sd, 0, 6) === null && !Object.keys(tiny.pos).length, 'no deal when the first buy would be under the $1 minimum order');
// momentum
A = Sm.newAcct(0); p = Sm.momOpen(A, 'DOGE/USD', 0.2, { look: 30, tr: 10, btc: 0 }, 0, 100);
ok(near(p.cost, 100 / 3) && near(A.cash, 100 - 100 / 3), 'momentum: the whole slot at market ($33.33)');
Sm.momBar(A, 'DOGE/USD', { o: 0.2, h: 0.3, l: 0.21, c: 0.29 }, 1);
tr = Sm.momBar(A, 'DOGE/USD', { o: 0.29, h: 0.29, l: 0.26, c: 0.27 }, 2);
ok(tr && tr.why === 'trailing stop' && near(tr.got, p.qty * 0.27 * (1 - S.slip) * (1 - S.taker), 0.01) && tr.pnl > 0, `trailing stop 10% under the best price ($0.30 → sells at $0.27): +$${tr.pnl} (${tr.pct}%)`);
const h = [1, 1, 1, 1, 1.2], c = [1, 1, 1, 1, 1.3];
ok(Sm.momSignal(h, c, 5, 3) > 0 && Sm.momSignal([1, 1, 1, 1, 1], [1, 1, 1, 1, 0.9], 5, 3) === null, 'breakout signal: last close above the prior N bars\' high, none otherwise');

// ---- backtest + lab ----
const cands = await D.tradableCandidates();
const P = await D._sim.prep('crypto', { syms: cands, days: 720, timeframe: '4Hour', group: 6, limitPages: 30 });
const r = Sm.simSmall(P, 'mom', { look: 60, tr: 12, btc: 0 });
ok(r.end > 0 && r.n > 0 && r.dd >= 0 && r.from && r.to, `momentum backtest runs on ${P.syms.length} coins: $100 → $${r.end} (${r.n} trades, worst drop ${r.dd}%, vault $${r.vault})`);
const PK = { ...P, x: Object.fromEntries(Object.entries(P.x).map(([s, X]) => [s, { ...X, o: X.o.map((v, i) => i > 300 ? v * 0.3 : v), h: X.h.map((v, i) => i > 300 ? v * 0.3 : v), l: X.l.map((v, i) => i > 300 ? v * 0.3 : v), c: X.c.map((v, i) => i > 300 ? v * 0.3 : v) }])) };
const rk = Sm.simSmall(PK, 'dca', { ...Sd, x: 0 });
ok(rk.stopped && rk.end < S.floor + 40, `every coin crashes 70%: the account drops under $${S.floor} and stops new entries (stopped ${rk.stopped}, ends $${rk.end})`);
const t0 = Date.now(), lab = Sm.smallLab(P), ms = Date.now() - t0;
ok(lab.dca.tested === 192 && lab.mom.tested === 18 && lab.dca.S.n === 3 && ['dca', 'mom'].includes(lab.better) && lab.dca.b.from === lab.split && lab.btc.all != null, `lab: 192 DCA + 18 momentum settings picked on the first two thirds, judged on the last third (${ms} ms); better on unseen data: ${lab.better}`);
ok(lab.dca.a.end === Math.max(...lab.dca.top.map(t => t.end)) && lab.mom.all.from === lab.dca.all.from, 'the pick is the best ending value on the first two thirds; every window starts a fresh $100');
M.btc = null; blob[D.LAB_KEY] = JSON.stringify({ at: new Date().toISOString(), v: 3, small: { ...lab, dca: { ...lab.dca, S: { ...Sd } } } }); D.resetLab(); await D.labLatest({ fresh: true });
const prm = Sm.paramsNow(await D.labLatest());
ok(prm.dca.tp === 3 && /picked by the DCA lab/.test(prm.src) && /3 dip buys/.test(prm.text.dca), 'live settings come from the latest lab run: ' + prm.text.dca);

// ---- live virtual ledger ----
delete blob[Sm.LEDGER_KEY]; const H = 36e5, now0 = Math.floor(Date.now() / H) * H - 30 * H;
let a0 = ops.adv, v1 = await Sm.runSmall({ now: now0 });
ok(v1.saved && blob[Sm.LEDGER_KEY] && ops.adv - a0 === 1 && v1.acct.dca.open.length === 3 && v1.acct.dca.open.every(o => o.cost > 4.9 && o.cost < 5.1), `first run: the DCA account opens 3 deals of about $5.00 (15% of a $33 slot), momentum buys only on a breakout (${v1.acct.mom.open.length} now); ledger saved once (${v1.notes.slice(0, 3).join(' · ')})`);
const dcaOpenN = v1.acct.dca.open.length; a0 = ops.adv;
const v2 = await Sm.runSmall({ now: now0 + 10 * 6e4 });
ok(!v2.saved && ops.adv === a0, 'ten minutes later with no completed hour: nothing changed, no Blob write');
const v3 = await Sm.runSmall({ now: now0 + 30 * H });
const st3 = JSON.parse(blob[Sm.LEDGER_KEY]);
ok(v3.saved && st3.last > now0 && Object.values(v3.acct).every(x => x.total > 0), `30 hours of hourly bars replayed: DCA $${v3.acct.dca.total} (${v3.acct.dca.n} closed), momentum $${v3.acct.mom.total} (${v3.acct.mom.n} closed); ${v3.notes.length} events`);
ok(Object.values(v3.acct).every(x => near(x.total, x.trading + x.vault, 0.02)) && v3.acct.dca.open.every(o => /\/3$/.test(o.dips)), 'value = trading + vault; open DCA deals show their dip buys (x/3)');
a0 = ops.adv; const vd = await Sm.runSmall({ now: now0 + 31 * H, dry: true });
ok(ops.adv === a0 && vd.acct, 'preview (dry) never writes');

// ---- routes ----
const lr = await (await (await import(T + 'routes/dcalab.js')).GET(new Request(`http://x/api/dcalab?k=${k}`))).json();
ok(lr.small?.acct?.dca && lr.small.params?.text?.mom && lr.lab?.small?.better, 'GET /api/dcalab: $100 accounts at live prices + the lab backtest');
const hj = await (await (await import(T + 'routes/health.js')).GET(new Request('http://x/api/health?probe=small'))).json();
ok(hj.small?.acct?.mom && hj.version === (await import(T + 'lib/version.js')).VERSION, 'health ?probe=small (preview, no write)');
const fullLab = await L.runLab({ save: false, days: 400 });
ok(fullLab.small?.dca?.S && fullLab.small?.mom?.S && L.labSummary(fullLab).small?.better, `the weekly lab run includes the $100 plan (${fullLab.ms.total} ms total)`);
