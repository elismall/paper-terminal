// Trading helpers: every order the bots or the order ticket send goes through call() below.
// PAPER by default (paper-api.alpaca.markets). Real money (v0.17.1) only when ALL of these are set in Vercel, on purpose so it can
// never be switched on by accident or from the browser:
//   TRADING_MODE=live · LIVE_CONFIRM=<LIVE_PHRASE, exactly> · ALPACA_LIVE_KEY_ID + ALPACA_LIVE_SECRET_KEY (a live account's keys;
//   the paper keys stay for market data) · LIVE_MAX_USD = the most the bots may have in the market at once (positions + open buys).
// Anything missing: paper, and /api/health says what is missing. In live mode every buy is checked first: positions + open buy
// orders + this order must stay within LIVE_MAX_USD; selling more than you hold (short selling) and selling options to open are refused.
// v0.20.0: open market buys count at the live price, spreads must be debit spreads, sells cannot carry attached legs, and moving a
// resting buy's price is re-checked against the cap.
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
// v0.20.0 (audit #12): 15 s deadline. A timed-out POST may still have reached Alpaca, so callers never resend it blindly; the bots
// look at Alpaca's own order list on the next run (and duplicate entries are refused, see recentlyOrdered).
async function raw(m, method, path, body) {
  const r = await fetch((m.live ? LIVE : PAPER) + path, { method, headers: H(m), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15e3) });
  const text = await r.text();
  let j = null; try { j = text ? JSON.parse(text) : null; } catch { j = { message: text }; }
  if (!r.ok) { const e = new Error((j && (j.message || j.error)) || `HTTP ${r.status}`); e.status = r.status; e.body = j; throw e; }
  return j;
}
const refuse = (msg) => { const e = new Error('Live money guard: ' + msg); e.status = 403; e.guard = true; return e; };
const isOccSym = (s) => /^[A-Z.]{1,6}\d{6}[CP]\d{8}$/.test(s);
const occ = (s) => { const m = /^([A-Z.]{1,6})(\d{6})([CP])(\d{8})$/.exec(String(s || '').toUpperCase()); return m ? { root: m[1], exp: m[2], type: m[3], k: +m[4] / 1000 } : null; };
// v0.20.0 (audit #7): in live mode a spread must be one bought and one sold contract on the same stock, expiry and type, with the
// bought one the more expensive (a debit spread: the most it can lose is what you pay). Anything else sells options to open.
function debitSpreadOnly(o) {
  const legs = o.legs || [], buy = legs.filter(l => l.side === 'buy'), sell = legs.filter(l => l.side === 'sell');
  if (legs.length !== 2 || buy.length !== 1 || sell.length !== 1) throw refuse('a spread must be one bought and one sold contract');
  const b = occ(buy[0].symbol), s = occ(sell[0].symbol);
  if (!b || !s || b.root !== s.root || b.exp !== s.exp || b.type !== s.type) throw refuse('both legs must be the same stock, expiry and type (calls or puts)');
  if (!(b.type === 'C' ? b.k < s.k : b.k > s.k)) throw refuse('that is a credit spread (it sells the more expensive contract), which is selling options to open: off in live mode');
  if ([...legs].some(l => +l.ratio_qty && +l.ratio_qty !== 1)) throw refuse('spread legs must be 1:1');
}
// Checked before every live order (POST /v2/orders). Throws (status 403) instead of sending.
export async function liveGuard(m, o) {
  const sym = String(o.symbol || '').toUpperCase(), opt = isOccSym(sym), mult = opt || o.order_class === 'mleg' ? 100 : 1;
  if (o.order_class === 'mleg') { if (!(+o.limit_price > 0)) throw refuse('spreads need a limit price'); debitSpreadOnly(o); return checkCap(m, +o.limit_price * +o.qty * 100, 'this spread'); }
  if (o.side === 'sell') {
    if (opt && /to_open/.test(o.position_intent || 'sell_to_open')) throw refuse('selling options to open is off in live mode');
    if (/^(bracket|oto)$/.test(o.order_class || '')) throw refuse('a sell with attached orders is off in live mode (its other legs would be buys the cap cannot see)'); // v0.20.0 (audit #7); an OCO exit (stop + target, both sells) stays allowed
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
// Money an open order can still put in the market. v0.20.0 (audit #7): market buys by quantity (and stop orders without a limit)
// are priced at the live price, no longer at $0; a spread counts its net debit once (its legs carry no prices). Only orders still
// working count, and only their unfilled part: a filled bracket parent comes back with its live legs, and its shares are already
// in the positions. Anything not finished counts (pending_cancel, done_for_day, stopped and suspended orders can still fill).
const DONE = new Set(['filled', 'canceled', 'expired', 'rejected', 'replaced']), working = (s) => !DONE.has(s);
async function pendingBuys(open, skipId) {
  const rows = [], left = (x) => Math.max(0, (+x.qty || 0) - (+x.filled_qty || 0));
  for (const o of open || []) {
    if (skipId && o.id === skipId) continue;
    if (o.order_class === 'mleg') { if (working(o.status) && +o.limit_price > 0) rows.push({ usd: +o.limit_price * left(o) * 100 }); continue; }
    for (const x of [o, ...(o.legs || [])]) if (x.side === 'buy' && working(x.status) && !(skipId && x.id === skipId)) {
      const mult = isOccSym(x.symbol || '') ? 100 : 1, px = +x.limit_price || +x.stop_price;
      rows.push(+x.notional > 0 ? { usd: +x.notional - (+x.filled_qty || 0) * (+x.filled_avg_price || 0) } : px > 0 ? { usd: left(x) * px * mult } : { sym: x.symbol, qty: left(x) * mult });
    }
  }
  const need = [...new Set(rows.filter(r => r.sym).map(r => r.sym))];
  const sn = need.length ? await snapshots(need).catch(() => ({})) : {};
  let usd = 0;
  for (const r of rows) {
    if (!r.sym) { usd += r.usd; continue; }
    const p = quoteOf(r.sym, sn[r.sym])?.p; if (!(p > 0)) throw refuse(`an open buy for ${r.sym} could not be priced, so no new buy is sent until it fills or you cancel it`);
    usd += r.qty * p;
  }
  return usd;
}
async function checkCap(m, cost, what, skipId) {
  const [pos, open] = await Promise.all([raw(m, 'GET', '/v2/positions'), raw(m, 'GET', '/v2/orders?status=open&limit=500&nested=true')]);
  const held = (pos || []).reduce((a, p) => a + Math.abs(+p.market_value || 0), 0), pending = await pendingBuys(open, skipId);
  if (held + pending + cost > m.cap + 0.01) throw refuse(`${what} ($${cost.toFixed(2)}) would take the money in the market to $${(held + pending + cost).toFixed(2)}, above LIVE_MAX_USD $${m.cap}. Raise it in Vercel if you mean to.`);
}
// v0.20.0 (audit #7): changing a resting buy's price is checked against the cap again, as if it were a new order.
async function patchGuard(m, path, body) {
  if (body?.qty) throw refuse('changing an order\'s size is off in live mode (cancel and re-place instead)');
  if (!(+body?.limit_price > 0 || +body?.stop_price > 0)) return;
  const id = /^\/v2\/orders\/([\w-]+)$/.exec(path)?.[1]; if (!id) throw refuse('unknown order change');
  const o = await raw(m, 'GET', '/v2/orders/' + id);
  if (o.side !== 'buy') return; // moving a sell (a stop or target) never adds money to the market
  const px = +body.limit_price || +body.stop_price, mult = isOccSym(o.symbol || '') || o.order_class === 'mleg' ? 100 : 1;
  return checkCap(m, (+o.qty || 0) * px * mult, `${o.symbol || 'this order'} at the new price`, id);
}
// v0.20.0: live orders and price changes go out one at a time per instance (check, then send, then the next), so two buys sent at
// once (the stock and crypto bots run side by side, or a manual order during a run) cannot both pass the cap on the same numbers.
// Two separate instances can still overlap; recentlyOrdered and the run lock cover the same-symbol case there.
let liveQ = Promise.resolve();
const serial = (fn) => { const p = liveQ.then(fn); liveQ = p.catch(() => null); return p; };
async function call(method, path, body) {
  if (!hasAlpaca()) throw new Error('Alpaca keys are not set');
  const m = tradingMode();
  if (m.live && method === 'POST' && path === '/v2/orders') return serial(async () => { await liveGuard(m, body || {}); return raw(m, method, path, body); });
  if (m.live && method === 'PATCH') return serial(async () => { await patchGuard(m, path, body); return raw(m, method, path, body); });
  return raw(m, method, path, body);
}
export const pget = (p) => call('GET', p);
export const ppost = (p, b) => call('POST', p, b);
export const pdel = (p) => call('DELETE', p);
// v0.20.0 (audit #4): two bot runs can overlap (the daily backup cron and the 15-minute ticker, or "Run now" while a scheduled run
// is still working), and each decides from its own snapshot of the account. Right before a bot sends a NEW entry it asks Alpaca for
// that symbol's orders from the last `minutes` and stands down if one whose id matches `id` (a prefix, or a RegExp) is there and was
// not canceled, rejected or expired, so the second run never doubles an order (or, in live mode, the LIVE_MAX_USD room).
export async function recentlyOrdered(symbol, id, minutes = 15) {
  const after = new Date(Date.now() - minutes * 6e4).toISOString();
  const list = await call('GET', `/v2/orders?status=all&limit=100&direction=desc&nested=false&symbols=${encodeURIComponent(symbol)}&after=${after}`);
  const hit = typeof id === 'string' ? (c) => c.startsWith(id) : (c) => id.test(c);
  return (list || []).some(o => hit(o.client_order_id || '') && !['canceled', 'rejected', 'expired'].includes(o.status));
}
// A request that timed out may have reached Alpaca: never follow it with a "close the whole position" fallback.
export const timedOut = (e) => e?.name === 'TimeoutError' || e?.name === 'AbortError';
// v0.20.0: an exit sell sent after its stops were canceled must not be lost to a timeout. One retry with the same client_order_id:
// if the first one did reach Alpaca, the copy is refused as a duplicate, which counts as sent.
export async function ppostSure(path, body) {
  try { return await ppost(path, body); } catch (e) {
    if (!timedOut(e) || !body?.client_order_id) throw e;
    // Whatever the retry says, the first one may be working at Alpaca: report the timeout so callers never run a close-all fallback.
    return ppost(path, body).catch(e2 => { if (/client_order_id/i.test(e2.message || '') && e2.status === 422) return null; throw e; });
  }
}
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
