// Seasons (v0.14.0). Eli, 2026-09-30 10:27 AM ET: pressed Emergency stop (every bot position closed, bot paused) and asked for
// "a true fresh start with this new info and method". Every scorecard (live trades, DCA deals, Jev and news scorecards, swing vs
// DCA, the scoreboard history's live numbers) counts only trades and deals ENTERED on or after the season start, so the old
// method's results and the forced closes never mix with the new method's. Season 1 (Sep 25 – Sep 30, 2026) stays in the paper
// account's history and in docs/RESULTS-LOG.md; pass { all: true } (or ?season=all on /api/performance) to see everything.
// The $100 plan's virtual ledger restarted at $100 with the season (lib/small.js LEDGER_KEY).
export const SEASON = { n: 1, start: '2000-01-01T00:00:00Z', label: 'All trades', since: 'the start',
  why: 'every trade since this copy was set up' };
export const inSeason = (t, { all = false } = {}) => all || !t || String(t) >= SEASON.start;
// DCA deals: keep only the orders of deals whose first buy was this season (the deal-level scorer lib/dca.js dcaLive then
// works unchanged). parse = lib/dca.js parseDca, passed in so this file imports nothing.
export function seasonOrders(orders, parse, { all = false } = {}) {
  if (all) return orders;
  const first = new Map();
  for (const o of orders) { const p = parse(o.client_order_id); if (!p || o.side !== 'buy' || !+o.filled_qty || !o.filled_at) continue; const k = p.deal + p.f; if (!first.has(k) || o.filled_at < first.get(k)) first.set(k, o.filled_at); }
  return orders.filter(o => { const p = parse(o.client_order_id); if (!p) return true; const t = first.get(p.deal + p.f); return !t || inSeason(t); });
}
