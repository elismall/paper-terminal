// v0.12.2 crypto price history: the request pacer, the stored history (new candles + older chunks, no holes, time budget, a failed
// read never overwrites it), "proven" and the lab while history is still downloading, the background download job and its route.
import { blob, M } from './mock.mjs';
import { BAR_OPT } from './mockdata.mjs';
const T = new URL('../', import.meta.url).href;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
M.assets = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD', 'AVAX/USD', 'DOGE/USD', 'PEPE/USD'];
const core = await import(T + 'lib/core.js'), Hs = await import(T + 'lib/hist.js'), D = await import(T + 'lib/dca.js'), L = await import(T + 'lib/dcalab.js');
const k = core.tokenFor('pw'), DAY = 864e5, clearHist = () => { for (const key of Object.keys(blob)) if (key.startsWith('hist/')) delete blob[key]; };

// ---- 1. pacer: 2 requests a second by default, short bursts allowed ----
ok(core.PACE.perSec >= 1e5, 'tests run with pacing off (tests/mock.mjs)');
const saved = { ...core.PACE }; Object.assign(core.PACE, { perSec: 20, cap: 1, tokens: 0, t: Date.now() });
let t0 = Date.now(); for (let i = 0; i < 10; i++) await core.paced(); const took = Date.now() - t0;
Object.assign(core.PACE, saved);
ok(took >= 430 && took < 1500, `pacer spaces requests (10 requests at 20/s took ${took} ms)`);
const src = (await import('node:fs')).readFileSync(new URL('../lib/core.js', import.meta.url), 'utf8');
ok(/PACE = \{ cap: 30, perSec: 2,/.test(src), 'live pacing is 2 requests a second with bursts of 30 (under Alpaca\'s 200 a minute, shared with the bots)');

// ---- 2. stored history: first run downloads, second run only fetches new candles ----
BAR_OPT.limit = 170; BAR_OPT.calls = 0;
const syms = ['BTC/USD', 'ETH/USD', 'PEPE/USD'];
const direct = (await core.barRange('BTC/USD', { timeframe: '1Hour', start: Date.now() - 90 * DAY })).bars;
BAR_OPT.calls = 0;
const h1 = await Hs.histBars(syms, { timeframe: '1Hour', days: 90, budgetMs: 60e3 });
const calls1 = BAR_OPT.calls;
ok(h1.complete && h1.cov.every(c => c.complete && !c.error && c.back === 90) && Math.abs(h1.data['BTC/USD'].length - direct.length) <= 1,
  `cold run downloads the full 90 days for every coin (${h1.cov.map(c => `${c.s} ${c.bars} bars/${c.pages} pages`).join(', ')}; direct ${direct.length})`);
const f = JSON.parse(blob['hist/crypto-1Hour.json'] || '{}');
ok(h1.saved && f.v === 1 && f.coins?.['BTC/USD']?.dt?.length >= direct.length - 1 && !('v' in (f.coins['BTC/USD'] || {})), `saved once to hist/crypto-1Hour.json in compact form (${Math.round((blob['hist/crypto-1Hour.json'] || '').length / 1024)} KB for 3 coins x 90 days)`);
const stat = JSON.parse(blob['hist/status.json'] || '{}')['1Hour-90d'];
ok(stat && stat.coins === 3 && stat.complete === 3, `status file records the window as complete (${JSON.stringify(stat && { coins: stat.coins, complete: stat.complete })})`);
BAR_OPT.calls = 0;
const h2 = await Hs.histBars(syms, { timeframe: '1Hour', days: 90, budgetMs: 60e3 });
ok(BAR_OPT.calls <= syms.length && h2.complete && h2.data['BTC/USD'].length === h1.data['BTC/USD'].length, `second run only asks for new candles (${BAR_OPT.calls} requests vs ${calls1} the first time)`);
ok(!h2.saved && h2.statusEntry === null, 'nothing new but candles: no Blob put (saved every 3 days at most; the next run re-fetches them cheaply)');
const a1 = h1.data['PEPE/USD'].slice(-50), a2 = h2.data['PEPE/USD'].slice(-50), relErr = Math.max(...a1.map((b, i) => Math.abs(a2[i].c / b.c - 1)));
ok(a1.length === 50 && relErr < 1e-6 && a2.at(-1).c > 0 && a2.at(-1).c < 0.001, `sub-cent meme prices survive storage (7 significant digits; largest difference ${relErr.toExponential(1)})`);

// ---- 3. time budget: partial history, then completed later with no holes ----
clearHist(); BAR_OPT.calls = 0;
const p1 = await Hs.histBars(syms, { timeframe: '1Hour', days: 200, budgetMs: 0 });
ok(!p1.complete && p1.cov.every(c => !c.complete && c.back >= 29 && c.back <= 31 && c.want === 200) && p1.saved, `out of time: keeps the newest ~30 days per coin and says so (${p1.cov.map(c => `${c.s} ${c.back}/${c.want} days`).join(', ')})`);
const p2 = await Hs.histBars(syms, { timeframe: '1Hour', days: 200, budgetMs: 60e3 });
const gaps = (a) => { let g = 0; for (let i = 1; i < a.length; i++) g = Math.max(g, Date.parse(a[i].t) - Date.parse(a[i - 1].t)); return g / 36e5; };
ok(p2.complete && p2.cov.every(c => c.back === 200) && gaps(p2.data['ETH/USD']) === 1 && p2.data['ETH/USD'].length >= 200 * 24 - 2, `next run fills the rest backwards with no holes (ETH ${p2.data['ETH/USD'].length} hourly bars, largest gap ${gaps(p2.data['ETH/USD'])} h)`);

// ---- 4. a failed read never overwrites the stored history ----
const before = blob['hist/crypto-1Hour.json']; M.histReadFail = true;
const r3 = await Hs.histBars(syms, { timeframe: '1Hour', days: 200, budgetMs: 5e3 });
M.histReadFail = false;
ok(!r3.saved && /503/.test(r3.readError || '') && blob['hist/crypto-1Hour.json'] === before, `store read failed: nothing saved over the stored history (${r3.readError})`);

// ---- 5. crypto bars() fails only when every coin fails ----
BAR_OPT.fail['DOT/USD'] = 500;
const part = await core.bars(['DOT/USD', 'BTC/USD'], { timeframe: '1Day', days: 30 });
let threw = false; try { await core.bars(['DOT/USD'], { timeframe: '1Day', days: 30 }); } catch { threw = true; }
BAR_OPT.fail = {};
ok(part['BTC/USD']?.length > 20 && !part['DOT/USD'] && threw, 'one coin failing leaves it out; all failing throws');

// ---- 6. training while history is still downloading: never "proven" ----
clearHist(); delete blob[D.TRAIN_KEY]; BAR_OPT.limit = 0; D.DCA.histMs = 0;
const tr = await D.trainMarket('crypto');
ok(tr.proven === false && /still downloading/.test(tr.provenWhy) && tr.histComplete === false && tr.coverage.some(c => c.complete === false), `partial history: not proven, says why ("${tr.provenWhy}")`);
D.DCA.histMs = 90e3;
const tr2 = await D.trainMarket('crypto');
ok(tr2.histComplete === true && !/still downloading/.test(tr2.provenWhy) && tr2.coverage.every(c => c.complete), `complete history: judged normally ("${tr2.provenWhy}")`);
ok(D.TRAIN_KEY === 'dca/train-v6.json', 'new training key (v6: 3 dip buys, 15% first buy, 0.5% minimum), so older trainings are not reused');

// ---- 7. the lab: runs on partial history are shown but not used by the bot ----
clearHist(); L.LAB.budgetMs = 0; D.resetLab();
const lab = await L.runLab({ days: 120, timeframe: '4Hour' });
D.resetLab();
const used = await D.labLatest({ fresh: true }), shown = await D.labLatest({ fresh: true, any: true });
ok(lab.v === 3 && lab.partial === true && used === null && shown?.partial === true, 'partial lab run: saved and shown (any), not used by the bot');
blob[D.LAB_KEY] = JSON.stringify({ ...lab, v: 1, partial: false }); D.resetLab();
ok(await D.labLatest({ fresh: true }) === null && (await D.labLatest({ fresh: true, any: true }))?.v === 1, 'lab runs from before the fix (v1) are ignored by the bot');
L.LAB.budgetMs = 150e3; D.resetLab();
const lab2 = await L.runLab({ days: 120, timeframe: '4Hour' }); D.resetLab();
ok(lab2.partial === false && (await D.labLatest({ fresh: true }))?.at === lab2.at, 'complete lab run is used by the bot');
ok(L.labSummary(lab).partial === true && L.labSummary(lab2).v === 3, 'lab summary reports version and partial');

// ---- 8. background download job + route ----
clearHist();
const j1 = await L.histFill({ budgetMs: 200e3 });
ok(j1.done && j1.jobs.length === 3 && j1.jobs.every(x => x.complete === x.coins), `download job completes every file (${j1.jobs.map(x => `${x.tf} ${x.complete}/${x.coins} coins, ${x.pages} pages`).join('; ')})`);
BAR_OPT.calls = 0;
const j2 = await L.histFill({ budgetMs: 200e3 });
ok(j2.jobs.every(x => x.skipped === 'already complete') && BAR_OPT.calls === 0, `once complete the job stops after one small status read (${BAR_OPT.calls} bar requests)`);
const R = await import(T + 'routes/hist.js');
const locked = await R.GET(new Request('http://x/api/hist'));
const st = await (await R.GET(new Request(`http://x/api/hist?k=${k}`))).json();
const cron = await (await R.GET(new Request('http://x/api/hist', { headers: { authorization: 'Bearer cs' } }))).json();
ok(locked.status === 401 && st.status?.['1Hour-365d'] && cron.jobs?.length === 3, '/api/hist: locked without passcode, status with it, the cron runs the job');
const vj = JSON.parse((await import('node:fs')).readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const hc = vj.crons.filter(c => c.path === '/api/hist');
ok(hc.length === 6 && hc.every(c => /^\d+ \d+ \* \* \*$/.test(c.schedule)) && vj.crons.length <= 100, `6 daily /api/hist cron jobs (Hobby: once a day each, 100 max; ${vj.crons.length} in total)`);
const hj = await (await (await import(T + 'routes/health.js')).GET(new Request('http://x/api/health?probe=hist'))).json();
ok(hj.hist?.jobs?.length === 3, 'health probe=hist runs the job (reports per file)');

// ---- v0.13.1: two runs saving the same file at once (background download + training) keep each other's progress ----
clearHist();
const [ra, rb] = await Promise.all([Hs.histBars(['BTC/USD'], { timeframe: '4Hour', days: 30, budgetMs: 60e3 }), Hs.histBars(['BTC/USD', 'ETH/USD'], { timeframe: '4Hour', days: 120, budgetMs: 60e3 })]);
const fr = JSON.parse(blob['hist/crypto-4Hour.json'] || '{}'), fb = fr.coins?.['BTC/USD'], fe = fr.coins?.['ETH/USD'];
ok(ra.saved && rb.saved && fb && fe && fb.from <= Date.now() - 119 * DAY && fe.from <= Date.now() - 119 * DAY,
  `concurrent saves: the later save keeps the other run's history (BTC back ${fb ? Math.round((Date.now() - fb.from) / DAY) : 0} days, ETH ${fe ? 'kept' : 'LOST'})`);
const rc3 = await Hs.histBars(["BTC/USD", "ETH/USD"], { timeframe: "4Hour", days: 120, budgetMs: 60e3, save: false });
ok(rc3.complete, 'after both saves, the 120-day window is complete for both coins (no hole, nothing re-downloaded)');
