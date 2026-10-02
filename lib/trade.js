// Trading helpers: every order the bots or the order ticket send goes through call() below.
// PAPER by default (paper-api.alpaca.markets). Real money (v0.17.1) only when ALL of these are set in Vercel, on purpose so it can
// never be switched on by accident or from the browser:
//   TRADING_MODE=live · LIVE_CONFIRM=<LIVE_PHRASE, exactly> · ALPACA_LIVE_KEY_ID + ALPACA_LIVE_SECRET_KEY (a live account's keys;
//   the paper keys stay for market data) · LIVE_MAX_USD = the most the bots may have in the market at once (positions + open buys).
// Anything missing: paper, and /api/health says what is missing. In live mode every buy is checked first: positions + open buy
// orders + this order must stay within LIVE_MAX_USD; selling more than you hold (short selling) and selling options to open are refused.
import { PAPER, env, hasAlpaca, snapshots, quoteOf } from './core.js';

export const LIVE = 'https://api.alpaca.markets';
export const LIVE_PHRASE = 'I understand this trades real money';
export function tradingMode() {
  if (env('TRADING_MODE').toLowerCase() !== 'live') return { live: false, mode: 'paper' };
  const missing = [env('LIVE_CONFIRM') === LIVE_PHRASE ? null : 'LIVE_CONFIRM (the exact sentence)', env('ALPACA_LIVE_KEY_ID') && env('ALPACA_LIVE_SECRET_KEY') ? null : 'ALPACA_LIVE_KEY_ID + ALPACA_LIVE_SECRET_KEY',
    +env('LIVE_MAX_USD') > 0 ? null : 'LIVE_MAX_USD (a dollar limit above 0)'].filter(Boolean);
  return missing.length ? { live: false, mode: 'paper', blocked: `TRADING_MODE=live is set but ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} missing, so the bots stay on paper.` }
    : { live: true, mode: 'live', cap: +env('LIVE_MAX_USD') };
}
const H = (m) => ({ 'APCA-API-KEY-ID': env(m.live ? 'ALPACA_LIVE_KEY_ID' : 'ALPACA_KEY_ID'), 'APCA-API-SECRET-KEY': env(m.live ? 'ALPACA_LIVE_SECRET_KEY' : 'ALPACA_SECRET_KEY'), 'content-type': 'application/json' });
async function raw(m, method, path, body) {
  const r = await fetch((m.live ? LIVE : PAPER) + path, { method, headers: H(m), body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let j = null; try { j = text ? JSON.parse(text) : null; } catch { j = { message: text }; }
  if (!r.ok) { const e = new Error((j && (j.message || j.error)) || `HTTP ${r.status}`); e.status = r.status; e.body = j; throw e; }
  return j;
}
const refuse = (msg) => { const e = new Error('Live money guard: ' + msg); e.status = 403; e.guard = true; return e; };
const isOccSym = (s) => /^[A-Z.]{1,6}\d{6}[CP]\d{8}$/.test(s);
// Checked before every live order (POST /v2/orders). Throws (status 403) instead of sending.
export async function liveGuard(m, o) {
  const sym = String(o.symbol || '').toUpperCase(), opt = isOccSym(sym), mult = opt || o.order_class === 'mleg' ? 100 : 1;
  if (o.order_class === 'mleg') { if (!(+o.limit_price > 0)) throw refuse('spreads need a limit price'); return checkCap(m, +o.limit_price * +o.qty * 100, 'this spread'); }
  if (o.side === 'sell') {
    if (opt && /to_open/.test(o.position_intent || 'sell_to_open')) throw refuse('selling options to open is off in live mode');
    const pos = await raw(m, 'GET', '/v2/positions/' + encodeURIComponent(sym.replace('/', ''))).catch(() => null);
    const held = pos ? +pos.qty : 0, want = +o.qty || (+o.notional > 0 && pos ? +o.notional / (+pos.current_price || Infinity) : 0);
    if (!(held > 0) || want > held * 1.0001) throw refuse(`${sym}: selling more than you hold would be a short sale, which live mode never does`);
    return;
  }
  if (o.side !== 'buy') throw refuse('unknown order side');
  let px = +o.limit_price || +o.stop_price || 0;
  if (!px && !(+o.notional > 0)) { const sn = await snapshots([sym]).catch(() => ({})); px = quoteOf(sym, sn[sym])?.p || 0; }
  const cost = +o.notional > 0 ? +o.notional : (+o.qty || 0) * px * mult;
  if (!(cost > 0)) throw refuse(`${sym}: could not price this order, so it was not sent`);
  return checkCap(m, cost, sym);
}
async function checkCap(m, cost, what) {
  const [pos, open] = await Promise.all([raw(m, 'GET', '/v2/positions'), raw(m, 'GET', '/v2/orders?status=open&limit=500&nested=true')]);
  const held = (pos || []).reduce((a, p) => a + Math.abs(+p.market_value || 0), 0);
  const pending = (open || []).flatMap(o => [o, ...(o.legs || [])]).filter(o => o.side === 'buy').reduce((a, o) => a + (+o.notional || (+o.qty || 0) * (+o.limit_price || +o.stop_price || 0) * (isOccSym(o.symbol || '') ? 100 : 1)), 0);
  if (held + pending + cost > m.cap + 0.01) throw refuse(`${what} ($${cost.toFixed(2)}) would take the money in the market to $${(held + pending + cost).toFixed(2)}, above LIVE_MAX_USD $${m.cap}. Raise it in Vercel if you mean to.`);
}
async function call(method, path, body) {
  if (!hasAlpaca()) throw new Error('Alpaca keys are not set');
  const m = tradingMode();
  if (m.live && method === 'POST' && path === '/v2/orders') await liveGuard(m, body || {});
  if (m.live && method === 'PATCH' && body?.qty) throw refuse('changing an order\'s size is off in live mode (cancel and re-place instead)');
  return raw(m, method, path, body);
}
export const pget = (p) => call('GET', p);
export const ppost = (p, b) => call('POST', p, b);
export const pdel = (p) => call('DELETE', p);
// Positions worth under $1 (crypto dust left after a sell, e.g. 0.000000001 XRP) count as no position.
export const realPositions = (list) => (list || []).filter(p => !(Math.abs(+p.market_value || 0) < 1 && +p.current_price > 0));
export const ppatch = (p, b) => call('PATCH', p, b);   // replace an open order (e.g. move a stop)
// All orders submitted in the last `days`, newest first, paging past Alpaca's 500-per-call limit (DCA deals add many orders).
export async function ordersSince(days, maxPages = 6) {
  const after = new Date(Date.now() - days * 864e5).toISOString(), out = [], seen = new Set(); let until = '';
  for (let p = 0; p < maxPages; p++) {
    const page = await call('GET', `/v2/orders?status=all&limit=500&direction=desc&nested=true&after=${after}${until ? '&until=' + until : ''}`);
    for (const o of page) if (!seen.has(o.id)) { seen.add(o.id); out.push(o); }
    if (page.length < 500) break; until = page.at(-1).submitted_at;
  }
  return out;
}

const money = (v) => (Math.round(+v * 100) / 100).toFixed(2);
export const isOcc = (s) => /^[A-Z.]{1,6}\d{6}[CP]\d{8}$/.test(s);

// Build a validated Alpaca order body from the ticket. Throws on anything unsafe or malformed.
export function buildOrder(t) {
  const sym = String(t.symbol || '').toUpperCase().trim();
  const side = t.side === 'sell' ? 'sell' : t.side === 'buy' ? 'buy' : null;
  if (!sym) throw new Error('Symbol is required');
  if (t.kind === 'spread') {
    const legs = (t.legs || []).slice(0, 4).map(l => ({ symbol: String(l.symbol).toUpperCase(), ratio_qty: '1', side: l.side === 'sell' ? 'sell' : 'buy', position_intent: l.side === 'sell' ? 'sell_to_open' : 'buy_to_open' }));
    if (legs.length !== 2 || !legs.every(l => isOcc(l.symbol))) throw new Error('A spread needs two option contracts');
    const qty = Math.floor(+t.qty); if (!(qty >= 1 && qty <= 50)) throw new Error('Spread quantity must be 1 to 50');
    const lp = +t.limit_price; if (!(lp > 0)) throw new Error('A spread needs a limit price (net debit)');
    return { order_class: 'mleg', qty: String(qty), type: 'limit', limit_price: money(lp), time_in_force: 'day', legs };
  }
  if (!side) throw new Error('Side must be buy or sell');
  const type = t.type === 'limit' ? 'limit' : 'market';
  const body = { symbol: sym, side, type };
  if (type === 'limit') { if (!(+t.limit_price > 0)) throw new Error('Limit price is required'); body.limit_price = money(t.limit_price); }
  if (sym.includes('/')) {                     // crypto: market/limit, gtc/ioc, no brackets
    if (+t.notional > 0 && type === 'market') body.notional = money(t.notional);
    else if (+t.qty > 0) body.qty = String(+(+t.qty).toFixed(8));
    else throw new Error('Enter a quantity or a dollar amount');
    body.time_in_force = 'gtc';
    return body;
  }
  if (isOcc(sym)) {                             // single option contract
    const qty = Math.floor(+t.qty); if (!(qty >= 1 && qty <= 50)) throw new Error('Contracts must be 1 to 50');
    body.qty = String(qty); body.time_in_force = 'day';
    body.position_intent = side === 'buy' ? (t.close ? 'buy_to_close' : 'buy_to_open') : (t.close ? 'sell_to_close' : 'sell_to_open');
    return body;
  }
  // stock / ETF
  const qty = +t.qty; if (!(qty > 0)) throw new Error('Quantity is required');
  const whole = Number.isInteger(qty);
  body.qty = String(whole ? qty : +qty.toFixed(6));
  body.time_in_force = t.tif === 'gtc' && whole ? 'gtc' : 'day';
  const sl = +t.stop_loss, tp = +t.take_profit;
  if (sl > 0 || tp > 0) {
    if (!whole) throw new Error('Stop and target need a whole number of shares');
    if (sl > 0 && tp > 0) { body.order_class = 'bracket'; body.stop_loss = { stop_price: money(sl) }; body.take_profit = { limit_price: money(tp) };
      if (side === 'buy' && !(tp > sl)) throw new Error('For a buy, the target must be above the stop');
      if (side === 'sell' && !(tp < sl)) throw new Error('For a short, the target must be below the stop'); }
    else { body.order_class = 'oto'; if (sl > 0) body.stop_loss = { stop_price: money(sl) }; else body.take_profit = { limit_price: money(tp) }; }
  }
  if (t.client_order_id) body.client_order_id = String(t.client_order_id).slice(0, 120);
  return body;
}
export const compactOrder = (o) => ({ id: o.id, coid: o.client_order_id, s: o.symbol, side: o.side, qty: o.qty || o.notional, type: o.type, cls: o.order_class, status: o.status,
  t: o.submitted_at, fill: o.filled_avg_price, limit: o.limit_price, stop: o.stop_price, legs: (o.legs || []).map(l => ({ s: l.symbol, side: l.side, type: l.type, status: l.status, limit: l.limit_price, stop: l.stop_price })) });
