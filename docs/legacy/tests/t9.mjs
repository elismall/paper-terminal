// v0.10.0: a real stock entry path with the news layer (shadow and gate), using a forced MSFT breakout (MSFT's fake SEC history = earnings due in ~2 days)
import { M, posted } from './mock.mjs';
import './newsmock.mjs';
const T = new URL('../', import.meta.url).href;
process.env.SEC_USER_AGENT = 'Test Person test@example.com';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const DAY = 864e5, n = 420, y = Date.now() - DAY, bars = [];
let p = 100; for (let i = 0; i < n; i++) { const t = new Date(y - (n - 1 - i) * DAY); t.setUTCHours(4, 0, 0, 0); const last = i === n - 1; const o = p; p = last ? p * 1.03 : p * (1.003 + (i % 7 === 0 ? -0.004 : 0)); bars.push({ t: t.toISOString(), o, h: Math.max(o, p) * 1.004, l: Math.min(o, p) * 0.996, c: p, v: last ? 3e6 : 1e6 }); }
M.gapPx = { MSFT: p * 1.001 };
const base = global.fetch;
global.fetch = async (url, opt) => { const u = new URL(url); if (u.pathname === '/v2/stocks/bars' && u.searchParams.get('timeframe') === '1Day' && (u.searchParams.get('symbols') || '').split(',').includes('MSFT')) {
  const r = await (await base(url, opt)).json(); const s = Date.parse(u.searchParams.get('start')) || 0; r.bars.MSFT = bars.filter(b => Date.parse(b.t) >= s); return new Response(JSON.stringify(r)); } return base(url, opt); };
M.clockOpen = true;
const { tokenFor } = await import(T + 'lib/core.js'); const k = tokenFor('pw');
const run = async (q) => (await (await import(T + 'routes/bot.js')).GET(new Request(`http://x/api/bot?k=${k}&only=stocks${q}`))).json();
let j = await run('&dry=1'); const a = (j.placed || []).find(x => x.s === 'MSFT');
ok(a && a.news?.rule === 'skip' && /earnings/.test(a.news.why) && a.news.mode === 'shadow', 'shadow: MSFT breakout still placed; news rule recorded "would skip": ' + JSON.stringify(a?.news));
ok(j.news?.wouldSkip?.some(x => x.s === 'MSFT'), 'run output lists MSFT under news wouldSkip');
posted.length = 0; j = await run('&run=1&max=1');
const o = posted.find(x => x.symbol === 'MSFT');
ok(o && /-n\d[A-Z]*E/.test(o.client_order_id) && o.client_order_id.length <= 128, 'real order carries the news tag: ' + o?.client_order_id);
const N = await import(T + 'lib/news.js'); ok(/SKIPPED/.test(N.newsTagText(N.parseNewsTag(o?.client_order_id))), 'bot view text for that order: ' + N.newsTagText(N.parseNewsTag(o?.client_order_id)));
process.env.NEWS_MODE = 'gate'; posted.length = 0; j = await run('&dry=1');
ok(!(j.placed || []).some(x => x.s === 'MSFT') && (Array.isArray(j.skipped) ? j.skipped : []).some(x => x.s === 'MSFT' && /^news: earnings/.test(x.why)), 'gate mode: MSFT skipped for earnings in ~2 days');
process.env.NEWS_MODE = 'off'; j = await run('&dry=1'); const a2 = (j.placed || []).find(x => x.s === 'MSFT');
ok(a2 && a2.news === null && j.news.checked === 0, 'NEWS_MODE=off: no news lookups, trade unchanged');
process.env.NEWS_MODE = ''; process.env.TYPESAFE_API_KEY = 'test-key'; posted.length = 0; j = await run('&run=1&max=1');
const o2 = posted.find(x => x.symbol === 'MSFT');
ok(o2 && /-n0E[A-Z]*w1(-|$)/.test(o2.client_order_id), 'with Jev on: the 8th question (news_support) passes the API format check and lands in the tag: ' + o2?.client_order_id);
