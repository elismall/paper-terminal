import { json, denied, fail, authorized, snapshots, quoteOf, BOARD, NAMES, hasAlpaca, marketSession, paper } from '../lib/core.js';
// Live board: indices, sectors, cross-asset, crypto, plus ?symbols=extra,list
export async function GET(req) {
  if (!authorized(req)) return denied();
  try {
    const extra = (new URL(req.url).searchParams.get('symbols') || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean).slice(0, 40);
    const all = [...new Set([...BOARD.indices, ...BOARD.sectors, ...BOARD.cross, ...BOARD.crypto, ...extra])];
    const [sn, clock] = await Promise.all([
      snapshots(all),
      hasAlpaca() ? paper('/v2/clock').catch(() => null) : Promise.resolve(null),
    ]);
    const q = {};
    for (const s of all) { const x = quoteOf(s, sn[s]); if (x) { x.n = NAMES[s] || ''; q[s] = x; } }
    const sess = marketSession();
    return json({
      quotes: q, groups: BOARD,
      clock: clock ? { open: clock.is_open, next_open: clock.next_open, next_close: clock.next_close } : { open: sess.open, phase: sess.phase, estimated: true },
      stocks: hasAlpaca(), at: new Date().toISOString(),
    }, { cache: 10, swr: 20 });
  } catch (e) { return fail(e, 'quotes'); }
}
