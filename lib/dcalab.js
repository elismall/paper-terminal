// DCA lab (v0.11.0, crypto): the questions a real-money DCA bot has to answer, tested on the longest history Alpaca gives
// (up to 4 years, 4-hour bars):
//   1. Which coins make money with the bot's own rules? Each coin is replayed alone with the same settings. Coins that lose are
//      left out, but only if that picking rule, applied to the first two thirds of the history, also beat trading every coin
//      (and the hand-picked list) on the last third, which it never saw. Otherwise the bot keeps the hand-picked list.
//   2. How does the bot do in BTC bull runs vs the rest of the time, next to simply holding BTC or ETH?
//   3. Bull-run mode: hold part of the crypto budget in BTC/ETH while BTC is in an uptrend and/or widen the trailing take profit.
//      The best mix is picked on the first two thirds and switched on live only if it also beat normal deals on the last third.
//   4. (v0.12.0) The $100 plan (lib/small.js): concentrated DCA vs momentum on a fresh $100 each, same data, same honest split.
// Runs weekly (cron, Sunday about 5:10 AM ET) or from the DCA tab. One Blob write per run (dca/lab-v1.json), plus the stored price
// history it adds to (lib/hist.js). v0.12.2: histFill() downloads older history in the background (/api/hist cron) until complete.
import { round } from './core.js';
import { DCA, _sim, isMeme, budgetOf, capsOf, LAB_KEY, describe, tradableCandidates, tradableSyms, resetLab, GRIDS, combos } from './dca.js';
import { histBars, histStatus, histLine, statusKey } from './hist.js';
import { blobWriteJson } from './notify.js';
import { smallLab } from './small.js';

export const LAB = { days: 1460, timeframe: '4Hour', minA: 5, minAll: 8, minReg: 6, minPickDeals: 20, budgetMs: 150e3, shares: [0, 0.3, 0.5], trails: [0, 3, 5, 8] };
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const { prep, simulate, metrics } = _sim;

const view = (P, syms, extra = {}) => ({ ...P, syms, meme: syms.map(isMeme), caps: capsOf('crypto', syms), ...extra });
function coinStats(r, per, from, to) {
  const ds = r.deals.filter(d => d.out >= from && d.out < to), n = ds.length, pnl = ds.reduce((a, d) => a + d.pnl, 0);
  return { n, pnl: round(pnl, 2), ret: round(pnl / per * 100, 2), win: n ? round(ds.filter(d => d.pnl > 0).length / n * 100, 1) : null,
    worst: n ? round(Math.min(...ds.map(d => d.pct)), 2) : null, exits: ds.filter(d => d.why === 'exit').length, avgHours: n ? round(ds.reduce((a, d) => a + d.h, 0) / n, 1) : null };
}
// Buy and hold from the first price in the window to the last, in %.
export function holdRet(P, s, from, to) {
  const X = P.x[s]; if (!X) return null; let i0 = -1, i1 = -1;
  for (let i = 0; i < X.t.length; i++) { if (X.t[i] >= from && i0 < 0) i0 = i; if (X.t[i] < to) i1 = i; }
  return i0 >= 0 && i1 > i0 ? round((X.c[i1] / X.o[i0] - 1) * 100, 1) : null;
}
// The bull-run core on the same time grid: `share` of the budget in BTC + ETH (equal parts) while P.bull is on, cash otherwise.
export function coreEq(P, share, B) {
  const coins = DCA.crypto.core.filter(s => P.x[s]), eq = new Float64Array(P.T.length), last = {}, qty = {}; let cash = B * share, hold = false, switches = 0;
  for (let ti = 0; ti < P.T.length; ti++) {
    for (const s of coins) { const i = P.at[s][ti]; if (i >= 0) last[s] = P.x[s].o[i]; }
    const want = share > 0 && !!P.bull[ti] && coins.length > 0 && coins.every(s => last[s]);
    if (want && !hold) { for (const s of coins) qty[s] = cash / coins.length * (1 - P.fee) / last[s]; cash = 0; hold = true; switches++; }
    else if (!want && hold) { for (const s of coins) { cash += qty[s] * last[s] * (1 - P.fee); qty[s] = 0; } hold = false; switches++; }
    eq[ti] = cash + coins.reduce((a, s) => a + (qty[s] || 0) * (last[s] || 0), 0);
  }
  return { eq, switches };
}
// How much of a run's gain came while BTC was in a bull regime vs the rest (% of the budget), and the same split for holding BTC.
function byRegime(P, r, B) {
  let bull = 0, rest = 0, nb = 0, bb = 1, br = 1, lastBtc = null; const bx = P.x['BTC/USD'];
  for (let i = 1; i < r.eqV.length; i++) { const dv = r.eqV[i] - r.eqV[i - 1]; if (P.bull[i]) { bull += dv; nb++; } else rest += dv; }
  if (bx) for (let ti = 0; ti < P.T.length; ti++) { const i = P.at['BTC/USD'][ti]; if (i < 0) continue; const px = bx.o[i]; if (lastBtc) { if (P.bull[ti]) bb *= px / lastBtc; else br *= px / lastBtc; } lastBtc = px; }
  return { bullPct: round(bull / B * 100, 2), restPct: round(rest / B * 100, 2), bullTime: round(nb / Math.max(1, r.eqV.length - 1) * 100, 1), btcBullPct: round((bb - 1) * 100, 1), btcRestPct: round((br - 1) * 100, 1) };
}
function periods(P) {
  const out = []; let s0 = null;
  for (let i = 0; i < P.T.length; i++) { if (P.bull[i] && s0 == null) s0 = i; if ((!P.bull[i] || i === P.T.length - 1) && s0 != null) { out.push({ from: day(P.T[s0]), to: day(P.T[i]), days: Math.round((P.T[i] - P.T[s0]) / 864e5), btc: P.x['BTC/USD'] ? holdRet(P, 'BTC/USD', P.T[s0], P.T[i] + 1) : null }); s0 = null; } }
  return out.filter(p => p.days >= 3);
}
const pickM = (m) => ({ n: m.n, ret: m.ret, dd: m.dd, calmar: m.calmar, win: m.win, exits: m.exits });

export async function runLab({ save = true, days = LAB.days, timeframe = LAB.timeframe } = {}) {
  const t00 = Date.now(), cand = await tradableCandidates();
  const P = await prep('crypto', { syms: cand, days, timeframe, budgetMs: LAB.budgetMs });
  if (P.syms.length < 3 || P.T.length < 400) throw new Error(`not enough crypto history for the lab yet (${P.syms.length} coins, ${P.T.length} bars)${P.histComplete ? '' : '; older history is still downloading and was saved, run it again later'}`);
  const tData = Date.now(), B = budgetOf('crypto'), per = B / DCA.crypto.maxDeals, t0 = P.T[0], t1 = P.T.at(-1) + 1, split = t0 + (t1 - t0) * 2 / 3;
  const hand = DCA.crypto.syms.filter(s => P.x[s]);
  // v0.12.1 (audit fix): the lab picks its own deal settings on its first two thirds only (the daily training's settings were tuned on
  // the last 365 days, which sit inside the lab's "unseen" third). Same grid and scoring as the daily training.
  const pickRows = combos(GRIDS.crypto).map(S0 => ({ S: S0, m: metrics(simulate(view(P, hand.length ? hand : P.syms, { stopAt: split }), S0), B, t0, split) }));
  const okPick = pickRows.filter(r => r.m.n >= LAB.minPickDeals && r.m.ret > 0);
  const S = (okPick.length ? okPick : pickRows).reduce((a, r) => !a || r.m.calmar > a.m.calmar ? r : a, null).S, tPick = Date.now();
  // 1) every coin alone, same settings, one deal at a time with a normal deal's money
  const coins = P.syms.map(s => {
    const r = simulate(view(P, [s], { budget: per, maxDeals: 1, caps: { reg: 1, meme: 1 } }), S);
    return { s, meme: isMeme(s), since: P.first[s], hand: hand.includes(s), all: coinStats(r, per, t0, t1), a: coinStats(r, per, t0, split), b: coinStats(r, per, split, t1), hold: holdRet(P, s, t0, t1) };
  }).sort((a, z) => z.all.ret - a.all.ret);
  const A = coins.filter(c => c.a.n >= LAB.minA && c.a.pnl > 0).map(c => c.s);
  const port = (syms) => { const r = simulate(view(P, syms), S); return { all: pickM(metrics(r, B, t0, t1)), a: pickM(metrics(r, B, t0, split)), b: pickM(metrics(r, B, split, t1)) }; };
  const test = { picked: A.length >= 3 ? port(A) : null, every: port(P.syms), hand: hand.length ? port(hand) : null };
  // The coin list the bull-run test uses must also come from the first two thirds only (A), so its last-third result stays unseen.
  const testList = A.length >= 3 ? A : hand.length ? hand : P.syms;
  const helps = !!test.picked && test.picked.b.ret > 0 && test.picked.b.ret > test.every.b.ret && (!test.hand || test.picked.b.ret > test.hand.b.ret);
  let active = hand, blocked = [];
  if (helps) {
    const keep = coins.filter(c => c.all.n >= LAB.minAll && c.all.pnl > 0);
    const reg = keep.filter(c => !c.meme);
    if (reg.length < LAB.minReg) reg.push(...coins.filter(c => !c.meme && !reg.includes(c) && c.hand).slice(0, LAB.minReg - reg.length)); // too few winners: top up from the hand list, best first
    active = [...reg, ...keep.filter(c => c.meme)].map(c => c.s);
    blocked = coins.filter(c => !active.includes(c.s)).map(c => ({ s: c.s, why: c.all.n < LAB.minAll ? `only ${c.all.n} deals in the test (needs ${LAB.minAll})` : `lost $${Math.abs(c.all.pnl)} over ${c.all.n} deals` }));
  }
  // 2) + 3) the bot's normal deals vs bull-run mode (core share x trailing in bull runs), on a coin list chosen from the first two thirds
  const bullRows = [];
  for (const share of LAB.shares) for (const tb of LAB.trails) {
    const core = coreEq(P, share, B), r = simulate(view(P, testList, { budget: B * (1 - share), coreOn: share > 0 ? P.bull : null, coreSyms: new Set(DCA.crypto.core) }), { ...S, tb });
    const rc = { deals: r.deals, eqT: r.eqT, eqV: r.eqV.map((v, i) => v + core.eq[i]) };
    bullRows.push({ share, tb, switches: core.switches, all: pickM(metrics(rc, B, t0, t1)), a: pickM(metrics(rc, B, t0, split)), b: pickM(metrics(rc, B, split, t1)), regime: byRegime(P, rc, B) });
  }
  const base = bullRows.find(c => !c.share && !c.tb), okA = bullRows.filter(c => c.a.ret > 0);
  const best = (okA.length ? okA : bullRows).reduce((x, c) => !x || c.a.calmar > x.a.calmar ? c : x, null);
  const use = best !== base && best.b.ret > base.b.ret && best.b.ret > 0; // decided on the unseen third only
  const holds = Object.fromEntries(['BTC/USD', 'ETH/USD'].filter(s => P.x[s]).map(s => [s, { all: holdRet(P, s, t0, t1), a: holdRet(P, s, t0, split), b: holdRet(P, s, split, t1) }]));
  const ew = (from, to) => { const v = active.map(s => holdRet(P, s, from, to)).filter(x => x != null); return v.length ? round(v.reduce((a, x) => a + x, 0) / v.length, 1) : null; };
  holds.activeEqual = { all: ew(t0, t1), a: ew(t0, split), b: ew(split, t1) };
  const out = {
    // v2 (v0.12.2): made on the stored history. partial = older history was still downloading: shown, but the bot doesn't use it.
    at: new Date().toISOString(), v: 3, partial: !P.histComplete, hist: P.hist, from: day(t0), to: day(t1 - 1), split: day(split), timeframe: P.tf, bars: P.T.length, budget: B, perDeal: per,
    settings: { S, text: describe(S), source: `picked by the lab on ${day(t0)} → ${day(split)} only (${pickRows.length} settings tested, best return ÷ worst drop with ${LAB.minPickDeals}+ deals), so the last third stays unseen` },
    coverage: P.coverage,
    coins, pick: { use: helps, active, blocked, pickedOnFirstPart: A, test, rule: `keep coins that made money over ${LAB.minAll}+ deals (${LAB.minA}+ in the first two thirds for the check); at least ${LAB.minReg} regular coins` },
    regime: { periods: periods(P), base: base.regime }, holds,
    bull: { use, chosen: use ? { share: best.share, tb: best.tb } : null, best: { share: best.share, tb: best.tb }, base: { all: base.all, a: base.a, b: base.b }, combos: bullRows, testList,
      rule: 'Bull regime = BTC daily close above its 200-day average and the 50-day above the 200-day. Core = share of the crypto budget in BTC + ETH (equal parts) while that holds; tb = trailing take profit % used on deals during bull regimes.' },
    small: smallLab(P),
    ms: { data: tData - t00, pick: tPick - tData, total: Date.now() - t00 },
    assumptions: `${P.tf === '4Hour' ? '4-hour' : P.tf} bars from ${day(t0)} to ${day(t1 - 1)} (coins listed later are judged on the history they have: see "since"). In this test orders change every ${P.tf === '4Hour' ? '4 hours' : 'bar'}; the live bot checks every hour, so real fills differ a little. ${(P.fee * 100).toFixed(2)}% cost per fill, no taxes. Same deal rules for every coin (picked by the lab on the first two thirds). Core: bought at the first bar after BTC's bull regime starts, sold the first bar after it ends; no new deals in BTC/ETH while the core holds them. Picked on the first two thirds, judged on the last third (${day(split)} on).`,
  };
  if (save) { await blobWriteJson(LAB_KEY, out, 3600); resetLab(); }
  return out;
}
// Short form for the health probe and the bot view.
export const labSummary = (L) => !L ? null : { at: L.at, v: L.v || 1, partial: !!L.partial, from: L.from, to: L.to, coins: L.coins?.length, pickUse: L.pick?.use, active: L.pick?.active, blocked: L.pick?.blocked?.map(b => b.s),
  bullUse: L.bull?.use, bull: L.bull?.chosen, baseRet: L.bull?.base?.all?.ret, btcHold: L.holds?.['BTC/USD']?.all, ms: L.ms,
  coverage: L.coverage ? { used: L.coverage.filter(c => c.used !== false).length, of: L.coverage.length, out: L.coverage.filter(c => c.used === false).map(c => `${c.s} (${c.why})`) } : null,
  small: L.small ? { better: L.small.better, dca: { S: L.small.dca.S, b: L.small.dca.b?.end, all: L.small.dca.all?.end }, mom: { S: L.small.mom.S, b: L.small.mom.b?.end, all: L.small.mom.all?.end } } : null };

// v0.12.2: background download of older crypto history for the daily training (hourly, 365 days), the lab (4-hour, 4 years) and both
// of their daily trend data. Each job stops as soon as its history is complete (one small status read), so once everything is
// downloaded the /api/hist runs cost almost nothing; the training and the lab keep adding the newest candles themselves.
export async function histFill({ budgetMs = 240e3, force = false } = {}) {
  const t0 = Date.now(), st = force ? null : await histStatus();
  const [train, cand] = await Promise.all([tradableSyms('crypto'), tradableCandidates()]);
  const jobs = [
    { tf: '1Hour', syms: train, days: DCA.trainDays },
    { tf: '1Day', syms: [...new Set([...train, ...cand, 'BTC/USD'])], days: LAB.days + 330 },
    { tf: '4Hour', syms: cand, days: LAB.days },
  ], out = [];
  for (const j of jobs) {
    const s = st?.[statusKey(j.tf, j.days)];
    if (s && s.coins >= j.syms.length && s.complete >= s.coins) { out.push({ tf: j.tf, days: j.days, skipped: 'already complete' }); continue; }
    const left = budgetMs - (Date.now() - t0); if (left < 25e3) { out.push({ tf: j.tf, days: j.days, skipped: 'out of time for this run' }); continue; }
    const H = await histBars(j.syms, { timeframe: j.tf, days: j.days, budgetMs: left - 15e3 });
    out.push({ tf: j.tf, days: j.days, ...histLine(H) });
  }
  return { at: new Date().toISOString(), ms: Date.now() - t0, jobs: out, done: out.every(j => j.skipped === 'already complete' || (j.complete != null && j.complete === j.coins)) };
}
