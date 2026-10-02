import { json, denied, fail, needKeys, authorized, hasAlpaca, bars, swingEval, SWING_UNIVERSE, marketSession } from '../lib/core.js';
// Daily-bar swing scan across ~100 liquid stocks and ETFs.
export async function GET(req) {
  if (!authorized(req)) return denied();
  if (!hasAlpaca()) return needKeys('stock swing scans');
  try {
    const risk = Math.min(10000, Math.max(50, +new URL(req.url).searchParams.get('risk') || 1000));
    const b = await bars(SWING_UNIVERSE, { timeframe: '1Day', days: 420 });
    const spy = b.SPY || [];
    const bench = spy.length > 64 ? spy.at(-1).c / spy.at(-64).c - 1 : 0;
    const plays = [];
    for (const s of SWING_UNIVERSE) { const r = swingEval(s, b[s], bench, { riskDollars: risk }); if (r) { r.spark = b[s].slice(-40).map(x => x.c); plays.push(r); } }
    plays.sort((a, z) => z.score - a.score);
    const sess = marketSession();
    return json({ plays, scanned: Object.keys(b).length, universe: SWING_UNIVERSE.length, asOf: spy.at(-1)?.t, riskDollars: risk,
      note: 'Daily bars, IEX feed. Last bar is today\'s partial bar while the market is open.', at: new Date().toISOString() },
      { cache: sess.open ? 600 : 3600, swr: 3600 });
  } catch (e) { return fail(e, 'swing'); }
}
