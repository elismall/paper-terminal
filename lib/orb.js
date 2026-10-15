// Opening-range shadow (v0.16.0, Phase A). Eli wants first-hour plays; before any first-hour strategy trades, this records what a
// plain opening-range breakout WOULD have done, every trading day, without placing anything. Rules fixed in advance:
//   range    the first 30 minutes (9:30–10:00 AM ET, six 5-minute candles, full-market SIP data)
//   filters  price $5+; range width 0.4%–4% of price
//   signal   the first 5-minute candle starting 10:00–11:25 AM that CLOSES above the range high on volume at least 1.2× the
//            average range candle (long only, like the bot); one signal per stock per day
//   entry    the NEXT candle's open (no peeking); stop = range low; target = entry + 2 × (entry − stop)
//   exit     first touch of stop or target on 5-minute candles; a candle opening past a level exits at its open; a candle
//            touching both = ambiguous (counted apart); otherwise the last candle's close before the bell (a day trade)
//   R        after 0.05% costs a side (same as training)
// Runs once a day at the 4:20 PM ET wrap tick from that day's candles (a replay, so it cannot see the future of any signal).
// Files: shadow/orb/<day>.json (the day's signals) + shadow/orb-index.json (last 120 days of results). Never trades.
import { bars, round } from './core.js';
import { blobGet, blobGetStrict, blobPut, blobDel, blobUrl } from './notify.js';
import { BOT_UNIVERSE, COST } from './perf.js';
import { etNow } from './schedule.js';

export const ORB = { rangeMin: 30, lastSignalMin: 115, volX: 1.2, minPx: 5, minW: 0.004, maxW: 0.04, rr: 2, cost: COST, keepDays: 120, minN: 30, dayKey: (d) => `shadow/orb/${d}.json`, indexKey: 'shadow/orb-index.json' };
const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
// ET wall time on a day -> UTC ms (tries both offsets, so daylight saving is handled without a time zone library)
export function etMs(day, min) { for (const off of [4, 5]) { const t = Date.parse(`${day}T00:00:00Z`) + (min + off * 60) * 6e4; const p = etNow(t); if (p.day === day && p.min === min) return t; } return null; }
const rMult = (entry, exit, stop, c = ORB.cost) => { const risk = Math.abs(entry - stop) + 2 * c * entry; return risk > 0 ? round((exit - entry - c * (entry + exit)) / risk, 2) : null; };

// One stock's 5-minute candles for one session (oldest first, regular session only) -> signal + outcome, or null.
export function orbOne(B, { open, close }) {
  const m = (b) => etNow(Date.parse(b.t)).min, rng = B.filter(b => m(b) >= open && m(b) < open + ORB.rangeMin);
  if (rng.length < 5) return null;
  const hi = Math.max(...rng.map(b => b.h)), lo = Math.min(...rng.map(b => b.l)), mid = (hi + lo) / 2, w = (hi - lo) / mid, avgV = rng.reduce((a, b) => a + b.v, 0) / rng.length;
  if (mid < ORB.minPx || w < ORB.minW || w > ORB.maxW) return null;
  const after = B.filter(b => m(b) >= open + ORB.rangeMin && m(b) < close);
  const k = after.findIndex(b => m(b) <= open + ORB.lastSignalMin && b.c > hi && b.v >= ORB.volX * avgV);
  if (k < 0 || k + 1 >= after.length) return null;
  const sig = after[k], e = after[k + 1], entry = e.o, stop = lo;
  if (!(entry > stop)) return null;
  const target = entry + ORB.rr * (entry - stop);
  let why = 'close', exit = after.at(-1).c, at = after.at(-1).t;
  for (const b of after.slice(k + 1)) {
    if (b.o <= stop) { why = 'stop'; exit = b.o; at = b.t; break; }
    if (b.o >= target) { why = 'target'; exit = b.o; at = b.t; break; }
    const hs = b.l <= stop, ht = b.h >= target;
    if (hs && ht) { why = 'ambiguous'; exit = null; at = b.t; break; }
    if (hs) { why = 'stop'; exit = stop; at = b.t; break; }
    if (ht) { why = 'target'; exit = target; at = b.t; break; }
  }
  return { sigAt: sig.t, sigMin: m(sig), entryAt: e.t, hi: round(hi, 4), lo: round(lo, 4), wPct: round(w * 100, 2), volX: round(sig.v / avgV, 2), entry: round(entry, 4), stop: round(stop, 4), target: round(target, 4), why, exit: exit == null ? null : round(exit, 4), exitAt: at, r: why === 'ambiguous' ? null : rMult(entry, exit, stop) };
}

const stat = (list) => { const g = list.filter(x => x.r != null), n = g.length; return { n, amb: list.filter(x => x.why === 'ambiguous').length, avgR: n ? round(g.reduce((a, x) => a + x.r, 0) / n, 2) : null, win: n ? round(g.filter(x => x.r > 0).length / n * 100, 1) : null, targets: g.filter(x => x.why === 'target').length, stops: g.filter(x => x.why === 'stop').length }; };
export function orbScore(rows) {
  const t = (x) => x.sigMin - 570; // minutes after 9:30
  const groups = [['All signals', () => true], ['Signal 10:00–10:30 AM', x => t(x) < 60], ['Signal 10:30–11:25 AM', x => t(x) >= 60], ['Narrow range (under 1%)', x => x.wPct < 1], ['Wide range (1% or more)', x => x.wPct >= 1], ['Volume 2× or more', x => x.volX >= 2]];
  const days = [...new Set(rows.map(x => x.d))];
  return { minN: ORB.minN, days: days.length, rows: groups.map(([label, f]) => ({ label, ...stat(rows.filter(f)) })) };
}

// The 4:20 PM wrap: replay today's session. session = Alpaca calendar row ({ date, open: '09:30', close: '16:00' }).
export async function orbRun(session, { now = Date.now(), universe = BOT_UNIVERSE } = {}) {
  if (!session?.date) return { skipped: 'no session today' };
  const day = session.date, open = toMin(session.open), close = toMin(session.close);
  if (etNow(now).day !== day || etNow(now).min < close + 16) return { skipped: 'the session has not finished (SIP candles are 15 minutes behind)' };
  const idx = (await blobGetStrict(ORB.indexKey)) || { days: {}, rows: [] }; // v0.20.0 (audit #3): a read error throws, never saves over the index
  if (idx.days[day]) return { skipped: 'already recorded', day, signals: idx.days[day].n };
  const syms = universe.filter(s => s !== 'SPY');
  const B = await bars(syms, { timeframe: '5Min', start: new Date(etMs(day, open)).toISOString(), end: new Date(etMs(day, close)).toISOString(), limitPages: 12 });
  const got = Object.keys(B).length; if (got < syms.length * 0.5) return { error: `only ${got} of ${syms.length} stocks returned candles`, day };
  const sig = [];
  for (const s of syms) { const x = B[s]?.length ? orbOne(B[s], { open, close }) : null; if (x) sig.push({ d: day, s, ...x }); }
  await blobPut(ORB.dayKey(day), JSON.stringify({ day, at: new Date(now).toISOString(), checked: got, rules: { ...ORB, dayKey: undefined }, signals: sig }), { maxAge: 60 });
  const cut = new Date(now - ORB.keepDays * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  idx.days[day] = { n: sig.length, checked: got };
  idx.rows = [...(idx.rows || []).filter(r => r.d !== day && r.d >= cut), ...sig.map(({ d, s, sigMin, wPct, volX, why, r }) => ({ d, s, sigMin, wPct, volX, why, r }))];
  const old = Object.keys(idx.days).filter(d => d < cut); for (const d of old) delete idx.days[d];
  idx.at = new Date(now).toISOString();
  await blobPut(ORB.indexKey, JSON.stringify(idx), { maxAge: 60 });
  if (old.length) await blobDel(old.map(d => blobUrl(ORB.dayKey(d)))).catch(() => null); // v0.20.0 (audit #13): old day files are deleted
  return { day, checked: got, signals: sig.length, score: orbScore(idx.rows) };
}
export async function orbReport() {
  const idx = await blobGet(ORB.indexKey).catch(() => null);
  const days = Object.keys(idx?.days || {}).sort(), last = days.at(-1);
  const today = last ? await blobGet(ORB.dayKey(last)).catch(() => null) : null;
  return { since: days[0] || null, last, score: orbScore(idx?.rows || []), latest: today ? today.signals.slice(0, 40).map(({ s, sigAt, entry, stop, target, why, r, wPct, volX }) => ({ s, sigAt, entry, stop, target, why, r, wPct, volX })) : [],
    rules: 'Range = first 30 minutes; signal = first 5-minute candle from 10:00 to 11:25 AM ET that closes above the range high on 1.2× the range volume; entry = next candle\'s open; stop = range low; target = 2R; exit by the close; R after 0.05% costs a side. Shadow only: nothing is traded.' };
}
