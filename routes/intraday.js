import { json, denied, fail, needKeys, authorized, hasAlpaca, alpaca, bars, snapshots, quoteOf, round, clamp, marketSession } from '../lib/core.js';
// Intraday scan: gaps, relative volume, VWAP and 30-minute opening range.
const CORE = 'SPY QQQ IWM AAPL MSFT NVDA AMZN GOOGL META TSLA AMD AVGO NFLX PLTR COIN MSTR SMCI MU INTC BA JPM BAC XOM UBER SHOP CRWD ARM SOFI HOOD RIVN'.split(' ');
const nyMin = (t) => { const p = new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' }).split(':'); return (+p[0] % 24) * 60 + +p[1]; };
export async function GET(req) {
  if (!authorized(req)) return denied();
  if (!hasAlpaca()) return needKeys('intraday scans');
  try {
    const risk = Math.min(10000, Math.max(50, +new URL(req.url).searchParams.get('risk') || 500));
    const [mv, ma] = await Promise.all([
      alpaca('/v1beta1/screener/stocks/movers?top=25').catch(() => ({})),
      alpaca('/v1beta1/screener/stocks/most-actives?by=volume&top=25').catch(() => ({})),
    ]);
    const dyn = [...(mv.gainers || []), ...(mv.losers || []), ...(ma.most_actives || [])].map(x => x.symbol).filter(s => /^[A-Z]{1,5}$/.test(s));
    const cands = [...new Set([...CORE, ...dyn])].slice(0, 90);
    const [sn, daily] = await Promise.all([snapshots(cands), bars(cands, { timeframe: '1Day', days: 45 })]);
    const sess = marketSession();
    const rows = [];
    for (const s of cands) {
      const q = quoteOf(s, sn[s]); if (!q || !q.p || q.p < 5 || !q.prev || !q.o) continue;
      const hist = (daily[s] || []).filter(b => b.t.slice(0, 10) !== (sn[s].dailyBar?.t || '').slice(0, 10)).slice(-20);
      const avgV = hist.length ? hist.reduce((a, b) => a + b.v, 0) / hist.length : 0;
      const frac = sess.open ? Math.max(sess.frac, 0.05) : 1;
      rows.push({ s, p: q.p, prev: q.prev, o: q.o, h: q.h, l: q.l, vw: q.vw, v: q.v,
        gap: q.o / q.prev - 1, chg: q.pct, rvol: avgV ? q.v / (avgV * frac) : null, vsVwap: q.vw ? q.p / q.vw - 1 : null, dayT: sn[s].dailyBar?.t });
    }
    rows.sort((a, z) => Math.abs(z.chg) * (z.rvol || 1) - Math.abs(a.chg) * (a.rvol || 1));
    const top = rows.slice(0, 30);
    // 30-minute opening range from 5-minute bars
    const start = top[0]?.dayT;
    const m5 = start ? await bars(top.map(r => r.s), { timeframe: '5Min', start }).catch(() => ({})) : {};
    const plays = [];
    for (const r of top) {
      const or = (m5[r.s] || []).filter(b => { const m = nyMin(b.t); return m >= 570 && m < 600; });
      const orH = or.length ? Math.max(...or.map(b => b.h)) : null, orL = or.length ? Math.min(...or.map(b => b.l)) : null;
      let setup = null, dir = 'long', why = [];
      const aboveV = r.vsVwap != null && r.vsVwap > 0;
      if (r.gap >= 0.02 && aboveV && (r.rvol || 0) >= 1.5 && r.p >= r.o) { setup = 'Gap and go'; why.push(`gapped ${(r.gap * 100).toFixed(1)}%`, 'holding above VWAP and the open'); }
      else if (orH && r.p > orH && aboveV) { setup = 'Opening-range breakout'; why.push(`above 30-min high ${orH.toFixed(2)}`, 'above VWAP'); }
      else if (r.gap >= 0.03 && !aboveV && r.p < r.o) { setup = 'Gap fade'; dir = 'short'; why.push(`gapped ${(r.gap * 100).toFixed(1)}% but lost VWAP`); }
      else if (orL && r.p < orL && !aboveV) { setup = 'Opening-range breakdown'; dir = 'short'; why.push(`below 30-min low ${orL.toFixed(2)}`, 'below VWAP'); }
      if (!setup) continue;
      if (r.rvol) why.push(`relative volume ${r.rvol.toFixed(1)}×`);
      let stop = dir === 'long' ? Math.max(...[r.vw, orL].filter(x => x && x < r.p), r.p * 0.985) : Math.min(...[r.vw, orH].filter(x => x && x > r.p), r.p * 1.015);
      if (dir === 'long' && stop >= r.p) stop = r.p * 0.985;
      if (dir === 'short' && stop <= r.p) stop = r.p * 1.015;
      const rps = Math.abs(r.p - stop);
      const target = dir === 'long' ? r.p + 2 * rps : r.p - 2 * rps;
      const score = clamp(Math.round(40 + clamp((r.rvol || 1) * 8, 0, 30) + clamp(Math.abs(r.chg) * 300, 0, 20) + (setup.startsWith('Opening') ? 5 : 0)), 0, 100);
      plays.push({ s: r.s, setup, dir, score, px: round(r.p), stop: round(stop), target: round(target), rr: 2, shares: Math.floor(risk / rps),
        gap: round(r.gap * 100, 1), chg: round(r.chg * 100, 1), rvol: round(r.rvol, 1), vwap: round(r.vw), orH: round(orH), orL: round(orL), why });
    }
    plays.sort((a, z) => z.score - a.score);
    const movers = rows.slice(0, 24).map(r => ({ s: r.s, p: round(r.p), chg: round(r.chg * 100, 2), gap: round(r.gap * 100, 2), rvol: round(r.rvol, 1), vsVwap: round(r.vsVwap * 100, 2) }));
    return json({ plays, movers, session: sess, reviewOnly: !sess.open, riskDollars: risk,
      note: sess.open ? 'Live session. IEX volume only, so relative volume compares IEX with IEX.' : 'Market closed: showing the last session for review. Do not act on these until the next open.',
      at: new Date().toISOString() }, { cache: sess.open ? 60 : 900, swr: 300 });
  } catch (e) { return fail(e, 'intraday'); }
}
