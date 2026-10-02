// FRED series shared by the Macro tab and the bots (v0.11.0). Uses the FRED_API_KEY the Macro tab already has (no new key).
// liquidity(): a crypto-relevant read of money conditions. Dollar falling, M2 money growth rising and real yields falling have
// tended to go with crypto strength; the opposite with weakness. Recorded on each new crypto DCA deal (order id -q<e|m|t>) in
// shadow mode, so the scorecard can show whether it matters before it changes anything.
import { env, plain, round } from './core.js';

export const SERIES = [
  ['DGS10', '10-year Treasury', '%'], ['DGS2', '2-year Treasury', '%'], ['T10Y2Y', '10y minus 2y', 'pts'],
  ['DFF', 'Fed funds (effective)', '%'], ['BAMLH0A0HYM2', 'High-yield spread', 'pts'], ['VIXCLS', 'VIX close', ''],
  ['DCOILWTICO', 'WTI crude', '$'], ['DTWEXBGS', 'Dollar index (broad)', ''],
  ['CPIAUCSL', 'CPI inflation (YoY)', '%', 'yoy'], ['UNRATE', 'Unemployment rate', '%'],
  ['M2SL', 'M2 money supply (YoY)', '%', 'yoy'], ['DFII10', '10-year real yield (TIPS)', '%'], ['WALCL', 'Fed balance sheet ($ billions)', '', 'bn'],
];
const CACHE = new Map();
// Observations oldest first: [{ t, v }]. yoy = % change vs 12 observations earlier (monthly series); bn = millions -> billions.
export async function fredSeries(id, mode) {
  const c = CACHE.get(id); if (c && Date.now() - c.t < 6 * 36e5) return c.v;
  const key = env('FRED_API_KEY'); if (!key) throw new Error('FRED_API_KEY is not set');
  const d = await plain(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${key}&file_type=json&sort_order=desc&limit=${mode === 'yoy' ? 40 : 130}`);
  let obs = (d?.observations || []).filter(o => o.value !== '.').map(o => ({ t: o.date, v: +o.value })).reverse();
  if (mode === 'yoy') obs = obs.slice(12).map((o, i) => ({ t: o.t, v: (o.v / obs[i].v - 1) * 100 }));
  if (mode === 'bn') obs = obs.map(o => ({ t: o.t, v: o.v / 1000 }));
  CACHE.set(id, { t: Date.now(), v: obs }); return obs;
}
// What the Macro tab shows: latest value, change vs about a month earlier (one observation for monthly series), 60-point sparkline.
export async function macroSeries() {
  return Promise.all(SERIES.map(async ([id, name, unit, mode]) => {
    const obs = await fredSeries(id, mode).catch(() => []);
    if (!obs.length) return { id, name, unit, v: null };
    const lastV = obs.at(-1), prior = obs[Math.max(0, obs.length - (mode === 'yoy' || id === 'UNRATE' ? 2 : id === 'WALCL' ? 5 : 22))];
    return { id, name, unit, v: round(lastV.v, 2), t: lastV.t, chg: round(lastV.v - prior.v, 2), since: prior.t, spark: obs.slice(-60).map(o => round(o.v, 3)) };
  }));
}
const change = (obs, back) => obs.length > back ? obs.at(-1).v - obs[obs.length - 1 - back].v : null;
let LQ = null;
export async function liquidity() {
  if (LQ && Date.now() - LQ.t < 6 * 36e5) return LQ.v;
  const [dx, m2, ry] = await Promise.all([fredSeries('DTWEXBGS'), fredSeries('M2SL', 'yoy'), fredSeries('DFII10')]);
  const parts = [['dollar', change(dx, 63), -1, 'broad dollar index, 3 months'], ['m2', change(m2, 3), 1, 'M2 growth rate, 3 months'], ['realYield', change(ry, 63), -1, '10-year real yield, 3 months']];
  let score = 0; const detail = {};
  for (const [k, ch, good, what] of parts) { if (ch == null) continue; const s = Math.abs(ch) < (k === 'dollar' ? 0.5 : 0.05) ? 0 : Math.sign(ch) * good; score += s; detail[k] = { change: round(ch, 2), sign: s, what }; }
  const state = score >= 2 ? 'easing' : score <= -2 ? 'tightening' : 'mixed';
  const v = { state, score, detail, text: `money conditions ${state} (${Object.values(detail).map(d => `${d.what} ${d.change > 0 ? '+' : ''}${d.change}`).join(', ')})` };
  LQ = { t: Date.now(), v }; return v;
}
export const liqTag = (L) => L?.state ? '-q' + L.state[0] : '';
export const liqOf = (coid) => (/-q([emt])(?=-|$)/.exec(coid || '') || [])[1] ?? null;
export const LIQ_TXT = { e: 'easing', m: 'mixed', t: 'tightening' };
