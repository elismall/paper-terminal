// v0.13.1 (Eli: "train on what we will actually do"): 3 dip buys, first buy = 15% of the deal, every take profit nets >= 0.5% after
// costs (a percentage, so it works the same on the $100 plan), old deals keep their old sizing (order ids), $100 plan uses the same rules.
import { blob, M } from './mock.mjs';
const T = new URL('../', import.meta.url).href;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const D = await import(T + 'lib/dca.js'), Sm = await import(T + 'lib/small.js');

// ---- 1. rules and grids ----
ok(D.DCA.firstPct === 15 && D.DCA.minNetPct === 0.5, 'first buy 15% of the deal, minimum 0.5% net after costs');
ok(['crypto', 'etf'].every(m => D.GRIDS[m].n.length === 1 && D.GRIDS[m].n[0] === 3), 'training uses 3 dip buys only (crypto and ETFs), like the real-money plan');
const nc = D.combos(D.GRIDS.crypto).length, ne = D.combos(D.GRIDS.etf).length;
ok(nc <= 864 && ne <= 288, `training stays within the old run time (${nc} crypto, ${ne} ETF settings; was 864 / 288)`);
const deep = Math.max(...D.combos(D.GRIDS.crypto).map(S => D.ladder(S, 100, 1).at(-1).dev)), shallow = Math.min(...D.combos(D.GRIDS.crypto).map(S => D.ladder(S, 100, 1).at(-1).dev));
ok(shallow >= 5 && deep >= 18, `3 dip buys cover a real drop: deepest dip ${shallow}% to ${deep}% below the start`);
ok(D.TRAIN_KEY === 'dca/train-v6.json', 'new training key: trainings on the old rules are not reused');

// ---- 2. sizing ----
for (const [S0, per] of [[{ n: 3, d: 2, k: 1.5, v: 2, tp: 2.5, x: 8, f: 't', tr: 0 }, 1400], [{ n: 3, d: 4, k: 1, v: 1.5, tp: 4, x: 15, f: 'a', tr: 4 }, 33.33]]) {
  const S = D.withP(S0), u = D.firstBuy(S, per), lv = D.ladder(S, 100, u), tot = u + lv.reduce((a, L) => a + L.usd, 0);
  ok(Math.abs(u - per * 0.15) < 1e-9 && Math.abs(tot - per) < 1e-6 && Math.abs(D.dealSize(S, u) - per) < 1e-6 && lv[1].usd / lv[0].usd === S.v,
    `$${per} deal: first buy $${u.toFixed(2)} (15%), dip buys ${lv.map(L => '$' + L.usd.toFixed(2)).join(' / ')} (×${S.v} each), total $${tot.toFixed(2)}`);
}
const legacy = { n: 6, d: 2.5, k: 1.4, v: 1.8, tp: 1, x: 5, f: 't', tr: 1 }, uL = 1400 / D.factor(legacy);
ok(Math.abs(D.firstBuy(legacy, 1400) - uL) < 1e-9 && Math.abs(D.ladder(legacy, 100, uL)[5].usd - uL * 1.8 ** 5) < 1e-9 && Math.abs(D.dealSize(legacy, uL) - 1400) < 1e-6,
  `a deal opened before v0.13.1 (no -p in its ids) keeps its old ladder (first buy $${uL.toFixed(2)})`);

// ---- 3. order ids carry the first-buy share ----
const ids = [];
M.positions = []; M.openOrders = [];
const parsedNew = D.parseDca('tbdca-2609291405-BTCUSD-b-u210.00-b65000-n3-d2-k1.5-v2-t2.5-x8-ft-p15-j24e3r1d2-h1-qe-zabc1'), parsedOld = D.parseDca('tbdca-2609281405-BTCUSD-s2-u33.10-b65000-n6-d2.5-k1.4-v1.8-t1-x5-ft-r1-j24-zabc2');
ok(parsedNew?.S.p === 15 && parsedNew.S.n === 3 && parsedNew.u === 210 && parsedOld && parsedOld.S.p === undefined && parsedOld.S.tr === 1, 'ids: new deals record -p15 (after the trail tag, before Jev/signal tags); old ids still parse, with no p');
ok(Math.abs(D.dealSize(parsedNew.S, parsedNew.u) - 1400) < 1e-6 && Math.abs(D.dealSize(parsedOld.S, parsedOld.u) - 33.10 * D.factor(parsedOld.S)) < 1e-6, 'money set aside per deal comes from its own id (new: first buy ÷ 15%; old: first buy × ladder factor)');
const longest = 'tbdca-2609291405-TRUMPUSD-s3-u210.00-b0.0000123456-n3-d4-k1.5-v1.5-t2.5-x15-fd-r4-p15-j99e9r9d9-h2-qt-z1a2b3c4d';
ok(longest.length <= 128, `longest order id fits Alpaca's 128 characters (${longest.length})`);

// ---- 4. minimum profit: price math ----
const qty = 1, cost = 100 * 1.0025, mp = D.minExitPx(qty, cost, 0.0025);
ok(Math.abs(qty * mp * (1 - 0.0025) - cost * 1.005) < 1e-9 && mp > 100.99 && mp < 101.02, `$100 bought at 0.25% cost needs ${((mp / 100 - 1) * 100).toFixed(2)}% to net 0.5% after both fees`);
const tp = D.trailPlan(100, { tp: 1, tr: 1 }, 101.2, 100.6, mp);
ok(tp.act >= mp && tp.minF >= mp && (tp.want?.type !== 'market' || 100.6 >= mp), `trailing take profit never sells under the minimum (starts at ${tp.act.toFixed(3)}, never under ${tp.minF.toFixed(3)}; old rule: never under 100.50)`);
const tp2 = D.trailPlan(100, { tp: 4, tr: 2 }, 106, 105, mp);
ok(Math.abs(tp2.act - 104) < 1e-9 && Math.abs(tp2.minF - 102) < 1e-9, 'with a +4% target the old rules already clear the minimum (the floor changes nothing)');

// ---- 5. backtest: no take profit nets under 0.5% ----
const n = 400, t = Array.from({ length: n }, (_, i) => Date.UTC(2026, 0, 1) + i * 36e5);
const c = t.map((_, i) => 100 * (1 + 0.012 * Math.sin(i / 5) + 0.004 * Math.sin(i / 1.7))), o = c.map((v, i) => i ? c[i - 1] : v), h = c.map((v, i) => Math.max(v, o[i]) * 1.002), l = c.map((v, i) => Math.min(v, o[i]) * 0.998);
const X = { t, o, h, l, c, rsi: new Float64Array(n).fill(30), trend: new Uint8Array(n).fill(1) };
const sp = (fee) => ({ market: 'crypto', syms: ['X/USD'], x: { 'X/USD': X }, T: t, at: { 'X/USD': Int32Array.from(t.map((_, i) => i)) }, run: t.map(() => true), fee, budget: 1400, maxDeals: 1, caps: { reg: 1, meme: 0 }, meme: [false], active: 3, bull: new Uint8Array(n) });
for (const S of [{ n: 3, d: 2, k: 1, v: 2, tp: 0.3, x: 0, f: 'a', tr: 0 }, { n: 3, d: 2, k: 1, v: 2, tp: 0.4, x: 0, f: 'a', tr: 1 }]) {
  const r = D._sim.simulate(sp(0.0025), S), tpd = r.deals.filter(d => d.why === 'tp'), minNet = 1400 * 0.15 * 1.0025 * 0.005;
  const worst = Math.min(...tpd.map(d => d.pnl)), r0 = D._sim.simulate({ ...sp(0.0025), minNetPct: 0 }, S), worst0 = Math.min(...r0.deals.filter(d => d.why === 'tp').map(d => d.pnl));
  ok(tpd.length >= 3 && worst >= minNet - 1e-6 && worst0 < minNet, `${S.tr ? 'trailing' : 'plain'} take profit (+${S.tp}% target): ${tpd.length} wins, smallest $${worst.toFixed(2)} (at least 0.5% of the $210 first buy after costs = $${minNet.toFixed(2)}); without the floor the smallest was $${worst0.toFixed(2)}`);
}

// ---- 6. $100 plan: same rules ----
const A = Sm.newAcct(0), p = Sm.dcaOpen(A, 'X/USD', 100, { n: 3, d: 2, k: 1.5, v: 2, tp: 3, x: 15, f: 'a', tr: 0 }, 0, 100);
const slot = 100 / Sm.SMALL.slots;
ok(p && Math.abs(p.cost - slot * 0.15) < 1e-9 && Math.abs(p.lv.reduce((a, L) => a + L.usd, 0) - slot * 0.85) < 1e-9, `$100 plan: first buy $${p?.cost.toFixed(2)} (15% of the $${slot.toFixed(2)} slot), dip buys share the rest`);
const B = Sm.newAcct(0), q = Sm.dcaOpen(B, 'X/USD', 100, { n: 3, d: 2, k: 1.5, v: 2, tp: 0.2, x: 15, f: 'a', tr: 0 }, 0, 100);
const early = Sm.dcaBar(B, 'X/USD', { o: 100.3, h: 100.4, l: 100.2, c: 100.3 }, 1), later = Sm.dcaBar(B, 'X/USD', { o: 100.5, h: 101, l: 100.4, c: 100.9 }, 2);
ok(early === null && later && later.got >= later.cost * 1.005 - 0.006, `$100 plan: a +0.2% target waits for 0.5% net after costs (paid $${later?.cost}, got back $${later?.got} after fees; amounts shown rounded to cents)`);
