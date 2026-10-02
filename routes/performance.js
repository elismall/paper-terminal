import { json, fail, authorized, hasAlpaca, needKeys } from '../lib/core.js';
import { pget, ordersSince, realPositions } from '../lib/trade.js';
import { liveTrades, spyOverlay, summarize } from '../lib/perf.js';
import { dcaLive, statsOf, lastBuyOf, parseDca } from '../lib/dca.js';
import { jevStatus } from '../lib/jev.js';
import { parseNewsTag, newsMode } from '../lib/news.js';
import { levMode } from '../lib/leverage.js';
import { SEASON, seasonOrders } from '../lib/season.js';
import { feeMode, feeNote, FEES } from '../lib/fees.js';
import { experimentTable } from '../lib/experiments.js';
import { candReport } from '../lib/ledger.js';
import { orbReport } from '../lib/orb.js';
// Live results from the paper account: every closed swing/manual trade, R multiples, alpha vs SPY, account vs SPY,
// plus swing bot vs DCA bot side by side (same dates). Private; never cached.
// v0.14.0: this season's trades and deals only (lib/season.js); ?season=all = everything since the account started.
// v0.16.0: results after estimated costs (lib/fees.js), the experiment ledger, the candidate ledger and the opening-range shadow.
const round2 = (x) => Math.round(x * 100) / 100;
export async function GET(req) {
  if (!authorized(req, { strict: true })) return json({ error: 'locked', message: 'Set DASH_PASSCODE and enter it in Settings to see performance.' }, { status: 401 });
  if (!hasAlpaca()) return needKeys('performance tracking');
  try {
    const everything = new URL(req.url).searchParams.get('season') === 'all';
    const [all, hist, orders, positions, fm, cand, orb] = await Promise.all([liveTrades({ all: everything }), pget('/v2/account/portfolio/history?period=3M&timeframe=1D').catch(() => null), ordersSince(120, 8), pget('/v2/positions').then(realPositions),
      feeMode().catch(() => ({ charged: false })), candReport().catch(e => ({ error: e.message })), orbReport().catch(e => ({ error: e.message }))]);
    const trades = all.filter(t => t.setup !== 'DCA');                           // DCA fills are scored per deal below
    const { curve } = await spyOverlay(trades, hist);
    const sum = summarize(trades);
    const dca = dcaLive(seasonOrders(orders, parseDca, { all: everything }), positions, { charged: fm.charged }), since = dca.first;
    const swingClosed = trades.filter(t => t.setup !== 'Manual' && (!since || String(t.out) >= since));
    const swingOpen = positions.filter(p => /^tb(bot|cry)/.test(lastBuyOf(orders, p.symbol)?.client_order_id || ''));
    const compare = { since, swing: { ...statsOf(swingClosed), openPnl: Math.round(swingOpen.reduce((a, p) => a + +p.unrealized_pl, 0) * 100) / 100, open: swingOpen.length },
      dca: { ...dca.stats, openPnl: dca.openPnl, open: dca.open.length, byMarket: dca.byMarket }, deals: dca.closed.slice(0, 40), openDeals: dca.open };
    // AI filter scorecard: closed bot trades/deals grouped by the score Jev gave at entry (recorded in the order id)
    const scored = [...swingClosed.filter(t => t.jev != null).map(t => ({ q: t.jev, f: t.jevFlag, pnl: t.pnl, pct: t.pct })), ...dca.closed.filter(d => d.jev != null).map(d => ({ q: d.jev, f: d.jevFlag, pnl: d.pnl, pct: d.pct }))];
    const jev = { status: jevStatus(), n: scored.length, buckets: [['Weak (under 1)', x => x < 1], ['Middling (1 to 2)', x => x >= 1 && x < 2], ['Strong (2+)', x => x >= 2]].map(([label, f]) => ({ label, ...statsOf(scored.filter(t => f(t.q))) })),
      flags: [['AI flagged a risk at entry', true], ['No risk flag', false]].map(([label, v]) => ({ label, ...statsOf(scored.filter(t => t.f === v)) })) };
    // Crypto DCA signals scorecard (v0.11.0, shadow): closed crypto deals grouped by perp funding and money conditions at the start
    const cd = dca.closed.filter(d => d.market === 'crypto');
    const dcaSignals = { mode: levMode(), n: cd.filter(d => d.lev != null || d.liq != null).length, rows: [['Funding normal', d => d.lev === '0'], ['Funding hot (20–50%/yr)', d => d.lev === '1'], ['Funding very hot (50%+/yr)', d => d.lev === '2'],
      ['Funding negative', d => d.lev === 'n'], ['Money conditions easing', d => d.liq === 'e'], ['Money conditions mixed', d => d.liq === 'm'], ['Money conditions tightening', d => d.liq === 't']].map(([label, f]) => ({ label, ...statsOf(cd.filter(f)) })) };
    // News scorecard (v0.10.0): closed stock-bot trades grouped by what the news rule said at entry (tag in the buy order id)
    const nb = orders.filter(o => o.side === 'buy' && +o.filled_qty > 0 && String(o.client_order_id || '').startsWith('tbbot-')).map(o => ({ s: o.symbol, t: Date.parse(o.filled_at), tag: parseNewsTag(o.client_order_id) })).filter(x => x.tag);
    const tagged = swingClosed.map(t => { const m = nb.find(x => x.s === t.s && Math.abs(x.t - Date.parse(t.in)) < 36e5); return m ? { ...t, tag: m.tag } : null; }).filter(Boolean);
    const news = { mode: newsMode(), n: tagged.length, buckets: [['News rule would have skipped', x => !!x.tag.veto], ['News rule: half size', x => !x.tag.veto && x.tag.caution], ['News clean', x => !x.tag.veto && !x.tag.caution], ['CPI / jobs / Fed day at entry', x => x.tag.flags.includes('C')], ['Insiders had bought (30 days)', x => x.tag.flags.includes('I')]].map(([label, f]) => ({ label, ...statsOf(tagged.filter(f)) })),
      jev: [['Jev: news supports (60%+)', x => x.tag.jevNews != null && x.tag.jevNews >= 0.6], ['Jev: news doubtful (under 40%)', x => x.tag.jevNews != null && x.tag.jevNews < 0.4]].map(([label, f]) => ({ label, ...statsOf(tagged.filter(f)) })) };
    const fees = { ...fm, note: feeNote(fm), rates: FEES, paid: round2(trades.reduce((a, t) => a + (t.fee || 0), 0) + dca.closed.reduce((a, d) => a + (d.fee || 0), 0)) };
    const experiments = experimentTable(trades, dca.closed); // same season filter as the rest of the page
    return json({ ...sum, season: everything ? { all: true } : SEASON, curve, trades: [...trades].reverse().slice(0, 200), compare, jev, news, dcaSignals, fees, experiments, candidates: cand, orb, at: new Date().toISOString() }, { priv: true });
  } catch (e) { return fail(e, 'performance'); }
}
