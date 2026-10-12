// v0.11.0: economic calendar (FRED release dates + Fed meeting dates) and insider buying (SEC Form 4) in the stock bot's news layer
import { M } from './mock.mjs';
import './newsmock.mjs';
const T = new URL('../', import.meta.url).href;
process.env.SEC_USER_AGENT = 'Test Person test@example.com';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const C = await import(T + 'lib/calendar.js'), N = await import(T + 'lib/news.js');
const DAY = 864e5, nyDay = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }), now = Date.now();

// ---- calendar ----
delete process.env.FRED_API_KEY; C.resetCalendar();
let cal = await C.econCalendar({ now: Date.parse('2026-10-20T14:00:00Z'), days: 14 });
ok(/Fed meeting dates only/.test(cal.error) && cal.events.length === 1 && cal.events[0].d === '2026-10-28' && cal.events[0].name === 'FOMC decision' && cal.events[0].time === '2:00 PM', 'no FRED key: the built-in Fed date (Oct 28, 2:00 PM) still shows: ' + JSON.stringify(cal.events));
process.env.FRED_API_KEY = 'fredtestkey'; C.resetCalendar();
M.fredDates = [{ release_id: 10, release_name: 'Consumer Price Index', date: nyDay(now + DAY) }, { release_id: 50, release_name: 'Employment Situation', date: nyDay(now + 4 * DAY) },
  { release_id: 9, release_name: 'Advance Monthly Sales for Retail and Food Services', date: nyDay(now) }, { release_id: 999, release_name: 'Some Minor Survey', date: nyDay(now) }, { release_id: 101, release_name: 'FOMC Press Release', date: nyDay(now + 3 * DAY) }];
M.fredIds = []; cal = await C.econCalendar({ now });
ok(M.fredQuery.include_release_dates_with_no_data === 'true' && M.fredQuery.realtime_start === nyDay(now) && M.fredQuery.file_type === 'json', 'FRED asked for future release dates (include_release_dates_with_no_data=true, from today, JSON)');
ok(M.fredIds.sort((a, z) => a - z).join() === '9,10,46,50,53,54', 'one small request per market-moving release (ids 9, 10, 46, 50, 53, 54), never the whole release list: ' + M.fredIds.join());
ok(!cal.events.some(e => e.name === 'FOMC decision' && e.src === 'FRED'), 'FRED\'s FOMC press-release dates are ignored (FRED lists every day); Fed days come from the built-in meeting list');
ok(cal.events.some(e => e.name === 'CPI' && e.top) && cal.events.some(e => e.name === 'Retail sales' && !e.top) && !cal.events.some(e => /Minor/.test(e.name)), 'CPI kept as a top event, retail sales kept as minor, unrelated releases dropped: ' + cal.events.map(e => `${e.name} ${e.d}`).join(', '));
let risk = C.eventRisk(cal, now);
ok(risk.length === 1 && risk[0].name === 'CPI' && risk[0].when === 'tomorrow', 'event risk = top releases today or tomorrow only (CPI tomorrow; retail sales today is minor, jobs report in 4 days is too far): ' + JSON.stringify(risk.map(r => r.name + ' ' + r.when)));
const calls = M.fredCalls; await C.econCalendar({ now }); ok(M.fredCalls === calls, 'calendar cached (one FRED call per 6 hours)');
M.fredStatus = 500; C.resetCalendar(); cal = await C.econCalendar({ now });
ok(/FRED answered 500/.test(cal.error) && /Fed meeting dates only/.test(cal.error) && !JSON.stringify(cal).includes('fredtestkey'), 'FRED failure is reported without leaking the key: ' + cal.error);
let c0 = M.fredCalls; M.fredStatus = 0; await C.econCalendar({ now: now + 60e3 }); ok(M.fredCalls === c0, 'a failed lookup is kept briefly (no retry storm)');
cal = await C.econCalendar({ now: now + 16 * 6e4 }); ok(M.fredCalls > c0 && !cal.error && cal.events.some(e => e.name === 'CPI'), 'a failed lookup is retried after 15 minutes, not 6 hours');
M.fredStatus = 500; M.fredBadIds = [46]; C.resetCalendar(); cal = await C.econCalendar({ now });
ok(/for PPI$/.test(cal.error) && cal.events.some(e => e.name === 'CPI'), 'one release failing keeps the others: ' + cal.error);
M.fredStatus = 0; M.fredBadIds = null; C.resetCalendar();

// ---- Form 4 ----
const { F4XML } = await import('./newsmock.mjs');
let f = N.parseForm4(F4XML['f4a.xml']); ok(f.rel && f.buy === 60000 && f.sell === 0, 'Form 4: director open-market buys add up ($60,000): ' + JSON.stringify(f));
f = N.parseForm4(F4XML['f4b.xml']); ok(f.rel && f.buy === 0 && f.sell === 82000, 'Form 4: officer sale counted, option exercise (code M) ignored: ' + JSON.stringify(f));
f = N.parseForm4(F4XML['f4c.xml']); ok(!f.rel && f.buy === 4000000, 'Form 4: a 10% owner is not an officer/director (rel=false)');

// ---- features, verdict, tag ----
M.secArchive = []; M.secTimes = [];
const F = await N.newsFeatures(['INSD', 'AAPL'], { now });
const I = F.INSD.insider;
ok(I && I.buyUsd === 60000 && I.sellUsd === 82000 && I.buys === 1 && I.filings === 3, 'INSD insider summary (30 days): director bought $60k, officer sold $82k, 10% owner and the 45-day-old filing ignored: ' + JSON.stringify(I));
ok(M.secArchive.every(p => /^\/Archives\/edgar\/data\/333\/000033326\d+\/f4[abc]\.xml$/.test(p)) && M.secArchive.length === 3, 'raw Form 4 XML fetched (styled xslF345X05 folder stripped, dashes removed from the accession): ' + M.secArchive.join(' '));
const gaps = M.secTimes.slice(1).map((t, i) => t - M.secTimes[i]); ok(gaps.every(g => g >= 100), 'SEC calls spaced 100 ms+ apart (fair-access limit 10 a second): ' + gaps.join(','));
ok(F.AAPL.event?.length === 1 && /^CPI tomorrow 8:30 AM ET$/.test(F.AAPL.event[0]), 'every candidate carries the event risk: ' + JSON.stringify(F.AAPL.event));
let v = N.newsVerdict(F.INSD);
ok(v.tag.includes('C') && v.tag.includes('I') && v.act === 'half' && /market-moving release: CPI tomorrow/.test(v.why), 'verdict INSD: C = half size (CPI tomorrow), I recorded only: ' + v.act + ' ' + v.tag + ' · ' + v.why);
v = N.newsVerdict({ ...F.INSD, event: null }); ok(v.act === 'ok' && v.tag.includes('I') && !v.tag.includes('C'), 'insider buying alone never changes the trade (shadow signal): ' + v.act + ' ' + v.tag);
v = N.newsVerdict(F.AAPL); ok(v.act === 'skip' && v.tag.includes('E') && v.tag.includes('C'), 'a skip reason (earnings) still wins over the half-size reason: ' + v.tag);
const coid = `tbbot-20260928-INSD-breakout-sc72-h10-s38.5${N.newsTag(F.INSD, 0.7)}`, p = N.parseNewsTag(coid);
ok(p && p.flags.includes('C') && p.flags.includes('I') && p.caution && !p.veto && Math.abs(p.jevNews - 6 / 9) < 1e-9 && coid.length <= 128, 'tag round-trip with C and I: ' + coid);
const txt = N.newsTagText(p); ok(/CPI \/ jobs report \/ Fed decision/.test(txt) && /insiders bought/.test(txt) && /half size/.test(txt), 'bot view text: ' + txt);
ok(N.parseNewsTag('tbbot-20260928-AAA-pullback-sc70-h10-s10-n2PN')?.caution === true && N.parseNewsTag('tbbot-20260928-AAA-pullback-sc70-h10-s10-n2P')?.caution === false, 'v0.10.0 order ids still read the same');
const st = N.newsState(F.INSD); ok(st.insider_open_market_buys_usd_30d === 60000 && st.market_moving_releases_soon[0] === 'CPI tomorrow 8:30 AM ET', 'Jev sees insider dollars and the upcoming release');

// ---- wires pause after an error ----
M.prn = 0; const mn1 = await N.mergedNews(), mn2 = await N.mergedNews();
const e1 = mn1.sources.find(s => s.src === 'PR Newswire').error, e2 = mn2.sources.find(s => s.src === 'PR Newswire').error;
ok(/403/.test(e1) && /retrying after \d{1,2}:\d\d [AP]M ET/.test(e2), 'a failing feed is paused 5 minutes (12-hour ET time shown): ' + e2);

// ---- Market Brief carries the calendar; performance scorecard buckets; history ----
const B = await N.marketBrief(); ok(B.calendar.events.some(e => e.name === 'CPI'), 'Market Brief includes the economic calendar');
const V = (await import(T + 'lib/version.js')).VERSION; ok(/^\d+\.\d+\.\d+$/.test(V) && V !== '0.10.0', 'version file: ' + V);
const H = await import(T + 'lib/history.js'), md = H.historyMarkdown({ days: [{ d: '2026-09-28', v: V, equity: 1e5, dayPnl: 0, dayPct: 0, open: { stock: 0, dcaCrypto: 0, dcaMeme: 0, dcaEtf: 0, openPnl: 0 }, closedToday: {}, toDate: {},
  scorecards: { jevStrong: { n: 0 }, jevWeak: { n: 0 }, newsWouldSkip: { n: 0 }, newsClean: { n: 0 }, macroDay: { n: 2, win: 50, pnl: 10 }, insiderBuy: { n: 1, win: 100, pnl: 30 } }, settings: {}, modes: {} }] });
ok(/CPI \/ jobs \/ Fed day 2 · 50% win · \$10/.test(md) && /insiders had bought 1 · 100% win · \$30/.test(md), 'daily history Markdown has the two new scorecards');
