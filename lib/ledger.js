// Candidate ledger (v0.16.0, Phase A). Every stock run that may enter records the setups it looked at and what happened to
// each: taken, skipped (and why), no slot left, below the score bar, setup paused, or dropped by the pre-market gap check.
// After the fact every candidate is graded the SAME way, whether it was bought or not, so the filters can be judged:
// "did the ones we passed on do better or worse than the ones we took?"
//   entry  = the price the run saw (live quote); stop/target/hold = the trained setting that run used (ATR multiples)
//   walk   = daily candles from the session AFTER the decision day (the rest of the decision day is ignored for everyone),
//            stop and target from their levels, a candle that gaps past a level exits at its open, a candle touching both
//            is "ambiguous" and counted apart, otherwise exit at the close of the last holding day
//   R      = after 0.05% costs a side (same as training)
// One Blob file per New York day (ledger/cand/<day>.json, one write per entering run) + an index with the graded rows.
// Research only: nothing here places, changes or blocks an order.
import { bars, round } from './core.js';
import { blobGet, blobPut } from './notify.js';
import { walk } from './walk.js';
import { COST } from './perf.js';

export const CL = { dayKey: (d) => `ledger/cand/${d}.json`, indexKey: 'ledger/cand-index.json', belowBar: 10, keepDays: 60, minN: 20, gradeDays: 30, cost: COST };
const nyDay = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

export function reasonOf(why = '') {
  const w = String(why);
  if (/already up/.test(w)) return 'chased: ran too far';
  if (/below where the stop/.test(w)) return 'already under the stop';
  if (/no live quote/.test(w)) return 'no quote';
  if (/^AI filter/.test(w)) return 'Jev filter';
  if (/^news/.test(w)) return 'news rule';
  if (/margin|rounds to 0/.test(w)) return 'no room / size 0';
  if (/rejected/.test(w)) return 'order rejected';
  return 'other';
}
export const STATUS_LABEL = { taken: 'Taken', skipped: 'Skipped', no_slot: 'Qualified, no slot left', below_bar: 'Below the score bar', paused_setup: 'Setup paused (losing)', gap: 'Gap check skipped it' };

// Build this run's ledger rows. c = candidates in score order; price(s) = the live price the run saw.
export function ledgerRows({ at, mode, P, minScore, all, placed, skipped, blockedHits = [], gapSkipped = [], price }) {
  const rows = [], seen = new Set(), base = (r) => ({ s: r.s, setup: r.setup, score: r.score, atr: round(r.atr, 4), ref: round(r.px, 4) });
  const add = (row) => { if (seen.has(row.s)) return; seen.add(row.s); const px = price(row.s); rows.push({ ...row, px: px ? round(px, 4) : null, t: at, mode, stopAtr: P.stop, targetAtr: P.target, hold: P.hold }); };
  for (const p of placed) { const r = all.find(x => x.s === p.s); if (r) add({ ...base(r), status: 'taken', px0: p.entry }); }
  for (const k of skipped) { const r = all.find(x => x.s === k.s); if (r) add({ ...base(r), status: 'skipped', why: k.why, reason: reasonOf(k.why) }); }
  for (const r of all.filter(x => x.score >= minScore)) add({ ...base(r), status: 'no_slot' });
  for (const r of all.filter(x => x.score < minScore).slice(0, CL.belowBar)) add({ ...base(r), status: 'below_bar' });
  for (const r of blockedHits.slice(0, CL.belowBar)) add({ ...base(r), status: 'paused_setup' });
  for (const g of gapSkipped) if (!seen.has(g.s)) { seen.add(g.s); rows.push({ s: g.s, status: 'gap', why: g.why, t: at, mode }); }
  for (const r of rows) if (r.status === 'taken' && r.px0 && !r.px) r.px = r.px0;
  return rows;
}

// Merge a run's rows into the day file. The first sighting of a symbol keeps its price and plan; a later run can only
// upgrade the status (e.g. below the bar at 10:00 AM, taken at 11:15 AM). One read + one write per run.
const RANK = { gap: 0, below_bar: 1, paused_setup: 1, no_slot: 2, skipped: 3, taken: 4 };
export async function candAdd(rows, { now = Date.now() } = {}) {
  if (!rows?.length) return { saved: false };
  const day = nyDay(now), key = CL.dayKey(day);
  const f = (await blobGet(key, { fresh: true }).catch(() => null)) || { day, items: {} };
  for (const r of rows) {
    const o = f.items[r.s];
    if (!o) { f.items[r.s] = { ...r, runs: 1 }; continue; }
    o.runs = (o.runs || 1) + 1;
    if ((RANK[r.status] ?? 0) > (RANK[o.status] ?? 0)) { o.status = r.status; o.why = r.why; o.reason = r.reason; o.upgradedAt = r.t; if (r.status === 'taken') { o.px = r.px || o.px; o.t = r.t; o.mode = r.mode; } }
    if (!o.px && r.px) o.px = r.px;
  }
  f.at = new Date(now).toISOString();
  await blobPut(key, JSON.stringify(f), { maxAge: 60 });
  const idx = (await blobGet(CL.indexKey, { fresh: true }).catch(() => null)) || { days: {}, rows: [] };
  if (!idx.days[day]) { idx.days[day] = { graded: false }; idx.at = f.at; await blobPut(CL.indexKey, JSON.stringify(idx), { maxAge: 60 }); }
  return { saved: true, day, n: Object.keys(f.items).length };
}

const rMult = (entry, exit, stop, c = CL.cost) => { const risk = Math.abs(entry - stop) + 2 * c * entry; return risk > 0 ? round((exit - entry - c * (entry + exit)) / risk, 2) : null; };
// Grade one candidate on daily candles B (oldest first). Returns null while its holding window is still open.
export function gradeCand(it, B) {
  if (!it.px || !it.atr || !it.hold) return { why: 'no price', r: null };
  const d = nyDay(Date.parse(it.t)), i0 = B.findIndex(b => nyDay(Date.parse(b.t)) > d); if (i0 < 0) return null;
  const end = i0 + it.hold - 1; if (end >= B.length) return null;
  const stop = it.px - it.stopAtr * it.atr, target = it.px + it.targetAtr * it.atr;
  const w = walk(B, i0, end, { entry: it.px, stop, target, up: true });
  return { why: w.why, r: w.why === 'ambiguous' ? null : rMult(it.px, w.exit, stop), exitDay: nyDay(Date.parse(B[w.i].t)) };
}

const stat = (list) => { const g = list.filter(x => x.r != null), n = g.length; return { n, amb: list.filter(x => x.why === 'ambiguous').length, avgR: n ? round(g.reduce((a, x) => a + x.r, 0) / n, 2) : null, win: n ? round(g.filter(x => x.r > 0).length / n * 100, 1) : null }; };
export function candScore(rows) {
  const groups = [['Taken', (x) => x.status === 'taken'], ['Qualified, no slot left', (x) => x.status === 'no_slot'], ['Skipped (all reasons)', (x) => x.status === 'skipped'],
    ...['chased: ran too far', 'Jev filter', 'news rule', 'already under the stop', 'no room / size 0'].map(r => [`  · ${r}`, (x) => x.status === 'skipped' && x.reason === r]),
    ['Below the score bar', (x) => x.status === 'below_bar'], ['Setup paused (losing)', (x) => x.status === 'paused_setup']];
  return { minN: CL.minN, graded: rows.filter(x => x.r != null).length, rows: groups.map(([label, f]) => ({ label, ...stat(rows.filter(f)) })).filter(g => g.n || g.amb || !/^ {2}/.test(g.label)) };
}

// Evening tick: grade every day file whose candidates' windows have ended (up to CL.gradeDays back). Graded rows go into the
// index (last CL.keepDays days), so the Benchmark reads one small file.
export async function gradeCandidates({ now = Date.now() } = {}) {
  const idx = (await blobGet(CL.indexKey, { fresh: true }).catch(() => null)) || { days: {}, rows: [] };
  const todo = Object.entries(idx.days).filter(([d, v]) => !v.graded && Date.parse(d) > now - CL.gradeDays * 864e5 * 2).map(([d]) => d).sort();
  let changed = false, graded = 0, waiting = 0;
  for (const d of todo) {
    const f = await blobGet(CL.dayKey(d), { fresh: true }).catch(() => null); if (!f) { idx.days[d] = { graded: true, missing: true }; changed = true; continue; }
    const items = Object.values(f.items).filter(x => x.status !== 'gap' && x.px);
    const syms = [...new Set(items.map(x => x.s))];
    const B = syms.length ? await bars(syms, { timeframe: '1Day', start: new Date(Date.parse(d) - 3 * 864e5).toISOString() }).catch(() => null) : {};
    if (!B) continue;
    let open = 0; const out = [];
    for (const it of items) { const g = gradeCand(it, B[it.s] || []); if (!g) { open++; continue; } out.push({ d, s: it.s, setup: it.setup, score: it.score, status: it.status, reason: it.reason || null, mode: it.mode, ...g }); }
    if (open && Date.parse(d) > now - CL.gradeDays * 864e5) { waiting += open; continue; } // grade the day once every window has ended
    idx.rows = [...(idx.rows || []).filter(x => x.d !== d), ...out]; idx.days[d] = { graded: true, n: out.length }; graded += out.length; changed = true;
  }
  const cut = nyDay(now - CL.keepDays * 864e5);
  idx.rows = (idx.rows || []).filter(x => x.d >= cut); for (const d of Object.keys(idx.days)) if (d < cut) delete idx.days[d];
  if (changed) { idx.at = new Date(now).toISOString(); await blobPut(CL.indexKey, JSON.stringify(idx), { maxAge: 60 }); }
  return { graded, waiting, score: candScore(idx.rows || []) };
}
export async function candReport() {
  const idx = await blobGet(CL.indexKey).catch(() => null);
  const days = Object.keys(idx?.days || {}).sort();
  return { days: days.length, since: days[0] || null, pending: days.filter(d => !idx.days[d].graded).length, score: candScore(idx?.rows || []), method: 'Each candidate graded the same way whether bought or not: entry at the price the run saw, the trained stop/target/hold, daily candles from the next session, R after 0.05% costs a side; candles touching both levels = ambiguous (counted apart).' };
}
