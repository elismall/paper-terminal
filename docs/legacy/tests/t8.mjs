// v0.10.0 news layer + daily history
import { blob, posted, M, orders, open, positions } from './mock.mjs';
import './newsmock.mjs';
const T = new URL('../', import.meta.url).href;
process.env.SEC_USER_AGENT = 'Test Person test@example.com';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const N = await import(T + 'lib/news.js'), fs = await import('fs');
// parsing + tagging
ok(JSON.stringify(N.tickersIn('Acme (NASDAQ: ABCD) and Beta (NYSE:XYZ); Gamma (TSX: GMA)')) === '["ABCD","XYZ"]', 'tickers from "(NASDAQ: ABCD)" style text, Canadian-only listings skipped');
let c = N.classify('Apple beats estimates, raises full-year outlook'); ok(c.cats.includes('beat') && c.tone > 0, 'beat/raise tagged positive');
c = N.classify('ABCD Therapeutics Announces Pricing of $50 Million Public Offering'); ok(c.cats.includes('offering') && c.tone < 0, 'share offering tagged negative');
c = N.classify('INVESTOR ALERT: Pomerantz Law Firm Investigates Claims On Behalf of Investors of XYZ'); ok(c.noise && c.cats[0] === 'lawfirm', 'law-firm ad marked as noise');
c = N.classify('Morgan Stanley downgrades XYZ to Underweight'); ok(c.cats.includes('downgrade'), 'downgrade tagged');
ok(N.unxml('AT&amp;T &#8217;s &lt;b&gt;') === 'AT&T ’s <b>', 'XML entities decoded');
// merged News tab feed
const mn = await N.mergedNews();
const src = Object.fromEntries(mn.sources.map(s => [s.src, s]));
ok(src['Benzinga'].n === 5 && src['SEC 8-K'].n === 2 && src['GlobeNewswire'].n === 3 && src['Federal Reserve'].n === 1, 'all sources read: ' + mn.sources.map(s => `${s.src} ${s.error ? 'ERR ' + s.error : s.n}`).join(', '));
ok(src['PR Newswire'].error && mn.items.length > 5, 'a blocked source (PR Newswire 403) is reported and the rest still show');
const k8 = mn.items.find(x => x.kind === '8k' && x.syms[0] === 'AAPL'); ok(k8 && /earnings/.test(k8.h) && k8.cats.includes('earnings'), '8-K mapped to ticker via SEC CIK list and tagged: ' + k8?.h);
ok(!mn.items.some(x => x.h.includes('Private Fund')), '8-Ks from unlisted filers dropped');
ok(M.secUA === 'Test Person test@example.com', 'SEC requests carry SEC_USER_AGENT (SEC fair-access rule)');
ok(mn.items.every((x, i) => !i || Date.parse(mn.items[i - 1].t) >= Date.parse(x.t)), 'newest first');
// Market Brief
const judge = async (items) => ({ mode: 'shadow', results: Object.fromEntries(items.map(i => [i.s, { impact: 2.1, dir: 'up', dirConf: 0.64, priced: 0.4, risk: 0.2 }])) });
const B = await N.marketBrief({ judge });
const aapl = B.movers.find(m => m.s === 'AAPL'), abcd = B.movers.find(m => m.s === 'ABCD');
ok(aapl && aapl.cats.includes('beat / raised outlook') && aapl.jev?.dir === 'up' && aapl.read.length > 20, 'brief: AAPL with tags, rule read and Jev read: ' + aapl?.read);
ok(abcd && abcd.cats.includes('share offering') && /offering/i.test(abcd.read), 'brief: ABCD offering from the wire + 8-K');
ok(!B.movers.some(m => m.s === 'BTCUSD') && B.macro.some(x => /FOMC|Fed/.test(x.h)), 'crypto pairs left out of stock movers; Fed items in the macro list');
ok(/law-firm ads skipped/.test(B.lead) && /Last 24 hours/.test(B.lead), 'lead: ' + B.lead);
fs.writeFileSync('fx-brief.json', JSON.stringify(B)); fs.writeFileSync('fx-news.json', JSON.stringify({ ...mn, at: new Date().toISOString() }));
// bot features
const F = await N.newsFeatures(['AAPL', 'ABCD', 'XYZ']);
ok(F.AAPL.earnIn === 2 && F.AAPL.earnAgo === 89 && F.AAPL.beat, `AAPL: earnings estimated in ${F.AAPL.earnIn} days (same quarter last year + 364), last report ${F.AAPL.earnAgo} days ago`);
ok(F.ABCD.offering && F.XYZ.downgrade, 'ABCD offering (8-K 3.02 / 424B5), XYZ downgrade');
let v = N.newsVerdict(F.AAPL); ok(v.act === 'skip' && /earnings/.test(v.why) && v.tag.startsWith('-n') && v.tag.includes('E'), 'verdict AAPL: ' + v.act + ' ' + v.tag + ' · ' + v.why);
v = N.newsVerdict(F.ABCD); ok(v.act === 'skip' && v.tag.includes('O'), 'verdict ABCD: ' + v.tag + ' · ' + v.why);
const tag = N.newsTag(F.XYZ, 0.2), coid = `tbbot-20260928-XYZ-pullback-sc70-h10-s190${tag}-f`, p = N.parseNewsTag(coid);
ok(p && p.veto === 'D' && Math.abs(p.jevNews - 2 / 9) < 1e-9 && /SKIPPED/.test(N.newsTagText(p)), 'tag round-trip in the order id: ' + coid);
ok(N.parseNewsTag('tbdca-2609281400-SOLUSD-b-u1-b1-n6-d1-k1-v1-t1-x5-fa') === null, 'DCA ids (which have -n<dips>) are never read as news tags');
ok(JSON.stringify(N.newsState(F.AAPL)).length < 1500 && N.newsState(F.AAPL).earnings_in_days_est === 2, 'Jev gets a compact news state');
// stock bot dry run: news recorded, trades unchanged in shadow mode
M.clockOpen = true;
const { tokenFor } = await import(T + 'lib/core.js'); const k = tokenFor('pw');
const r = await (await import(T + 'routes/bot.js')).GET(new Request(`http://x/api/bot?k=${k}&dry=1&only=stocks`)); const j = await r.json();
ok(j.news?.mode === 'shadow' && typeof j.news.checked === 'number', `stock run reports the news layer: mode ${j.news?.mode}, checked ${j.news?.checked}, would skip ${j.news?.wouldSkip?.length}`);
// history
const H = await import(T + 'lib/history.js');
const snap = await H.dailySnapshot({ version: '0.10.0', safety: { level: 1, label: 'Normal' } });
ok(snap.d && snap.equity === 100000 && snap.open && snap.toDate && snap.settings, 'daily snapshot built: ' + JSON.stringify({ d: snap.d, equity: snap.equity, open: snap.open }));
const h1 = await H.saveDaily(snap), h2 = await H.saveDaily({ ...snap, equity: 100500 });
ok(h2.days.length === 1 && h2.days[0].equity === 100500, 'same day saved twice = one row (replaced)');
await H.saveDaily({ ...snap, d: '2026-09-27', equity: 99900 }); const h3 = await H.readHistory();
ok(h3.days.length === 2 && h3.days[0].d === '2026-09-27', 'history keeps one row per day, oldest first');
const md = H.historyMarkdown(h3); ok(md.startsWith('| Day (ET)') && md.indexOf(snap.d) < md.indexOf('2026-09-27') && /Live settings/.test(md), 'Markdown export newest first');
fs.writeFileSync('fx-history.json', JSON.stringify({ days: h3.days, md, at: new Date().toISOString() }));
const hr = await (await import(T + 'routes/history.js')).GET(new Request(`http://x/api/history?k=${k}`)); const hj = await hr.json();
ok(hj.days.length === 2 && hj.md.includes('Live settings'), 'GET /api/history returns days + markdown');
const nr = await (await import(T + 'routes/history.js')).GET(new Request('http://x/api/history')); ok(nr.status === 401, 'history needs the passcode');
const pf = await (await import(T + 'routes/performance.js')).GET(new Request(`http://x/api/performance?k=${k}`)); const pj = await pf.json();
ok(pj.news && pj.news.buckets.length === 5 && pj.news.buckets.some(b => /CPI \/ jobs \/ Fed/.test(b.label)) && pj.news.buckets.some(b => /Insiders/.test(b.label)), 'performance returns the news scorecard buckets (v0.11.0: + macro-day and insider-buying rows)');
const hp = await (await import(T + 'routes/health.js')).GET(new Request('http://x/api/health?probe=news')); const hj2 = await hp.json();
ok(hj2.news?.sources?.length === 5 && hj2.news.aapl?.verdict?.act === 'skip' && hj2.version === (await import(T + 'lib/version.js')).VERSION && Array.isArray(hj2.news.calendar?.events), 'health ?probe=news: source counts + AAPL features + calendar, current version');
fs.writeFileSync('fx-perf.json', JSON.stringify(pj));
