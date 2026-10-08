// Experiment ledger (v0.16.0, Phase A). Every change to how a bot TRADES is one row here, with the time it went live (ET),
// what changed and what should show whether it helped. Live trades and DCA deals are grouped by the experiment that was live
// when they were ENTERED, so results are never mixed across rule changes. Research/display-only releases (Catalyst, Trade fit,
// this ledger) are not experiments: they do not change a single order.
// Add a row whenever a trading rule changes; `from` = the production deploy time (the commit that bumped lib/version.js).
import { round } from './core.js';

export const EXPERIMENTS = [
  { id: 'E1', bot: 'dca', from: '2026-09-29T14:46:00-04:00', version: '0.13.1', title: 'DCA on real-money rules', change: '3 dip buys, 15% first buy, no take profit under 0.5% after costs', measure: 'average profit per deal after costs; share of deals ending in a hard exit' },
  { id: 'E2', bot: 'stock', from: '2026-09-30T09:44:00-04:00', version: '0.13.3', title: 'No daily minimum of stock trades', change: 'no filler trades below the score bar (was: at least 3 a day at quarter risk)', measure: 'average R per trade vs the benchmark; days with no trade' },
  { id: 'E3', bot: 'stock', from: '2026-09-30T13:04:00-04:00', version: '0.14.0', title: '5-minute heartbeat: 9:45 AM entries + scans every 15 minutes', change: 'entries at 9:45 AM (finished candle, -om) and every 15 minutes from 10:00 AM (today\'s candle, -oi); full-market data', measure: 'morning vs intraday-scan trades, average R after costs' },
  { id: 'E4', bot: 'crypto', from: '2026-09-30T13:04:00-04:00', version: '0.14.0', title: 'Crypto checked every 5 minutes', change: 'DCA dip buys / take profits checked every 5 minutes (was hourly)', measure: 'crypto deal profit after costs; hours per deal' },
];
export const expTime = (e) => Date.parse(e.from);
const botOf = (setup) => setup === 'Manual' ? null : String(setup).startsWith('Crypto') ? 'crypto' : 'stock';
const st = (list, key) => { const n = list.length; if (!n) return { n: 0 }; const v = list.map(x => x[key]).filter(x => x != null); return { n, win: round(list.filter(x => (x.pnl ?? 0) > 0).length / n * 100, 1), avg: v.length ? round(v.reduce((a, x) => a + x, 0) / v.length, 2) : null, pnl: round(list.reduce((a, x) => a + (x.pnl || 0), 0)) }; };
// trades: liveTrades() (net of costs); deals: dcaLive().closed (net of costs). Everything since each experiment began.
export function experimentTable(trades = [], deals = [], { now = Date.now() } = {}) {
  const rows = EXPERIMENTS.map(e => {
    const next = EXPERIMENTS.filter(x => x.bot === e.bot && expTime(x) > expTime(e)).sort((a, z) => expTime(a) - expTime(z))[0];
    const inWin = (t) => { const ms = Date.parse(t); return ms >= expTime(e) && (!next || ms < expTime(next)); };
    const list = e.bot === 'dca' || e.bot === 'crypto' ? deals.filter(d => (e.bot === 'dca' ? true : d.market === 'crypto') && inWin(d.in)) : trades.filter(t => botOf(t.setup) === e.bot && inWin(t.in));
    const s = e.bot === 'stock' ? st(list, 'r') : st(list, 'pct');
    return { ...e, until: next?.from || null, live: !next, days: round(((next ? expTime(next) : now) - expTime(e)) / 864e5, 1), unit: e.bot === 'stock' ? 'R' : '% of deal', ...s,
      ...(e.id === 'E3' ? { split: ['morning', 'intraday'].map(w => ({ label: w === 'morning' ? '9:45 AM (finished candle)' : 'intraday scans', ...st(list.filter(t => t.when === w), 'r') })) } : {}) };
  });
  return { rows, minN: 20, note: 'Grouped by the experiment live when the trade or deal was entered. Results are after estimated costs. Under 20 closed per row says little either way.' };
}
