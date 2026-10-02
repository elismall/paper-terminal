import { json, denied, fail, needKeys, authorized, hasAlpaca, round } from '../lib/core.js';
import { pget, compactOrder, ordersSince, tradingMode } from '../lib/trade.js';
import { lastBuyOf } from '../lib/dca.js';
// The trading account (paper, or live when lib/trade.js live mode is fully set up), positions, open orders, recent orders and 3-month equity. Always requires the passcode once set; never cached.
// v0.16.0: every position and order says who owns it (the bot, by order-id prefix, or you) and options get their own group.
const BOT_KIND = [[/^tbbot/, 'swing'], [/^tbdca/, 'DCA'], [/^tbhodl/, 'core'], [/^tbcry/, 'crypto swing'], [/^tb(prot|cstop|be|exit|cx)/, 'exit']];
export const ownerOf = (coid = '') => { for (const [re, k] of BOT_KIND) if (re.test(coid || '')) return { own: 'bot', kind: k }; return { own: 'you', kind: null }; };
// OCC option symbol, e.g. SNOW261120C00180000 -> SNOW, 2026-11-20, call, 180
export const occ = (s) => { const m = /^([A-Z.]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(String(s || '')); return m ? { u: m[1], exp: `20${m[2]}-${m[3]}-${m[4]}`, type: m[5] === 'C' ? 'call' : 'put', k: +m[6] / 1000 } : null; };
export function positionOwner(orders, sym) {
  const lb = lastBuyOf(orders, sym); if (!lb) return { own: 'unknown', kind: null, why: 'no buy found in the last 120 days' };
  const o = ownerOf(lb.client_order_id);
  if (o.own === 'you' && orders.some(x => x.side === 'buy' && +x.filled_qty > 0 && x.symbol === lb.symbol && /^tb(bot|dca|hodl|cry)/.test(x.client_order_id || ''))) return { own: 'mixed', kind: null, why: 'you bought after the bot did, so the bot leaves this position alone' };
  return o;
}
export async function GET(req) {
  if (!authorized(req, { strict: true })) return json({ error: 'locked', message: 'Set DASH_PASSCODE in Vercel, then enter it in Settings to see your paper account.' }, { status: 401 });
  if (!hasAlpaca()) return needKeys('the paper account panel');
  try {
    const [a, pos, ord, openO, hist] = await Promise.all([
      pget('/v2/account'), pget('/v2/positions'), ordersSince(120, 4), pget('/v2/orders?status=open&limit=500&direction=desc&nested=true'),
      pget('/v2/account/portfolio/history?period=3M&timeframe=1D').catch(() => null),
    ]);
    const orders = ord.slice(0, 60).map(o => ({ ...compactOrder(o), ...ownerOf(o.client_order_id) }));
    return json({
      account: { equity: +a.equity, last: +a.last_equity, cash: +a.cash, bp: +a.buying_power, status: a.status, paper: !tradingMode().live, live: tradingMode().live, pdt: a.pattern_day_trader, dt: a.daytrade_count, optLevel: a.options_trading_level ?? null },
      positions: pos.map(p => ({ s: p.symbol, side: p.side, qty: +p.qty, avg: +p.avg_entry_price, px: +p.current_price, mv: +p.market_value, pl: +p.unrealized_pl, plpc: round(+p.unrealized_plpc * 100, 2), day: round(+p.unrealized_intraday_plpc * 100, 2), cls: p.asset_class, opt: p.asset_class === 'us_option' ? occ(p.symbol) : undefined, ...positionOwner(ord, p.symbol) })),
      open: (openO || []).map(o => ({ ...compactOrder(o), ...ownerOf(o.client_order_id) })),
      orders,
      history: hist ? { t: hist.timestamp, eq: hist.equity } : null,
      at: new Date().toISOString(),
    }, { priv: true });
  } catch (e) { return fail(e, 'account'); }
}
