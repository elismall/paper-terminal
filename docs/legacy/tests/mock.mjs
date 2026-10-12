import { barsResponse, hourly } from './mockdata.mjs';
import { PACE } from '../lib/core.js';
PACE.perSec = 1e6; PACE.cap = PACE.tokens = 1e6; // no request pacing in tests (t15 checks the pacer on its own)
Object.assign(process.env, { ALPACA_KEY_ID: 'x', ALPACA_SECRET_KEY: 'y', DASH_PASSCODE: 'pw', CRON_SECRET: 'cs', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_TeStStore_secret' });
export const blob = {}, posted = [], deleted = [], closedPos = [], jevCalls = [], ops = { adv: 0, simple: 0, list: 0 };
const BB = 'https://teststore.public.blob.vercel-storage.com/';
export const M = { posOver: {}, gapPx: {}, hist: null, jevFail: false, clockOpen: false, snapAgeMin: 0, lastEquity: 100000, blobDown: false, extraPos: [] };
const ago = (h) => new Date(Date.now() - h * 36e5).toISOString();
const S = 'n6-d1.5-k1-v1.8-t1.5-x5-fd';
const sol = (kind, extra) => ({ id: 'sol-' + kind, symbol: 'SOL/USD', client_order_id: `tbdca-2609251440-SOLUSD-${kind}-u83.33-b150-${S}-j22-zabc${kind}`, submitted_at: ago(20), ...extra });
export const orders = [
  sol('s1', { side: 'buy', type: 'limit', qty: '1.0151', filled_qty: '1.0151', filled_avg_price: '147.75', filled_at: ago(10), status: 'filled', limit_price: '147.75' }),
  sol('b', { side: 'buy', type: 'market', qty: '0.5555', filled_qty: '0.5555', filled_avg_price: '150', filled_at: ago(20), status: 'filled' }),
  { id: 'aapl-bot', symbol: 'AAPL', side: 'buy', qty: '5', filled_qty: '5', filled_avg_price: '200', filled_at: ago(40), submitted_at: ago(40), client_order_id: 'tbbot-20260926-AAPL-pullback-sc70-h10-s190-j24e3r1d2', status: 'filled' },
  { id: 'link-cry', symbol: 'LINK/USD', side: 'buy', qty: '10', filled_qty: '10', filled_avg_price: '100', filled_at: ago(30), submitted_at: ago(30), client_order_id: 'tbcry-20260925-LINKUSD-breakout-sc70-h5-s95-t110-j18', status: 'filled' },
  // XRP: TP sold all but dust; old dip buys still resting
  { id: 'xrp-tp', symbol: 'XRP/USD', side: 'sell', type: 'limit', qty: '4.999999999', filled_qty: '4.999999999', filled_avg_price: '1.5', filled_at: ago(2), submitted_at: ago(8), client_order_id: `tbdca-2609250000-XRPUSD-tp-u83.33-b1.48-${S}-zq2`, status: 'filled' },
  { id: 'xrp-b', symbol: 'XRP/USD', side: 'buy', qty: '5', filled_qty: '5', filled_avg_price: '1.48', filled_at: ago(9), submitted_at: ago(9), client_order_id: `tbdca-2609250000-XRPUSD-b-u83.33-b1.48-${S}-j5-zq3`, status: 'filled' },
];
export const open = [
  sol('s2', { id: 'o-s2', side: 'buy', type: 'limit', qty: '1.8', limit_price: '145.5', status: 'new', time_in_force: 'gtc' }),
  sol('tp', { id: 'o-tp', side: 'sell', type: 'limit', qty: '1.5706', limit_price: '150.76', status: 'new', time_in_force: 'gtc' }),
  { id: 'o-xrp-s1', symbol: 'XRP/USD', side: 'buy', type: 'limit', qty: '60', limit_price: '1.44', status: 'new', client_order_id: `tbdca-2609250000-XRPUSD-s1-u83.33-b1.48-${S}-zq4`, submitted_at: ago(8) },
  { id: 'o-xrp-s2', symbol: 'XRP/USD', side: 'buy', type: 'limit', qty: '80', limit_price: '1.36', status: 'new', client_order_id: `tbdca-2609250000-XRPUSD-s2-u83.33-b1.48-${S}-zq5`, submitted_at: ago(8) },
  { id: 'o-link-stop', symbol: 'LINK/USD', side: 'sell', type: 'stop_limit', qty: '10', stop_price: '95', limit_price: '94', status: 'new', client_order_id: 'tbcstop-x', submitted_at: ago(29) },
  { id: 'o-aapl-stop', symbol: 'AAPL', side: 'sell', type: 'stop', qty: '5', stop_price: '190', status: 'new', time_in_force: 'gtc', client_order_id: 'tbprot-x-s', submitted_at: ago(39) },
  { id: 'o-snow', symbol: 'SNOW261016C00150000', side: 'buy', type: 'limit', qty: '1', limit_price: '2', status: 'new', client_order_id: 'manual-xyz', submitted_at: ago(1) },
];
const POS = () => [
  { symbol: 'SOLUSD', qty: '1.5706', qty_available: '0', avg_entry_price: '148.53', current_price: '147', market_value: '230.9', unrealized_pl: '-2.4', unrealized_plpc: '-0.0103', unrealized_intraday_plpc: '0', asset_class: 'crypto' },
  { symbol: 'LINKUSD', qty: '10', qty_available: '0', avg_entry_price: '100', current_price: '101', market_value: '1010', unrealized_pl: '10', unrealized_plpc: '0.01', unrealized_intraday_plpc: '0', asset_class: 'crypto' },
  { symbol: 'XRPUSD', qty: '0.000000001', qty_available: '0.000000001', avg_entry_price: '1.48', current_price: '1.5', market_value: '0', unrealized_pl: '0', unrealized_plpc: '0', unrealized_intraday_plpc: '0', asset_class: 'crypto' },
  { symbol: 'AAPL', qty: '5', qty_available: '5', avg_entry_price: '200', current_price: '210', market_value: '1050', unrealized_pl: '50', unrealized_plpc: '0.05', unrealized_intraday_plpc: '0', asset_class: 'us_equity' },
];
export const positions = () => [...POS(), ...M.extraPos].map(p => ({ ...p, ...(M.posOver[p.symbol] || {}) }));
const R = (x, st = 200) => new Response(typeof x === 'string' ? x : JSON.stringify(x), { status: st });
global.fetch = async (url, opt = {}) => { const u = new URL(url), P = u.pathname, m = opt.method || 'GET';
  if (u.hostname === 'api.typesafe.ai') { const b = JSON.parse(opt.body); jevCalls.push(b); if (M.jevFail) return R({ error: 'overloaded' }, 529);
    // validate the documented wire format (docs.typesafe.ai/api)
    for (const [k, q] of Object.entries(b.questions)) {
      if (!['noul', 'choice', 'score'].includes(q.type) || typeof q.instructions !== 'string') return R({ error: 'bad ' + k }, 422);
      if (q.type === 'score' && !Array.isArray(q.criteria)) return R({ error: 'score criteria must be array' }, 422);
      if (q.type !== 'score' && (typeof q.criteria !== 'object' || Array.isArray(q.criteria))) return R({ error: k + ' criteria must be object' }, 422);
    }
    const weak = b.state.rsi14 > 60 || b.state.hourly_rsi14 > 60, a = {};
    for (const [k, q] of Object.entries(b.questions)) a[k] = q.type === 'score' ? { type: 'score', score: weak ? 0.4 : 2.4, confidence: weak ? 0.8 : 0.7, probabilities: {} } : q.type === 'choice' ? { type: 'choice', choice: Object.keys(q.criteria)[0], confidence: 0.6, probabilities: {} } : { type: 'noul', noul: k === 'extended' ? 0.35 : 0.12 };
    return R({ model: 'jev-1.13.0', answers: a, usage: { input_tokens: 300, output_tokens: 20 } }); }
  if (u.hostname === 'vercel.com') {
    if (M.blobDown) return R('storage down', 503);
    if (m === 'PUT') { ops.adv++; const pn = u.searchParams.get('pathname'), h = opt.headers || {}; if (h['x-allow-overwrite'] === '0' && pn in blob) return R({ error: { code: 'bad_request', message: 'This blob already exists, use allowOverwrite' } }, 400); blob[pn] = opt.body; return R({ url: BB + pn, pathname: pn }); }
    if (P.endsWith('/delete')) { for (const x of JSON.parse(opt.body).urls) delete blob[x.replace(BB, '')]; return R('{}'); }
    ops.adv++; ops.list++; const pre = u.searchParams.get('prefix'); return R({ blobs: Object.keys(blob).filter(k => k.startsWith(pre)).map(k => ({ pathname: k, url: BB + k })) }); }
  if (u.hostname === 'teststore.public.blob.vercel-storage.com') { ops.simple++; const k = u.pathname.slice(1); if (M.histReadFail && k.startsWith('hist/')) return R('down', 503); return k in blob ? R(blob[k]) : R('nf', 404); }
  if (P.includes('/bars')) return barsResponse(u);
  if (P.includes('snapshots')) { const o = {}; for (const s of u.searchParams.get('symbols').split(',')) { const x = hourly(s, 0).at(-1); const t = new Date(Date.now() - M.snapAgeMin * 6e4).toISOString(); const p = M.gapPx?.[s] ?? x.c; o[s] = { latestTrade: { p, t }, latestQuote: { ap: p * 1.0005, bp: p, t }, dailyBar: x, prevDailyBar: x }; } return R({ snapshots: o }); }
  if (P === '/v2/clock') return R({ is_open: M.clockOpen, next_open: M.nextOpen || new Date().toISOString() });
  if (P === '/v2/account') return R({ equity: '100000', last_equity: String(M.lastEquity), cash: '90000' });
  if (P === '/v2/assets') return R((M.assets || []).map(x => ({ symbol: x, class: 'crypto', status: 'active', tradable: true })));
  if (P.startsWith('/v2/assets/')) { const tiny = /PEPE|SHIB|BONK/.test(P); return R({ tradable: true, min_trade_increment: tiny ? '1' : '0.0001', price_increment: tiny ? '0.000000001' : '0.01', min_order_size: tiny ? '1' : '0.0001' }); }
  if (P === '/v2/positions') return R(positions());
  if (P.startsWith('/v2/positions/') && m === 'DELETE') { closedPos.push(decodeURIComponent(P.split('/').pop())); return R('{}'); }
  if (P.startsWith('/v2/positions/')) { const p = positions().find(x => x.symbol === P.split('/').pop()); return R(p ? { ...p, qty_available: p.qty } : { qty: '1', qty_available: '1' }); }
  if (P.includes('activities')) return R('[]');
  if (P === '/v2/orders' && m === 'POST') { const b = JSON.parse(opt.body); posted.push(b); return R({ id: 'n' + posted.length, ...b, status: 'filled', filled_qty: b.qty || '1', filled_avg_price: '1' }); }
  if (P.startsWith('/v2/orders/') && m === 'DELETE') { deleted.push(P.split('/').pop()); return new Response(null, { status: 204 }); }
  if (P.startsWith('/v2/orders/')) return R({ status: 'filled', filled_qty: '1', filled_avg_price: '1' });
  if (P.startsWith('/v2/orders')) { if (u.searchParams.get('status') === 'open') return R(open); return R([...orders].sort((a, z) => z.submitted_at.localeCompare(a.submitted_at))); }
  if (P.includes('portfolio/history')) return R(M.hist || {});
  return R('[]'); };
