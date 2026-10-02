// Single entry point for every /api/* route (Vercel Hobby allows 12 functions per deployment).
// vercel.json rewrites /api/<name> to /api/router?__p=<name>; the handlers live in /routes.
import * as account from '../routes/account.js';
import * as bars from '../routes/bars.js';
import * as benchmark from '../routes/benchmark.js';
import * as bot from '../routes/bot.js';
import * as botMid from '../routes/bot-mid.js';
import * as botPm from '../routes/bot-pm.js';
import * as botCrypto from '../routes/bot-crypto.js';
import * as botCheck from '../routes/bot-check.js';
import * as botview from '../routes/botview.js';
import * as brief from '../routes/brief.js';
import * as catalyst from '../routes/catalyst.js';
import * as control from '../routes/control.js';
import * as crypto from '../routes/crypto.js';
import * as dcalab from '../routes/dcalab.js';
import * as gapcheck from '../routes/gapcheck.js';
import * as health from '../routes/health.js';
import * as hist from '../routes/hist.js';
import * as history from '../routes/history.js';
import * as intraday from '../routes/intraday.js';
import * as jev from '../routes/jev.js';
import * as longterm from '../routes/longterm.js';
import * as macro from '../routes/macro.js';
import * as news from '../routes/news.js';
import * as options from '../routes/options.js';
import * as order from '../routes/order.js';
import * as performance from '../routes/performance.js';
import * as push from '../routes/push.js';
import * as quotes from '../routes/quotes.js';
import * as swing from '../routes/swing.js';
import * as symbols from '../routes/symbols.js';
import * as session from '../routes/session.js';
import * as tick from '../routes/tick.js';

const R = { account, bars, benchmark, bot, 'bot-mid': botMid, 'bot-pm': botPm, 'bot-crypto': botCrypto, 'bot-check': botCheck, botview, brief, catalyst, control, crypto, dcalab, gapcheck, health, hist, history, intraday, jev, longterm, macro, news, options, order, performance, push, quotes, session, swing, symbols, tick };
const notFound = () => json({ error: 'not_found', message: 'Unknown API route' }, 404);
// v0.17.0: a request that changes something (POST/DELETE) must come from this site's own pages. Browsers send Sec-Fetch-Site
// and Origin on those; a page on another site gets 403 (with the SameSite=Strict cookie this blocks cross-site request forgery).
const json = (o, status) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } });
function sameSite(req) {
  const site = req.headers.get('sec-fetch-site'); if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.get('origin'); if (!origin) return true; // non-browser callers (cron, curl) carry no cookie anyway
  try { return new URL(origin).host === new URL(req.url).host || new URL(origin).host === req.headers.get('x-forwarded-host'); } catch { return false; }
}
const handle = (method) => async (req) => {
  if (method !== 'GET' && !sameSite(req)) return json({ error: 'forbidden', message: 'Cross-site request refused.' }, 403);
  const u = new URL(req.url);
  const name = (u.searchParams.get('__p') || u.pathname.replace(/^\/api\//, '')).split('/')[0];
  const mod = R[name];
  if (!mod || name === 'router') return notFound();
  const fn = mod[method];
  if (!fn) return json({ error: 'method_not_allowed' }, 405);
  return fn(req);
};
export const GET = handle('GET');
export const POST = handle('POST');
export const DELETE = handle('DELETE');
