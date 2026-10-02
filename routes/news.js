import { json, denied, fail, needKeys, authorized, hasAlpaca } from '../lib/core.js';
import { mergedNews } from '../lib/news.js';
// Headlines from every free source, newest first: Benzinga via Alpaca, SEC 8-K filings, GlobeNewswire, PR Newswire,
// Federal Reserve (lib/news.js). ?symbols=AAPL,TSLA narrows it to Benzinga headlines for those tickers.
export async function GET(req) {
  if (!authorized(req)) return denied();
  if (!hasAlpaca()) return needKeys('the news feed');
  try {
    const sy = (new URL(req.url).searchParams.get('symbols') || '').toUpperCase().replace(/[^A-Z,./]/g, '').slice(0, 300);
    const { items, sources } = await mergedNews({ symbols: sy });
    return json({ items, sources, at: new Date().toISOString() }, { cache: 20, swr: 20 });
  } catch (e) { return fail(e, 'news'); }
}
