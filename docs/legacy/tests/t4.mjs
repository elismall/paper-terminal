import { blob, posted, jevCalls, M } from './mock.mjs';
import { hourly } from './mockdata.mjs';
const T = new URL('../', import.meta.url).href;
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
process.env.TYPESAFE_API_KEY = 'test-key';
const { tokenFor } = await import(T + 'lib/core.js'); const k = tokenFor('pw');
const J = await import(T + 'lib/jev.js');
// probe
let pr = await J.jevProbe(); ok(pr.ok && pr.q === 2.4 && pr.ext === 0.35 && pr.trend === 2.4, 'probe uses the documented request format: ' + JSON.stringify(pr));
const body = jevCalls.at(-1); ok(Object.keys(body.questions).length === 7 && JSON.stringify(body.state).length < 1800, `entry battery: 7 questions, state ${JSON.stringify(body.state).length} chars`);
// gap check (forced): AAPL gaps down through its stop, NVDA gaps up 3 ATR
const px = (s) => hourly(s, 0).at(-1).c;
M.gapPx = { AAPL: px('AAPL') * 0.80, NVDA: px('NVDA') * 1.08 };
const gp = await import(T + 'lib/gap.js');
let g = await gp.gapCheck({ force: true });
console.log('gap checked', g.checked, 'of', g.of, 'movers', g.movers, 'skip', Object.keys(g.skip).length, JSON.stringify(g.holdings.find(h => h.s === 'AAPL')));
ok(g.skip.NVDA && /gapped up/.test(g.skip.NVDA), 'NVDA gap-up on the skip list: ' + g.skip.NVDA);
ok(g.skip.AAPL && g.movers.includes('AAPL'), 'AAPL gap-down alerted + skipped');
ok(Object.keys(blob).some(x => x.startsWith('gap/')), 'saved to Blob');
g = await gp.gapCheck({}); ok(g.skipped, 'unforced run outside 8:00-9:25 ET stands down: ' + g.skipped);
// stock run in dry mode uses the skip list
M.clockOpen = true;
const bot = await import(T + 'routes/bot.js');
let r = await bot.GET(new Request(`http://x/api/bot?k=${k}&dry=1&only=stocks`)); let j = await r.json();
ok(!j.error, 'dry stock run ok ' + (j.error ? JSON.stringify(j) : ''));
ok((j.skipped || []).some(s => /pre-market/.test(s.why)), 'stock entries list pre-market skips: ' + JSON.stringify((j.skipped || []).filter(s => /pre-market/.test(s.why)).slice(0, 2)));
// hold review on a real (non-dry) crypto run
for (const kk of Object.keys(blob)) if (kk.startsWith('control/lock-')) delete blob[kk];
jevCalls.length = 0;
r = await bot.GET(new Request(`http://x/api/bot?k=${k}&run=1&only=crypto`)); j = await r.json();
ok(j.review && j.review.asked >= 1 && !j.review.failed, 'hold review ran: ' + JSON.stringify(j.review));
const rev = JSON.parse(blob['jev/review.json'] || '{}'); ok(Object.values(rev.items || {}).some(x => x.hold === 2.4 && x.cont != null), 'review saved: ' + JSON.stringify(Object.values(rev.items || {})[0]));
const rq = jevCalls.find(c => c.questions.hold); ok(rq && rq.state.position && rq.state.chart?.last_candle, 'review state has position + chart: ' + JSON.stringify(rq?.state).slice(0, 300));
// botview shows AI view; control shows gap + review
const bv = await import(T + 'routes/botview.js'); j = await (await bv.GET(new Request(`http://x/api/botview?k=${k}`))).json();
ok(j.trades.some(t => t.ai?.hold != null), 'botview trade cards carry the AI view: ' + j.trades.filter(t => t.ai).map(t => t.s));
const ctl = await import(T + 'routes/control.js'); j = await (await ctl.GET(new Request(`http://x/api/control?k=${k}`))).json();
ok(j.gap?.day && j.review?.n >= 1, 'control has gap + review: ' + JSON.stringify({ gap: j.gap?.movers, review: j.review }));
const gr = await import(T + 'routes/gapcheck.js'); j = await (await gr.GET(new Request(`http://x/api/gapcheck`))).json(); ok(j.error === 'locked', 'gapcheck locked without passcode');
j = await (await gr.GET(new Request(`http://x/api/gapcheck?k=${k}`))).json(); ok(j.gap?.day, 'gapcheck GET returns today without re-running');
const h = await import(T + 'routes/health.js'); j = await (await h.GET(new Request('http://x/api/health?probe=jev'))).json(); ok(j.jevProbe?.ok, 'health probe=jev');
// tag format end-to-end
ok(J.jevOf('tbbot-20260926-AAPL-pullback-sc70-h10-s190-j24e3r1d2') === 2.4, 'new tag parses');
const perf = await import(T + 'routes/performance.js'); j = await (await perf.GET(new Request(`http://x/api/performance?k=${k}`))).json();
ok(j.jev?.flags?.length === 2, 'scorecard flags: ' + JSON.stringify(j.jev?.flags?.map(f => [f.label, f.n])));

import('fs').then(fs => { fs.writeFileSync('fx-control.json', JSON.stringify(j)); });
