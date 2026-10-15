// v0.13.0: long calls / puts (three strikes, breakeven, decay, value at target), the options' implied move, earnings-aware option
// ideas, past earnings dates with before-open / after-close timing, and the Catalyst Scenario (Jev or keywords classify, past events
// per catalyst type from SEC filings / SEC full-text search / headlines / Fed + FRED dates, stats, swing + option plans, log + grading).
import { blob, M, jevCalls } from './mock.mjs';
import { fridays, subsHistory } from './optmock.mjs';
import { hourly, daily } from './mockdata.mjs';
process.env.SEC_USER_AGENT = 'ELI Terminal test test@example.com'; process.env.FRED_API_KEY = 'fred-test';
const T = new URL('../', import.meta.url).href;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const core = await import(T + 'lib/core.js'), O = await import(T + 'lib/options.js'), N = await import(T + 'lib/news.js'), C = await import(T + 'lib/catalyst.js');
const k = core.tokenFor('pw'), DAY = 864e5, day = (d) => new Date(Date.now() - d * DAY).toISOString().slice(0, 10), nyDay = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const px = hourly('AAPL', 0).at(-1).c;

// ---- 1. long calls / puts ----
const L = await O.longIdeas('AAPL', px, { dir: 'long', want: 35, target: px * 1.08 });
const sk = L.idea?.strikes || [];
ok(L.idea?.strategy === 'Long call' && sk.length === 3 && sk[0].delta > sk[1].delta && sk[1].delta > sk[2].delta && Math.abs(sk[1].delta - 0.5) < 0.12, `long call: three strikes by delta (${sk.map(s => `${s.label} ${s.k} Δ${s.delta}`).join(', ')})`);
ok(sk.every(s => Math.abs(s.breakeven - (s.k + s.ask)) < 0.02 && Math.abs(s.bePct - ((s.k + s.ask) / px - 1) * 100) < 0.02 && s.cost === Math.round(s.ask * 100) && s.thetaDay < 0), 'breakeven = strike + price paid, move needed %, cost per contract, decay per day');
ok(sk.every(s => Math.abs(s.atTarget - Math.round((Math.max(0, px * 1.08 - s.k) - s.ask) * 100)) <= 1), `value at the target price at expiry (${sk.map(s => `$${s.atTarget}`).join(', ')})`);
const P = await O.longIdeas('AAPL', px, { dir: 'short', want: 35 });
ok(P.idea?.strategy === 'Long put' && P.idea.strikes.every(s => s.delta < 0 && Math.abs(s.breakeven - (s.k - s.ask)) < 0.02), 'long put: negative deltas, breakeven = strike − price paid');
const ev = fridays()[3], A = await O.longIdeas('AAPL', px, { dir: 'long', after: ev, want: 21 });
ok(A.idea && A.idea.exp >= new Date(Date.parse(ev) + 2 * DAY).toISOString().slice(0, 10), `with a catalyst date the expiry outlives it (event ${ev}, expiry ${A.idea?.exp})`);
const im = await O.impliedMove('AAPL', px, { after: ev });
ok(im && im.exp > ev && im.pct > 0.5 && im.pct < 15 && Math.abs(im.pct - im.straddle / px * 100) < 0.01, `implied move from the at-the-money straddle (±${im?.pct}% by ${im?.exp})`);

// ---- 2. past earnings dates with timing ----
M.subsOverride = subsHistory(12);
const E = await N.earningsInfo('AAPL');
ok(E.status === 'ok' && E.past.length === 12 && E.past.every(p => p.when === 'after close') && E.past[0].date === day(40), `12 past reports from SEC 8-K 2.02, filings after 4 PM ET read as after the close (${E.past.slice(0, 2).map(p => p.date + ' ' + p.when).join(', ')})`);
ok(E.next && E.next.estimated && E.next.inDays >= 40 && E.next.inDays <= 60, `next report estimated from last year's (${E.next?.date}, in ${E.next?.inDays} days)`);
const early = { filings: { recent: { form: ['8-K'], filingDate: [day(5)], items: ['2.02'], acceptanceDateTime: [`${day(5)}T11:00:00.000Z`] } } };
M.subsOverride = early; (await import(T + 'lib/news.js')); const E2 = await N.earningsInfo('MSFT');
ok(E2.past[0]?.when === 'before open', '7:00 AM ET filing = before the open');
M.subsOverride = subsHistory(12);

// ---- 3. options route: long call + earnings flag ----
const R = await import(T + 'routes/options.js');
const oc = await (await R.GET(new Request(`http://x/api/options?k=${k}&symbol=AAPL&strategy=call&dte=60&target=${(px * 1.1).toFixed(2)}`))).json();
ok(oc.idea?.strategy === 'Long call' && oc.idea.strikes.length === 3 && oc.idea.earn?.date === E.next.date && oc.idea.implied?.pct > 0, `options route: long call idea, flags the estimated report ${oc.idea?.earn?.date} inside the expiry and the implied move by then (±${oc.idea?.implied?.pct}%)`);
const op = await (await R.GET(new Request(`http://x/api/options?k=${k}&symbol=AAPL&strategy=put&dte=14`))).json();
ok(op.idea?.strategy === 'Long put' && op.idea.earn == null, 'long put 2 weeks out: no report inside, no flag');
const sp = await (await R.GET(new Request(`http://x/api/options?k=${k}&symbol=AAPL&dir=long`))).json();
ok(sp.idea?.strategy === 'Call debit spread' && 'earn' in sp.idea, 'debit spreads still work and carry the earnings flag');

// ---- 4. earnings scenario: past reactions measured on the right session ----
delete process.env.TYPESAFE_API_KEY;
const r1 = await C.runScenario({ symbol: 'AAPL', text: 'Apple beats earnings and raises guidance', horizon: 5 });
ok(r1.kind === 'earnings' && r1.dir === 'up' && /keywords/.test(r1.how.kind) && r1.jevMode === 'off', `Jev off: keywords classify (earnings, up; ${r1.how.kind})`);
const B = daily('AAPL', 0).map(b => ({ ...b, d: nyDay(b.t) })), days = B.map(b => b.d);
const e0 = r1.events.find(e => e.done), D = days.findIndex(d => d > e0.day);
const want = (B[D + 4].c / B[D - 1].c - 1) * 100;
ok(e0.session === days[D] && Math.abs(e0.movePct - want) < 0.01 && Math.abs(e0.dayPct - (B[D].c / B[D - 1].c - 1) * 100) < 0.01, `after-close report is measured from the next session (${e0.day} -> ${e0.session}, 5-day ${e0.movePct}% = ${want.toFixed(2)}%)`);
ok(r1.counted >= 6 && r1.stats.move.n === r1.counted && r1.band.src.includes('past events') && r1.stats.runup.n === r1.counted, `stats over ${r1.counted} finished events (median ${r1.stats.move.median}%, range ${r1.stats.move.p10}% to ${r1.stats.move.p90}%)`);
const s = r1.swing;
ok(s && s.dir === 'long' && Math.abs(s.stop - (s.px - 1.5 * s.atr)) < 0.02 && s.target > s.px && Math.abs(s.rr - (s.target - s.px) / (1.5 * s.atr)) < 0.02, `swing plan: stop 1.5 ATR, target from the history, reward/risk ${s?.rr}`);
ok(r1.options?.strikes?.every(x => Number.isInteger(x.pastCleared) && x.pastN === r1.counted) && r1.options.strikes[2].pastCleared <= r1.options.strikes[0].pastCleared, `long calls show how many past events cleared each breakeven (${r1.options?.strikes?.map(x => `${x.k}: ${x.pastCleared}/${x.pastN}`).join(', ')})`);
ok(r1.implied?.pct > 0 && typeof r1.normal.hPct === 'number', `implied move ±${r1.implied?.pct}% next to the normal 5-day move ±${r1.normal.hPct}%`);

// ---- 5. product launch: SEC full-text + headlines, filters ----
const at = (d, h) => new Date(Date.parse(day(d) + 'T00:00:00Z') + h * 36e5).toISOString();
M.catNews = [
  { id: 1, headline: 'Apple unveils new iPhone lineup at fall event', created_at: at(380, 17), symbols: ['AAPL'] },
  { id: 2, headline: 'Apple launches Vision headset in new markets', created_at: at(300, 14), symbols: ['AAPL'] },
  { id: 3, headline: 'Apple rolls out new AI features', created_at: at(299, 14), symbols: ['AAPL'] },       // same cluster as #2
  { id: 4, headline: 'Tech giants launch new chips', created_at: at(250, 14), symbols: ['AAPL', 'MSFT', 'NVDA', 'AMD', 'INTC'] }, // many stocks: skipped
  { id: 5, headline: 'Apple introduces new Mac lineup', created_at: at(131, 14), symbols: ['AAPL'] },        // earnings week (report day 131): left out
  { id: 6, headline: 'Apple supplier news', created_at: at(220, 14), symbols: ['AAPL'] },                    // no launch words
  { id: 7, headline: 'Apple debuts new Watch glasses', created_at: at(160, 3), symbols: ['AAPL'] },
];
M.eftsHits = [{ q: '"launches"', date: day(420) }, { q: '"unveils"', date: day(222), items: ['2.02', '9.01'] }];
const r2 = await C.runScenario({ symbol: 'AAPL', text: 'Apple rumored to unveil smart glasses next week', kind: 'product', dir: 'up', date: day(-6), horizon: 5 });
const whats = r2.events.map(e => e.what).join(' | ');
ok(r2.kind === 'product' && r2.how.kind === 'you picked it' && r2.how.dir === 'you picked it', 'your picks override Jev and keywords');
ok(/unveils new iPhone/.test(whats) && /launches Vision/.test(whats) && !/rolls out/.test(whats) && !/Tech giants/.test(whats) && !/Mac lineup/.test(whats) && !/supplier/.test(whats), `headline matches: launch words, this stock only, one per cluster, not in earnings weeks (${r2.events.length} events: ${whats.slice(0, 160)}…)`);
ok(r2.clustered >= 1 && r2.earnWeek >= 1, `counted clusters (${r2.clustered}) and earnings-week events left out (${r2.earnWeek})`);
ok(/SEC 8-K/.test(whats) && r2.events.filter(e => e.src === 'SEC full-text search').length === 1 && M.efts.every(q => q.forms === '8-K' && q.ciks === '0000320193') && /test@example/.test(M.eftsUA), 'SEC full-text search: this company\'s 8-Ks, earnings releases (item 2.02) left out, SEC User-Agent sent');
ok(/★/.test(whats) && r2.events.find(e => /glasses/.test(e.what))?.what.startsWith('★'), 'headlines that also contain your own words are starred');
ok(r2.counted < 5 && r2.band.src.includes('normal volatility') && r2.warn.some(w => /Only \d+ past event/.test(w)), `few events: range from normal volatility, and it says so (${r2.band.lo}% to ${r2.band.hi}%)`);
ok(r2.future && r2.options?.exp >= day(-8) && r2.warn.some(w => /Earnings are estimated/.test(w)) === (E.next.inDays <= 6 + 5 + 3), 'future catalyst date: options expire after it; earnings inside the window are flagged');

// ---- 6. Jev classifies when it is on (mock answers the first choice with 60% of its answer) ----
process.env.TYPESAFE_API_KEY = 'test-key'; const before = jevCalls.length;
const r3 = await C.runScenario({ symbol: 'AAPL', text: 'something big is coming', horizon: 1 });
const sent = jevCalls[before];
ok(jevCalls.length === before + 1 && sent.questions.kind?.type === 'choice' && sent.questions.direction && sent.state.scenario === 'something big is coming' && sent.state.typical_daily_move_pct > 0, 'Jev gets the scenario text and 4 questions in the documented format');
ok(r3.kind === 'earnings' && r3.dir === 'up' && /Jev/.test(r3.how.kind) && r3.jev?.kindConf === 0.6, `Jev's answer is used (${r3.how.kind})`);
delete process.env.TYPESAFE_API_KEY;

// ---- 7. macro: past Fed days + FRED CPI dates ----
M.fredDates = [{ release_id: 10, date: day(100) }, { release_id: 10, date: day(130) }, { release_id: 10, date: day(160) }];
const r4 = await C.runScenario({ symbol: 'SPY', text: 'CPI comes in hot', horizon: 1 });
ok(r4.kind === 'macro' && r4.dir === 'down' && r4.events.every(e => /CPI/.test(e.what)) && r4.events.length === 3, `macro: CPI days from FRED (${r4.events.map(e => e.day).join(', ')})`);
const r5 = await C.runScenario({ symbol: 'SPY', text: 'Fed cuts rates', horizon: 1 });
ok(r5.events.some(e => /Fed decision/.test(e.what)) && r5.events.every(e => e.when === 'during session'), `Fed decisions: ${r5.events.length} past decision days in the price history`);

// ---- 8. bad input ----
let err = null; try { await C.runScenario({ symbol: 'BTC/USD', text: 'x' }); } catch (e) { err = e; }
ok(err?.code === 'bad_symbol' && /Stocks only/.test(err.message), 'crypto is refused: stocks only');

// ---- 9. log + grading ----
const log = JSON.parse(blob['catalyst/log-v1.json']);
ok(log.items.length === 5 && log.items[0].s === 'SPY' && log.items.every(x => x.band && !x.grade), `every scenario is saved for grading (${log.items.length})`);
const mk = (d, o, h, l, c) => ({ t: d + 'T05:00:00Z', o, h, l, c }); // Alpaca daily bars start at midnight ET (05:00 UTC in winter)
const bars = [mk('2026-01-05', 100, 101, 99, 100), mk('2026-01-06', 100, 104, 99.5, 103), mk('2026-01-07', 103, 106, 102, 105), mk('2026-01-08', 105, 106, 104, 105.5)];
const g1 = C.gradeOne({ at: '2026-01-05T15:00:00Z', px: 100, dir: 'up', horizon: 2, band: { lo: -3, hi: 4 }, swing: { stop: 97, target: 103.5 } }, bars);
ok(g1 && g1.movePct === 3 && g1.dirHit === true && g1.inBand === true && g1.swing === 'target' && g1.end === '2026-01-06', `graded after the holding period: +3%, right direction, inside the range, target hit first (${JSON.stringify(g1)})`);
const g2 = C.gradeOne({ at: '2026-01-04T15:00:00Z', date: '2026-01-07', px: 100, dir: 'down', horizon: 1, band: { lo: -2, hi: 2 }, swing: null }, bars);
ok(g2 && Math.abs(g2.movePct - (105 / 103 - 1) * 100) < 0.01 && g2.dirHit === false, 'future event date: measured from the close before it');
ok(C.gradeOne({ at: new Date().toISOString(), px: 100, dir: 'up', horizon: 5, band: { lo: -1, hi: 1 } }, bars) === null, 'not graded before the holding period is over');
const sc = C.scorecard([{ kind: 'earnings', grade: { dirHit: true, inBand: true, swing: 'target' } }, { kind: 'earnings', grade: { dirHit: false, inBand: false, swing: 'stop' } }, { kind: 'rumor', grade: null }]);
ok(sc.graded === 2 && sc.waiting === 1 && sc.rows[0].dirPct === 50 && sc.rows[0].bandPct === 50 && sc.rows[0].target === 1, 'scorecard by catalyst type');

// ---- 10. route ----
const RC = await import(T + 'routes/catalyst.js');
const locked = await RC.GET(new Request('http://x/api/catalyst'));
const lst = await (await RC.GET(new Request(`http://x/api/catalyst?k=${k}`))).json();
const run = await (await RC.GET(new Request(`http://x/api/catalyst?k=${k}&symbol=AAPL&text=${encodeURIComponent('FDA approval for new device')}&horizon=10`))).json();
const bad = await RC.GET(new Request(`http://x/api/catalyst?k=${k}&symbol=ETH/USD&text=x`));
ok(locked.status === 401 && Array.isArray(lst.items) && lst.score && lst.kinds.earnings && run.kind === 'regulatory' && run.horizon === 10 && bad.status === 400, `/api/catalyst: locked without passcode, log + scorecard, runs (${run.kindLabel}), rejects crypto`);
const rt = (await import('node:fs')).readFileSync(new URL('../api/router.js', import.meta.url), 'utf8');
ok(/catalyst/.test(rt) && /hist,/.test(rt), 'router serves /api/catalyst and /api/hist');
