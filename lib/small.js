// $100 plan (v0.12.0, crypto only): Eli's first real money. Two aggressive strategies, each with its own $100, side by side:
//   dca = concentrated DCA: 3 deals at once, 3 dip buys (so most of the money is actually working), bigger take profits.
//   mom = momentum: buy a coin breaking above its recent high, ride it with a trailing stop, no fixed target.
// Money rules (Eli, 2026-09-29): 3 slots; 75% of every realized profit goes back into trading, 25% goes to a vault the bot never
// trades; new entries stop if the account (trading + vault) falls under SMALL.floor. Alpaca's real crypto costs: 0.25% on market
// orders, 0.15% on resting limit orders, $1 minimum order; no margin, no shorting.
// Tested in the weekly DCA lab on up to 4 years of 4-hour bars (settings picked on the first two thirds, judged on the last third),
// then run live but VIRTUAL (no orders) on real prices at every crypto check (every tick since v0.14.0): Blob small/ledger-s2.json, written only when
// something changed (at most every 6 hours otherwise). Nothing here sends orders until a live account is switched on.
import { round, bars, snapshots, quoteOf } from './core.js';
import { blobReadJson, blobWriteJson } from './notify.js';
import { tradableCandidates, labLatest, rsiLast, DCA, minExitPx } from './dca.js';

export const SMALL = { start: 100, slots: 3, keep: 0.75, floor: 60, minOrder: 1, taker: 0.0025, maker: 0.0015, slip: 0.002 };
export const GRID = {
  dca: { n: [3], d: [2, 4], k: [1, 1.5], v: [1.5, 2], tp: [2, 3, 5], x: [10, 20], f: ['a', 't'], tr: [0, 4] },
  mom: { look: [30, 60, 120], tr: [8, 12, 18], btc: [0, 1] },
};
export const DEF = { dca: { n: 3, d: 3, k: 1.5, v: 2, tp: 3, x: 15, f: 't', tr: 4 }, mom: { look: 60, tr: 12, btc: 1 } };
export const NAMES = { dca: 'Concentrated DCA', mom: 'Momentum' };
// v0.14.0 (Season 2, Eli 2026-09-30: "reset the $100 too"): a new ledger file, so both virtual accounts restart at $100. The Season 1
// ledger stays in Blob at small/ledger.json (not read any more).
export const LEDGER_KEY = 'small/ledger-s2.json';
const combos = (g) => { let out = [{}]; for (const [k, vals] of Object.entries(g)) out = out.flatMap(o => vals.map(v => ({ ...o, [k]: v }))); return out; };
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
export const describeSmall = (m, S) => m === 'dca'
  ? `3 dip buys, first at −${S.d}%${S.k !== 1 ? `, gaps ×${S.k}` : ''}, each ${S.v}× the last · ${S.tr ? `trailing take profit from +${S.tp}% (${S.tr}% under the best price, never under +${S.tp / 2}%)` : `take profit +${S.tp}%`} · hard exit ${S.x}% under the last dip buy · ${S.f === 't' ? 'starts only above the 200-day average' : 'starts right away'}`
  : `buys a close above the ${S.look}-bar high (${Math.round(S.look * 4 / 24)} days of 4-hour bars)${S.btc ? ' while BTC is in an uptrend' : ''} · sells on a ${S.tr}% drop from the best price since the buy`;

// ---------------- one account (shared by the backtest and the live virtual ledger) ----------------
export const newAcct = (t) => ({ cash: SMALL.start, vault: 0, pos: {}, n: 0, wins: 0, peak: SMALL.start, dd: 0, hit2: null, hit10: null, killed: null, t0: t, last: [] });
const resOf = (A) => Object.values(A.pos).reduce((a, p) => a + (p.res || 0), 0);
export const freeCash = (A) => Math.max(0, A.cash - resOf(A));
export const markOf = (A, px) => A.cash + Object.entries(A.pos).reduce((a, [s, p]) => a + p.qty * (px[s] ?? p.lastPx), 0);
function buy(A, p, usd, px, fee) { const q = usd * (1 - fee) / px; p.qty += q; p.cost += usd; A.cash -= usd; if (p.res != null) p.res = Math.max(0, p.res - usd); }
function close(A, s, px, fee, why, t) {
  const p = A.pos[s], got = p.qty * px * (1 - fee), pnl = got - p.cost, toVault = pnl > 0 ? pnl * (1 - SMALL.keep) : 0;
  A.cash += got - toVault; A.vault += toVault; A.n++; if (pnl > 0) A.wins++; delete A.pos[s];
  const tr = { s, in: p.t0, out: t, cost: round(p.cost, 2), got: round(got, 2), pnl: round(pnl, 2), pct: round(pnl / p.cost * 100, 2), vault: round(toVault, 2), why, dips: p.k || 0 };
  A.last.unshift(tr); A.last.length = Math.min(A.last.length, 20); return tr;
}
function track(A, total, t) {
  A.peak = Math.max(A.peak, total); A.dd = Math.max(A.dd, (A.peak - total) / A.peak);
  if (!A.hit2 && total >= SMALL.start * 2) A.hit2 = t; if (!A.hit10 && total >= SMALL.start * 10) A.hit10 = t;
  if (!A.killed && total < SMALL.floor) A.killed = t;
}
// Money for a new position: an equal share of what is being traded now (75%-compounded profits included), never more than the free cash.
const slotUsd = (A, tradeEq) => Math.min(freeCash(A), tradeEq / SMALL.slots);

// Concentrated DCA: open a deal (market buy = taker fee), rest 3 dip buys (limit = maker fee).
// v0.13.1 (same rules as the paper DCA bot): first buy = DCA.firstPct % of the slot, the dip buys share the rest by the size step.
export function dcaOpen(A, s, px, S, t, tradeEq) {
  const R = slotUsd(A, tradeEq), u = R * DCA.firstPct / 100; if (u < SMALL.minOrder || R > A.cash + 1e-9) return null;
  const lv = []; let dev = 0, step = S.d, sv = 0; for (let j = 0; j < S.n; j++) sv += S.v ** j;
  for (let j = 1; j <= S.n; j++) { dev += step; step *= S.k; lv.push({ j, px: px * (1 - dev / 100), usd: (R - u) * S.v ** (j - 1) / sv, done: false }); }
  const p = A.pos[s] = { kind: 'dca', S, qty: 0, cost: 0, res: R, t0: t, start: px, lv, k: 0, peak: px, on: false, exitPx: S.x ? lv.at(-1).px * (1 - S.x / 100) : 0, lastPx: px };
  buy(A, p, u, px, SMALL.taker); return p;
}
// One bar (4-hour in the backtest, 1-hour live) for an open DCA deal. Returns a closed trade or null.
export function dcaBar(A, s, b, t) {
  const p = A.pos[s], S = p.S; let dip = false;
  for (const L of p.lv) if (!L.done && b.l <= L.px) { L.done = true; p.k = L.j; dip = true; p.peak = L.px; p.on = false; if (L.usd >= SMALL.minOrder && L.usd <= A.cash + 1e-9) buy(A, p, L.usd, L.px, SMALL.maker); }
  p.lastPx = b.c;
  if (p.exitPx && p.k >= S.n && b.l <= p.exitPx) return close(A, s, Math.min(b.o, p.exitPx) * (1 - SMALL.slip), SMALL.taker, 'hard exit', t);
  if (dip || !p.qty) return null;
  // v0.13.1: no take profit nets under DCA.minNetPct % after costs (cost = dollars paid in, fees included; the sell fee on top)
  const avg = p.cost / p.qty, act = Math.max(avg * (1 + S.tp / 100), minExitPx(p.qty, p.cost, SMALL.maker));
  if (!S.tr) return b.h >= act ? close(A, s, act, SMALL.maker, 'take profit', t) : null;
  if (p.on) { const minPx = minExitPx(p.qty, p.cost, SMALL.taker), floor = Math.max(p.peak * (1 - S.tr / 100), avg * (1 + S.tp / 200), minPx / (1 - SMALL.slip));
    if (b.l <= floor) { const fill = Math.min(b.o, floor) * (1 - SMALL.slip); if (fill >= minPx) return close(A, s, fill, SMALL.taker, 'trailing take profit', t); } } // a gap under the minimum waits for a bounce
  p.peak = Math.max(p.peak, b.h); if (p.peak >= act) p.on = true;
  return null;
}
// Momentum: all of the slot at market; a trailing stop from the best price since the buy, no target.
export function momOpen(A, s, px, S, t, tradeEq) {
  const R = slotUsd(A, tradeEq); if (R < SMALL.minOrder) return null;
  const p = A.pos[s] = { kind: 'mom', S, qty: 0, cost: 0, res: null, t0: t, start: px, peak: px, lastPx: px }; buy(A, p, R, px, SMALL.taker); return p;
}
export function momBar(A, s, b, t) {
  const p = A.pos[s], stop = p.peak * (1 - p.S.tr / 100); p.lastPx = b.c;
  if (b.o <= stop) return close(A, s, b.o * (1 - SMALL.slip), SMALL.taker, 'trailing stop', t);
  if (b.l <= stop) return close(A, s, stop * (1 - SMALL.slip), SMALL.taker, 'trailing stop', t);
  p.peak = Math.max(p.peak, b.h); return null;
}
// Entry signal on the last completed bar i-1: DCA = start rule + deepest hourly dip first; momentum = close above the prior `look` bars' high.
export function momSignal(h, c, i, look) {
  if (i - 1 - look < 0) return null; let hh = -Infinity; for (let j = i - 1 - look; j <= i - 2; j++) if (h[j] > hh) hh = h[j];
  return c[i - 1] > hh ? c[i - 1] / c[i - 1 - look] - 1 : null;
}

// ---------------- backtest (P from dca.js prep: 4-hour bars for every candidate coin, BTC bull regime) ----------------
export function simSmall(P, m, S, from = -Infinity, to = Infinity) {
  const A = newAcct(null), px = {}; let first = null, lastT = null;
  for (let ti = 0; ti < P.T.length; ti++) {
    const t = P.T[ti]; if (t < from || t >= to) continue; if (first == null) { first = t; A.t0 = t; }
    for (const s of P.syms) { const i = P.at[s][ti]; if (i >= 0) px[s] = P.x[s].o[i]; }
    // entries at this bar's open
    if (!A.killed && Object.keys(A.pos).length < SMALL.slots) {
      const tradeEq = markOf(A, px), cands = [];
      for (const s of P.syms) {
        if (A.pos[s]) continue; const i = P.at[s][ti]; if (i < 31) continue; const X = P.x[s];
        if (m === 'dca') { if (S.f === 't' && !X.trend[i]) continue; cands.push([s, X.rsi[i]]); }
        else { if (S.btc && !P.bull[ti]) continue; const g = momSignal(X.h, X.c, i, S.look); if (g != null) cands.push([s, -g]); }
      }
      cands.sort((a, z) => a[1] - z[1]);
      for (const [s] of cands) { if (Object.keys(A.pos).length >= SMALL.slots) break; const p = m === 'dca' ? dcaOpen(A, s, px[s], S, t, tradeEq) : momOpen(A, s, px[s], S, t, tradeEq); if (p) p.ti = ti; }
    }
    // manage every position on the rest of this bar, including the bar it opened on (v0.12.1 audit fix: entries happen at the open,
    // so that candle's later low can hit a dip buy or the stop). Inside one candle the order of high and low is unknown, so the
    // losing side is checked first: dip buys / stops before take profits, and the trailing stop before its best price is raised.
    for (const s of Object.keys(A.pos)) {
      const p = A.pos[s], i = P.at[s][ti]; if (i < 0) continue; const X = P.x[s], b = { o: X.o[i], h: X.h[i], l: X.l[i], c: X.c[i] };
      m === 'dca' ? dcaBar(A, s, b, t) : momBar(A, s, b, t); px[s] = X.c[i];
    }
    track(A, markOf(A, px) + A.vault, t); lastT = t;
  }
  const total = markOf(A, px) + A.vault, days = first != null ? Math.max(1, (lastT - first) / 864e5) : 0, dt = (x) => x ? Math.round((x - first) / 864e5) : null;
  return { from: first ? day(first) : null, to: lastT ? day(lastT) : null, days: Math.round(days), end: round(total, 2), vault: round(A.vault, 2), ret: round((total / SMALL.start - 1) * 100, 1),
    dd: round(A.dd * 100, 1), n: A.n, win: A.n ? round(A.wins / A.n * 100, 1) : null, open: Object.keys(A.pos).length, to2x: dt(A.hit2), to10x: dt(A.hit10), stopped: A.killed ? day(A.killed) : null };
}
const hold = (P, s, from, to) => { const X = P.x[s]; if (!X) return null; let a = null, z = null; for (let i = 0; i < X.t.length; i++) { if (X.t[i] >= from && a == null) a = X.o[i]; if (X.t[i] < to) z = X.c[i]; } return a && z ? round(SMALL.start * z / a, 2) : null; };
// Lab section: every setting on the first two thirds (fresh $100), the best by ending value, then judged on the last third (fresh $100).
export function smallLab(P) {
  const t0 = P.T[0], t1 = P.T.at(-1) + 1, split = t0 + (t1 - t0) * 2 / 3, out = {};
  for (const m of ['dca', 'mom']) {
    const rows = combos(GRID[m]).map(S => ({ S, a: simSmall(P, m, S, t0, split) }));
    const best = rows.reduce((x, r) => !x || r.a.end > x.a.end || (r.a.end === x.a.end && r.a.dd < x.a.dd) ? r : x, null);
    out[m] = { name: NAMES[m], tested: rows.length, S: best.S, text: describeSmall(m, best.S), a: best.a, b: simSmall(P, m, best.S, split, t1), all: simSmall(P, m, best.S, t0, t1),
      top: [...rows].sort((x, z) => z.a.end - x.a.end).slice(0, 5).map(r => ({ S: r.S, end: r.a.end, dd: r.a.dd, n: r.a.n })) };
  }
  const better = out.dca.b.end >= out.mom.b.end ? 'dca' : 'mom';
  return { at: new Date().toISOString(), rules: { ...SMALL }, split: day(split), better, ...out,
    btc: { a: hold(P, 'BTC/USD', t0, split), b: hold(P, 'BTC/USD', split, t1), all: hold(P, 'BTC/USD', t0, t1) },
    note: `Each run starts a fresh $${SMALL.start}. Settings are picked on the first two thirds (by ending value) and judged on the last third, which they never saw. ${SMALL.slots} positions at once; ${Math.round(SMALL.keep * 100)}% of each profit is traded again, ${Math.round((1 - SMALL.keep) * 100)}% goes to the vault; no new entries once the account is under $${SMALL.floor}. Costs: ${SMALL.taker * 100}% market, ${SMALL.maker * 100}% limit, ${SMALL.slip * 100}% slippage on stops; 4-hour bars.` };
}

// ---------------- live virtual ledger (real prices, no orders) ----------------
export async function readLedger({ fresh = true } = {}) { return blobReadJson(LEDGER_KEY, fresh ? { fresh: true } : undefined).catch(() => null); }
export const paramsNow = (L) => { const dca = L?.small?.dca?.S || DEF.dca, mom = L?.small?.mom?.S || DEF.mom;
  return { dca, mom, text: { dca: describeSmall('dca', dca), mom: describeSmall('mom', mom) }, src: L?.small ? `picked by the DCA lab (${day(Date.parse(L.small.at || L.at))})` : 'starting defaults (the DCA lab has not run yet)' }; };
export async function runSmall({ now = Date.now(), dry = false } = {}) {
  let st = await readLedger(), changed = false; const H = 36e5, notes = [];
  if (!st?.acct) { st = { v: 1, since: new Date(now).toISOString(), last: Math.floor(now / H) * H, saved: 0, acct: { dca: newAcct(now), mom: newAcct(now) } }; changed = true; }
  const L = await labLatest().catch(() => null), prm = paramsNow(L); st.params = prm;
  const cands = await tradableCandidates(), held = [...new Set(Object.values(st.acct).flatMap(A => Object.keys(A.pos)))];
  // 1) positions: every completed hour since the last check
  if (held.length) {
    const hb = await bars(held, { timeframe: '1Hour', start: new Date(st.last).toISOString() }).catch(() => ({}));
    const hours = [...new Set(held.flatMap(s => (hb[s] || []).map(b => Date.parse(b.t))))].filter(t => t >= st.last && t + H <= now).sort((a, z) => a - z);
    for (const t of hours) for (const [m, A] of Object.entries(st.acct)) for (const s of Object.keys(A.pos)) {
      const b = (hb[s] || []).find(x => Date.parse(x.t) === t); if (!b || t < A.pos[s].t0) continue;
      const p = A.pos[s], k0 = p.k, on0 = p.on;
      const tr = m === 'dca' ? dcaBar(A, s, b, t) : momBar(A, s, b, t); if (tr) { tr.m = m; notes.push(`${NAMES[m]}: ${tr.why} ${s} ${tr.pnl >= 0 ? '+' : '−'}$${Math.abs(tr.pnl).toFixed(2)}`); }
      if (tr || p.k !== k0 || p.on !== on0) { changed = true; if (!tr && p.k !== k0) notes.push(`${NAMES[m]}: dip buy #${p.k} filled ${s}`); } // a best-price change alone is replayed from the saved hour next time (no Blob write)
    }
    if (hours.length) st.last = hours.at(-1) + H;
  } else st.last = Math.floor(now / H) * H;
  // 2) entries: signals from completed 4-hour bars, filled at the live price
  const free = Object.values(st.acct).some(A => !A.killed && Object.keys(A.pos).length < SMALL.slots);
  let sn = {};
  if (free && cands.length) {
    const [b4, d1] = await Promise.all([bars(cands, { timeframe: '4Hour', days: 25 }), bars([...new Set([...cands, 'BTC/USD'])], { timeframe: '1Day', days: 330 })]).catch(() => [{}, {}]);
    sn = await snapshots(cands).catch(() => ({}));
    const today = new Date(now).toISOString().slice(0, 10), sma = (s, n) => { const c = (d1[s] || []).filter(x => String(x.t).slice(0, 10) < today).map(x => x.c); return c.length >= n ? [c.at(-1), c.slice(-n).reduce((a, v) => a + v, 0) / n] : null; };
    const btc200 = sma('BTC/USD', 200), btc50 = sma('BTC/USD', 50), bull = !!(btc200 && btc50 && btc200[0] > btc200[1] && btc50[1] > btc200[1]);
    for (const [m, A] of Object.entries(st.acct)) {
      if (A.killed || Object.keys(A.pos).length >= SMALL.slots) continue;
      const S = prm[m], pxNow = Object.fromEntries(cands.map(s => { const q = quoteOf(s, sn[s]); return [s, q?.ask || q?.p]; })), tradeEq = markOf(A, pxNow), list = [];
      for (const s of cands) {
        if (A.pos[s] || !pxNow[s]) continue; const B = (b4[s] || []).filter(x => Date.parse(x.t) + 4 * H <= now); if (B.length < 32) continue;
        if (m === 'dca') { const tr = sma(s, 200); if (S.f === 't' && !(tr && tr[0] > tr[1])) continue; list.push([s, rsiLast(B.map(x => x.c))]); }
        else { if (S.btc && !bull) continue; const g = momSignal(B.map(x => x.h), B.map(x => x.c), B.length, S.look); if (g != null) list.push([s, -g]); }
      }
      list.sort((a, z) => a[1] - z[1]);
      for (const [s] of list) { if (Object.keys(A.pos).length >= SMALL.slots) break; const p = m === 'dca' ? dcaOpen(A, s, pxNow[s], S, now, tradeEq) : momOpen(A, s, pxNow[s], S, now, tradeEq); if (p) { changed = true; notes.push(`${NAMES[m]}: bought $${p.cost.toFixed(2)} ${s} @ ${pxNow[s]}`); } }
    }
  }
  // 3) mark to market, vault, milestones, the $60 floor
  if (!Object.keys(sn).length && held.length) sn = await snapshots(held).catch(() => ({}));
  const px = {}; for (const [s, x] of Object.entries(sn)) { const q = quoteOf(s, x); if (q?.p) px[s] = q.p; }
  for (const A of Object.values(st.acct)) { const before = A.killed; track(A, markOf(A, px) + A.vault, now); if (A.killed !== before) { changed = true; notes.push('account under the floor: no new entries'); } }
  st.at = new Date(now).toISOString();
  if (!dry && (changed || now - (st.saved || 0) > 6 * H)) { st.saved = now; await blobWriteJson(LEDGER_KEY, st, 60).catch(() => null); }
  return { ...ledgerView(st, px), notes, saved: !dry && st.saved === now };
}
// What the page shows: value now, vault, open positions with P&L, recent trades, params.
export function ledgerView(st, px = {}) {
  if (!st?.acct) return null;
  const acct = Object.fromEntries(Object.entries(st.acct).map(([m, A]) => {
    const trade = markOf(A, px), total = trade + A.vault;
    return [m, { name: NAMES[m], total: round(total, 2), trading: round(trade, 2), cash: round(A.cash, 2), vault: round(A.vault, 2), ret: round((total / SMALL.start - 1) * 100, 1), n: A.n, win: A.n ? round(A.wins / A.n * 100, 1) : null,
      dd: round(A.dd * 100, 1), hit2: A.hit2, hit10: A.hit10, killed: A.killed, last: A.last.slice(0, 8),
      open: Object.entries(A.pos).map(([s, p]) => { const now = px[s] ?? p.lastPx, val = p.qty * now; return { s, cost: round(p.cost, 2), value: round(val, 2), pl: round(val - p.cost, 2), start: p.start, now, since: p.t0,
        dips: p.lv ? `${p.k}/${p.lv.length}` : null, next: p.lv?.find(L => !L.done) ? { px: p.lv.find(L => !L.done).px, usd: round(p.lv.find(L => !L.done).usd, 2) } : null,
        stop: p.kind === 'mom' ? p.peak * (1 - p.S.tr / 100) : p.on ? Math.max(p.peak * (1 - p.S.tr / 100), p.cost / p.qty * (1 + p.S.tp / 200), minExitPx(p.qty, p.cost, SMALL.taker) / (1 - SMALL.slip)) : null }; }) }];
  }));
  return { since: st.since, at: st.at, params: st.params, rules: { ...SMALL }, acct };
}
