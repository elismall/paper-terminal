import { json, denied, fail, needKeys, authorized, hasAlpaca, env, plain, bars, sma, stdevRet, round, LONG_UNIVERSE, ETFS } from '../lib/core.js';
// Long-term hold ranking: trend + 12-1 momentum + low volatility, and for stocks
// SEC-reported revenue growth and net margin (latest two annual 10-K periods).
const REV_TAGS = ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenuesNetOfInterestExpense'];
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null); } })); return out; }
function annual(concept) {
  const rows = (concept?.units?.USD || []).filter(r => r.start && r.end && /^10-K/.test(r.form || ''))
    .filter(r => { const d = (new Date(r.end) - new Date(r.start)) / 864e5; return d > 340 && d < 390; });
  const byEnd = new Map(); for (const r of rows) { const p = byEnd.get(r.end); if (!p || r.filed > p.filed) byEnd.set(r.end, r); }
  return [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end));
}
async function fundamentals(stocks) {
  const ua = env('SEC_USER_AGENT'); if (!ua) return { note: 'Set SEC_USER_AGENT (your name and email) to add revenue growth and margins from SEC filings.' };
  const H = { 'User-Agent': ua, 'Accept': 'application/json' };
  const map = await plain('https://www.sec.gov/files/company_tickers.json', H);
  const cik = {}; for (const v of Object.values(map)) cik[v.ticker.replace('-', '.')] = String(v.cik_str).padStart(10, '0');
  const res = await pool(stocks, 6, async (s) => {
    const c = cik[s] || cik[s.replace('.', '-')]; if (!c) return null;
    const get = (tag) => plain(`https://data.sec.gov/api/xbrl/companyconcept/CIK${c}/us-gaap/${tag}.json`, H).catch(() => null);
    let rev = [];
    for (const t of REV_TAGS) { const a = annual(await get(t)); if (a.length >= 2 && (!rev.length || a.at(-1).end >= rev.at(-1).end)) rev = a; if (rev.length >= 2 && rev.at(-1).end > new Date(Date.now() - 500 * 864e5).toISOString()) break; }
    const ni = annual(await get('NetIncomeLoss'));
    const r1 = rev.at(-1), r0 = rev.at(-2), n1 = ni.find(x => x.end === r1?.end);
    return { s, fy: r1?.end || null, revGrowth: r1 && r0 ? r1.val / r0.val - 1 : null, margin: r1 && n1 ? n1.val / r1.val : null, revenue: r1?.val ?? null };
  });
  const out = {}; for (const r of res) if (r) out[r.s] = r; return { data: out };
}
const rank = (arr, key, asc = false) => { const v = arr.filter(x => x[key] != null).sort((a, b) => asc ? a[key] - b[key] : b[key] - a[key]); v.forEach((x, i) => x['_r' + key] = 1 - i / Math.max(1, v.length - 1)); };
export async function GET(req) {
  if (!authorized(req)) return denied();
  if (!hasAlpaca()) return needKeys('long-term rankings');
  try {
    const stocks = LONG_UNIVERSE.filter(s => !ETFS.has(s));
    const [b, f] = await Promise.all([bars(LONG_UNIVERSE, { timeframe: '1Day', days: 420 }), fundamentals(stocks).catch(e => ({ note: 'SEC data unavailable: ' + e.message }))]);
    const rows = [];
    for (const s of LONG_UNIVERSE) {
      const x = b[s]; if (!x || x.length < 230) continue;
      const c = x.map(k => k.c), px = c.at(-1);
      const s50 = sma(c, 50), s200 = sma(c, 200);
      const mom = c.length > 253 ? c.at(-22) / c.at(-253) - 1 : c.at(-22) / c[0] - 1;
      const hi = Math.max(...x.slice(-252).map(k => k.h));
      const vol = stdevRet(c, 63) * Math.sqrt(252);
      const fd = f.data?.[s] || {};
      rows.push({ s, etf: ETFS.has(s), px: round(px), s50: round(s50), s200: round(s200), mom: round(mom * 100, 1), fromHigh: round((px / hi - 1) * 100, 1),
        vol: round(vol * 100, 1), ext: round((px / s200 - 1) * 100, 1), trend: px > s200 && s50 > s200,
        revGrowth: fd.revGrowth != null ? round(fd.revGrowth * 100, 1) : null, margin: fd.margin != null ? round(fd.margin * 100, 1) : null, fy: fd.fy || null, spark: c.slice(-120).filter((_, i) => i % 2 === 0).map(v => round(v)) });
    }
    rank(rows, 'mom'); rank(rows, 'vol', true); rank(rows, 'revGrowth'); rank(rows, 'margin');
    for (const r of rows) {
      const parts = [[r._rmom, 0.35], [r.trend ? 1 : 0, 0.15], [r._rvol, 0.10], [r._rrevGrowth, 0.25], [r._rmargin, 0.15]].filter(p => p[0] != null);
      const w = parts.reduce((a, p) => a + p[1], 0);
      r.score = Math.round(parts.reduce((a, p) => a + p[0] * p[1], 0) / w * 100);
      r.zone = !r.trend ? 'Wait: below 200-day' : r.ext > 20 ? 'Extended: buy pullbacks' : r.px <= r.s50 * 1.02 ? 'Buy zone: near 50-day' : 'Accumulate';
      r.addBelow = r.trend ? round(Math.max(r.s50, r.s200)) : null;
      for (const k of Object.keys(r)) if (k.startsWith('_r')) delete r[k];
    }
    rows.sort((a, z) => z.score - a.score);
    return json({ picks: rows, fundamentalsNote: f.note || null, at: new Date().toISOString() }, { cache: 21600, swr: 86400 });
  } catch (e) { return fail(e, 'longterm'); }
}
