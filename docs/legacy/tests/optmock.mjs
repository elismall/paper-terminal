// v0.13.0 test fakes on top of tests/mock.mjs + tests/newsmock.mjs: an option chain (Alpaca options snapshots, indicative feed),
// SEC full-text search (efts.sec.gov), a longer SEC filing history with acceptance times, and years of headlines for the
// Catalyst Scenario tests. Each is only active while its M.* switch is set, so older tests are unaffected.
import { M } from './mock.mjs';
import './newsmock.mjs';
import { hourly } from './mockdata.mjs';
const DAY = 864e5, day = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
const N = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
// Black-Scholes at 30% IV, 4% rate: good enough to give sensible deltas and prices
function bs(S, K, T, call, iv = 0.3, r = 0.04) {
  const d1 = (Math.log(S / K) + (r + iv * iv / 2) * T) / (iv * Math.sqrt(T)), d2 = d1 - iv * Math.sqrt(T);
  const px = call ? S * N(d1) - K * Math.exp(-r * T) * N(d2) : K * Math.exp(-r * T) * N(-d2) - S * N(-d1);
  return { px: Math.max(0.01, px), delta: call ? N(d1) : N(d1) - 1, theta: -(S * 0.3989423 * Math.exp(-d1 * d1 / 2) * iv) / (2 * Math.sqrt(T)) / 365 };
}
export function fridays(n = 16) { const out = []; let t = Date.now() + DAY; while (out.length < n) { const d = new Date(t); if (d.getUTCDay() === 5) out.push(d.toISOString().slice(0, 10)); t += DAY; } return out; }
function optChain(u, sym) {
  if (M.optFail) return new Response('error', { status: 500 });
  const S = hourly(sym, 0).at(-1).c, type = u.searchParams.get('type'), gte = u.searchParams.get('expiration_date_gte'), lte = u.searchParams.get('expiration_date_lte');
  const snaps = {}; M.optCalls = (M.optCalls || 0) + 1;
  for (const exp of fridays().filter(e => e >= gte && e <= lte)) {
    const T = Math.max(1, (Date.parse(exp + 'T20:00:00Z') - Date.now()) / DAY) / 365;
    for (let k = Math.round(S * 0.8); k <= Math.round(S * 1.2); k += 1) {
      for (const c of type ? [type === 'call'] : [true, false]) {
        const g = bs(S, k, T, c), occ = `${sym}${exp.slice(2, 4)}${exp.slice(5, 7)}${exp.slice(8, 10)}${c ? 'C' : 'P'}${String(k * 1000).padStart(8, '0')}`;
        snaps[occ] = { latestQuote: { bp: +(g.px * 0.97).toFixed(2), ap: +(g.px * 1.03).toFixed(2) }, latestTrade: { p: +g.px.toFixed(2) }, greeks: { delta: +g.delta.toFixed(3), theta: +g.theta.toFixed(4) }, impliedVolatility: 0.3 };
      }
    }
  }
  return new Response(JSON.stringify({ snapshots: snaps, next_page_token: null }));
}
// SEC filing history with acceptance times: earnings 8-Ks every 91 days (after the close: 21:05 UTC = 4:05 PM EST / 5:05 PM EDT),
// plus two material-agreement 8-Ks (item 1.01).
export function subsHistory(n = 12) {
  const form = [], filingDate = [], items = [], acceptanceDateTime = [];
  for (let i = 0; i < n; i++) { const d = day(40 + i * 91); form.push('8-K'); filingDate.push(d); items.push('2.02,9.01'); acceptanceDateTime.push(`${d}T21:05:00.000Z`); }
  form.push('8-K', '8-K'); filingDate.push(day(200), day(500)); items.push('1.01', '1.01,9.01'); acceptanceDateTime.push(`${day(200)}T12:00:00.000Z`, `${day(500)}T21:00:00.000Z`);
  return { filings: { recent: { form, filingDate, items, acceptanceDateTime } } };
}
const base = global.fetch;
global.fetch = async (url, opt = {}) => {
  const u = new URL(url), h = u.hostname, T = (b, s = 200) => new Response(typeof b === 'string' ? b : JSON.stringify(b), { status: s });
  if (h === 'data.alpaca.markets' && u.pathname.startsWith('/v1beta1/options/snapshots/')) return optChain(u, decodeURIComponent(u.pathname.split('/').pop()));
  if (h === 'efts.sec.gov') { (M.efts ||= []).push(Object.fromEntries(u.searchParams)); M.eftsUA = opt.headers?.['user-agent']; if (M.eftsFail) return T('err', 500); return T({ hits: { hits: (M.eftsHits || []).filter(x => x.q === u.searchParams.get('q')).map(x => ({ _id: 'x', _source: { file_date: x.date, items: x.items || ['8.01'], file_type: x.type || '8-K', form: '8-K' } })) } }); }
  if (h === 'data.sec.gov' && M.subsOverride) return T(M.subsOverride);
  if (h === 'data.alpaca.markets' && u.pathname === '/v1beta1/news' && M.catNews) { M.catNewsCalls = (M.catNewsCalls || 0) + 1; return T({ news: M.catNews, next_page_token: null }); }
  return base(url, opt);
};
