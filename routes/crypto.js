import { json, denied, fail, authorized, bars, snapshots, quoteOf, swingEval, sma, rsi, round, CRYPTO_UNIVERSE } from '../lib/core.js';
// Crypto board + swing scan + 24h momentum. Works without API keys.
export async function GET(req) {
  if (!authorized(req)) return denied();
  try {
    const risk = Math.min(10000, Math.max(50, +new URL(req.url).searchParams.get('risk') || 1000));
    const [sn, d1, h1] = await Promise.all([
      snapshots(CRYPTO_UNIVERSE),
      bars(CRYPTO_UNIVERSE, { timeframe: '1Day', days: 420 }),
      bars(CRYPTO_UNIVERSE, { timeframe: '1Hour', days: 4 }),
    ]);
    const btc = d1['BTC/USD'] || [];
    const bench = btc.length > 64 ? btc.at(-1).c / btc.at(-64).c - 1 : 0;
    const board = [], plays = [];
    for (const s of CRYPTO_UNIVERSE) {
      const q = quoteOf(s, sn[s]); const d = d1[s] || [], h = h1[s] || [];
      if (!q?.p) continue;
      const c = d.map(x => x.c);
      const h24 = h.length > 24 ? h.at(-25).c : null;
      const hv = h.slice(-24).reduce((a, x) => a + x.v, 0), hvPrev = h.slice(-48, -24).reduce((a, x) => a + x.v, 0);
      board.push({ s, p: q.p, chg24: h24 ? round((q.p / h24 - 1) * 100, 2) : null, chgDay: round(q.pct * 100, 2),
        d7: c.length > 8 ? round((q.p / c.at(-8) - 1) * 100, 1) : null, d30: c.length > 31 ? round((q.p / c.at(-31) - 1) * 100, 1) : null,
        above200: c.length >= 200 ? q.p > sma(c, 200) : null, rsi: round(rsi(c), 0), volTrend: hvPrev ? round(hv / hvPrev, 2) : null,
        spark: h.slice(-48).map(x => round(x.c, 6)) });
      const p = swingEval(s, d, bench, { riskDollars: risk }); if (p) { p.spark = c.slice(-40); plays.push(p); }
    }
    plays.sort((a, z) => z.score - a.score);
    return json({ board, plays, note: 'Alpaca crypto feed. Markets trade 24/7; daily bars close at 00:00 UTC.', at: new Date().toISOString() }, { cache: 30, swr: 120 });
  } catch (e) { return fail(e, 'crypto'); }
}
