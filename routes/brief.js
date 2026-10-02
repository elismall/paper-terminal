import { json, denied, fail, needKeys, authorized, hasAlpaca } from '../lib/core.js';
import { marketBrief } from '../lib/news.js';
import { makeJudge, NEWS_Q } from '../lib/jev.js';
// Market Brief · last 24 h (News tab): the stocks with the most news, how the price reacted, a plain-English read built from
// rules, and Jev's read of the headlines when the Jev key is set (up to 6 stocks, cached 10 minutes at the CDN).
export async function GET(req) {
  if (!authorized(req)) return denied();
  if (!hasAlpaca()) return needKeys('the market brief');
  try {
    const judge = makeJudge(NEWS_Q, { log: false });
    return json(await marketBrief({ judge: judge.mode === 'off' ? null : judge }), { cache: 600, swr: 600 });
  } catch (e) { return fail(e, 'brief'); }
}
