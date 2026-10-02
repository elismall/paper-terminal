import { json, fail, authorized, hasAlpaca, needKeys, CRYPTO_UNIVERSE } from '../lib/core.js';
import { pget } from '../lib/trade.js';
// Every active, tradable US stock/ETF plus Alpaca crypto pairs, for search suggestions. Cached a day at the CDN.
export async function GET(req) {
  if (!authorized(req)) return json({ error: 'locked', message: 'Enter your passcode in Settings.' }, { status: 401 });
  if (!hasAlpaca()) return needKeys('symbol search');
  try {
    const [eq, cr] = await Promise.all([pget('/v2/assets?status=active&asset_class=us_equity'), pget('/v2/assets?status=active&asset_class=crypto').catch(() => [])]);
    const list = eq.filter(a => a.tradable).map(a => [a.symbol, (a.name || '').replace(/\s+(Common Stock|Class A Common Stock|Ordinary Shares|Common Shares)$/i, '').slice(0, 60), a.exchange]);
    const crypto = (cr.length ? cr.filter(a => a.tradable && /\/USD$/.test(a.symbol)).map(a => [a.symbol, a.name || a.symbol, 'CRYPTO']) : CRYPTO_UNIVERSE.map(s => [s, s, 'CRYPTO']));
    return json({ n: list.length + crypto.length, list: [...crypto, ...list] }, { cache: 86400, swr: 86400 * 3 });
  } catch (e) { return fail(e, 'symbols'); }
}
