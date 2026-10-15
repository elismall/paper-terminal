// UI check v0.12.0: the DCA tab (key D): deal cards with the dip-buy ladder, resting orders, DCA-only activity with cents, closed
// deals, the $100 plan, the DCA lab + bull-run line; the cleanup (Home, Swing, Account, Benchmark); and the live chart drawer
// (re-pulls with live=1, keeps the same chart, price updates). At 3 widths.
import { createRequire } from 'module'; const require = createRequire(import.meta.url);
const BASE = process.env.TB_URL || 'http://localhost:8767/';   // serve the project root first: python -m http.server 8767
const { chromium } = require('playwright'); const fs = require('fs');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const rd = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const lab = rd('fx-dcalab.json'), perf = rd('fx-perf.json'), hist = rd('fx-history.json'), train = rd('fx-dca.json');
perf.dcaSignals = { mode: 'shadow', n: 5, rows: [['Funding normal', 3, 66.7, 4.1, 12.3], ['Funding hot (20–50%/yr)', 1, 100, 6, 6], ['Funding very hot (50%+/yr)', 1, 0, -30, -30], ['Funding negative', 0], ['Money conditions easing', 4, 75, 2, 8], ['Money conditions mixed', 1, 0, -11.7, -11.7], ['Money conditions tightening', 0]].map(([label, n, win, avg, realized]) => ({ label, n, win, avg, realized: realized || 0 })) };
const { trainingSummary } = await import(new URL('../lib/dca.js', import.meta.url).href);
const bv = rd('fx-botview.json'); bv.dca.bull = lab.bull; bv.dca.training = trainingSummary(train);
const t0 = new Date(Date.now() - 36e5).toISOString();
bv.events.unshift({ t: t0, type: 'target', s: 'ADA/USD', qty: 135.83, px: 0.2455, pnl: 0.31, bot: 'DCA', entry: 0.24324, text: 'DCA trailing take profit: sold 135.83 ADA/USD @ 0.2455' });
// chart: 300 one-minute candles; every live request moves the last price up by 10
let price = 60000, liveHits = 0;
const mk = () => { const t0 = Date.now() - 300 * 6e4; return Array.from({ length: 300 }, (_, i) => { const c = 60000 + Math.sin(i / 9) * 150 + i; return { t: new Date(t0 + i * 6e4).toISOString(), o: c - 5, h: c + 20, l: c - 20, c, v: 5 }; }); };
const barsJ = (live) => { if (live) { liveHits++; price += 10; } const b = mk(); b[b.length - 1].c = price; return { s: 'BTC/USD', tf: '1Min', range: 'M1', from: b[150].t, intraday: true, bars: b, quote: { p: price, chg: price - 59000, pct: price / 59000 - 1, o: 59000, h: price, l: 58000 }, stats: {}, at: new Date().toISOString() }; };
const R = { health: { ok: true, alpaca: true, locked: true, authorized: true, cron: true, cryptoSwing: false, version: '0.13.2' }, dcalab: lab, performance: perf, history: hist, benchmark: { dca: train }, botview: bv,
  quotes: { quotes: {}, groups: { indices: [], sectors: [], crypto: [], cross: [] }, at: new Date().toISOString() }, account: { account: { equity: 1e5, last: 1e5, cash: 5e4, bp: 1e5 }, positions: [], open: [], orders: [] } };
const overlaps = (sel) => ({ sel, js: `(() => { const out = []; const hit = (a, z) => a.left < z.right - 1 && z.left < a.right - 1 && a.top < z.bottom - 1 && z.top < a.bottom - 1;
  document.querySelectorAll(${JSON.stringify(sel)}).forEach((el, i) => { const k = [...el.children].filter(c => getComputedStyle(c).display !== 'inline').map(c => c.getBoundingClientRect()).filter(r => r.width && r.height); for (let a = 0; a < k.length; a++) for (let z = a + 1; z < k.length; z++) if (hit(k[a], k[z])) out.push(el.className + ' ' + i); if (el.scrollWidth > el.clientWidth + 2) out.push('overflow ' + el.className + ' ' + i); });
  return out; })()` });
const b = await chromium.launch(); const errs = [];
for (const [w, h, tag] of [[1400, 1000, 'desk'], [390, 844, 'phone'], [320, 700, 'small']]) {
  const p = await b.newPage({ viewport: { width: w, height: h } }); liveHits = 0;
  p.on('pageerror', e => errs.push(tag + ' ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_FAILED|404/.test(m.text())) errs.push(tag + ' ' + m.text()); });
  await p.route('**/api/**', r => { const u = new URL(r.request().url()), k = u.pathname.split('/').pop(); const body = k === 'bars' ? barsJ(u.searchParams.get('live') === '1') : R[k] || { error: 'x', message: 'no fixture ' + k }; r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) }); });
  await p.route('https://fonts.**', r => r.abort());
  await p.addInitScript(() => { localStorage.setItem('tb.token', '"abc"'); localStorage.removeItem('tb.deepOpen'); });
  // ---- DCA tab via the D key ----
  await p.goto(BASE + 'index.html#home'); await p.waitForTimeout(800);
  ok(await p.evaluate(() => [...document.querySelectorAll('nav.tabs button')].some(b => b.dataset.tab === 'dca' && /D\)DCA/.test(b.textContent))), `${tag} nav has "D) DCA" next to Bot`);
  await p.keyboard.press('d'); await p.waitForTimeout(1500);
  ok(await p.evaluate(() => location.hash === '#dca' && !!document.querySelector('#dcaroot')), `${tag} the D key opens the DCA tab`);
  const d = await p.evaluate(() => ({ cards: document.querySelectorAll('#dca-cards .btc').length, ladder: document.querySelector('#dca-cards .btwhy')?.textContent || '', rest: document.querySelectorAll('#dt-rest tbody tr').length, restTxt: document.querySelector('#dt-rest')?.textContent || '',
    feed: document.querySelector('#dt-feed')?.textContent || '', feedNonDca: [...document.querySelectorAll('#dt-feed li b')].some(x => /^(Target hit|Bot sent|Filled)/.test(x.textContent)), closed: document.querySelectorAll('#dt-closed tbody tr').length,
    top: document.querySelector('#dca-top')?.textContent || '', ctl: document.querySelector('#dt-ctl')?.textContent || '' }));
  ok(d.cards === bv.dca.deals.length && /The ladder/.test(d.ladder) && /#1 ·/.test(d.ladder), `${tag} deal cards with the full dip-buy ladder (${d.cards})`);
  const want = bv.dca.deals.reduce((a, x) => a + x.levels.filter(L => !L.filled).length + 1 + (x.exitPx ? 1 : 0), 0);
  ok(d.rest === want && /Dip #\d/.test(d.restTxt) && /(Take profit|Trail)/.test(d.restTxt) && /RESTING|NEXT/.test(d.restTxt), `${tag} resting orders: every unfilled dip buy + take profit + hard exit (${d.rest} rows)`);
  ok(/\$0\.31/.test(d.feed) && /\+0\.9\d%/.test(d.feed) && !d.feedNonDca, `${tag} DCA activity only, with cents: "$0.31 +0.93%" for the small ADA take profit`);
  ok(d.closed === perf.compare.deals.length && /Bull-run mode ON/.test(d.top) && /Run DCA now/.test(d.ctl), `${tag} closed deals (${d.closed}), rules with the bull-run line, Run DCA now`);
  const sm = await p.evaluate(() => { const el = document.querySelector('#dt-small'); return { txt: el?.textContent.replace(/\s+/g, ' ') || '', boxes: el?.querySelectorAll('.vbox').length, rows: el?.querySelectorAll('tbody tr').length }; });
  ok(sm.boxes === 2 && /CONCENTRATED DCA/.test(sm.txt) && /MOMENTUM/.test(sm.txt) && /Vault/.test(sm.txt) && /75% of every profit/.test(sm.txt) && /under \$60/.test(sm.txt) && /Last third \(unseen\)/.test(sm.txt) && /Hold BTC/.test(sm.txt), `${tag} $100 plan: two virtual accounts (value, vault, open positions) + backtest vs holding BTC`);
  const boxes = await p.$$eval('#dt-lab .vbox b.h', x => x.map(e => e.textContent.trim()));
  ok(boxes.length === 4 && /WHICH COINS/.test(boxes[0]), `${tag} DCA lab on the DCA tab: 4 verdict boxes`);
  await p.click('#dt-lab [data-labcoins] summary'); await p.waitForTimeout(150);
  const bad = await p.evaluate(overlaps('.lab .row, .lab .vbox, .lab .verd, #dt-rest, #dcaroot .panel').js), ov = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(!bad.length && ov <= 0, `${tag} DCA tab layout: no overlaps ${JSON.stringify(bad.slice(0, 4))}, page overflow ${ov}`);
  try { await (await p.$('#dt-small')).screenshot({ path: `small-${tag}.png` }); await (await p.$('#dt-rest')).screenshot({ path: `rest-${tag}.png` }); } catch {}
  // ---- cleanup elsewhere ----
  await p.evaluate(() => go('home')); await p.waitForTimeout(500);
  const home = await p.$$eval('#main .panel .ph h2', x => x.map(e => e.textContent));
  ok(home.length === 7 && !home.some(t => /Crypto Monitor|Intraday|Option Ideas|Long-Term/.test(t)), `${tag} Home: 7 panels, one crypto board ${JSON.stringify(home)}`);
  await p.evaluate(() => go('swing')); await p.waitForTimeout(300);
  ok(await p.$$eval('#main .panel', x => x.length) === 1, `${tag} Swing: just the swing plays (no repeated indexes/industries)`);
  await p.evaluate(() => go('account')); await p.waitForTimeout(300);
  ok(!(await p.evaluate(() => /Paper bot/.test(document.querySelector('#main').textContent))), `${tag} Account: the old "Paper bot · moved" panel is gone`);
  await p.evaluate(() => { state.benchmark = { error: 'x', message: 'stock benchmark fixture not needed' }; go('perf'); }); await p.waitForTimeout(800);   // the fixture only has the DCA part of /api/benchmark
  const pf = await p.evaluate(() => ({ txt: document.querySelector('#main').textContent, deep: document.querySelector('details.deep')?.open, journalVisible: !!document.querySelector('details.deep') && document.querySelector('details.deep').open }));
  ok(!/Crypto DCA lab/.test(pf.txt) && !/DCA bot · training/.test(pf.txt) && !/AI second opinion \(Jev\) scorecard/.test(pf.txt) && !/Crypto · training/.test(pf.txt) && pf.deep === false && /Swing bots vs DCA bot/.test(pf.txt), `${tag} Benchmark: no lab / DCA training / Jev scorecard / crypto training; stock deep dive starts collapsed`);
  await p.click('details.deep > summary'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.querySelector('details.deep').open && [...document.querySelectorAll('details.deep .ph h2')].some(h => /Trade journal/.test(h.textContent)) && JSON.parse(localStorage.getItem('tb.deepOpen'))), `${tag} opening the deep dive shows the journal and is remembered`);
  // ---- live chart drawer ----
  await p.evaluate(() => { LS.set('range', 'M1'); openDetail('BTC/USD'); }); await p.waitForTimeout(1200);
  await p.evaluate(() => { const c = document.querySelector('#cvbox canvas'); c.dataset.mark = 'first'; });
  const p0 = await p.$eval('#drawer .dh .p', e => e.textContent);
  await p.waitForTimeout(11500);
  const same = await p.$eval('#cvbox canvas', c => c.dataset.mark === 'first'), p1 = await p.$eval('#drawer .dh .p', e => e.textContent), badge = await p.$eval('#d-live', e => e.textContent).catch(() => '');
  ok(liveHits >= 2 && same && p1 !== p0 && /live, every 5 s · \d{1,2}:\d\d:\d\d [AP]M ET/.test(badge), `${tag} open chart refreshes itself (${liveHits} live pulls in ~12 s), same chart kept, price ${p0} → ${p1}, badge "${badge.trim()}"`);
  await p.evaluate(() => { $('#detail').hidden = true; }); const hits = liveHits; await p.waitForTimeout(6000);
  ok(liveHits === hits, `${tag} closed drawer: no more pulls`);
  await p.close();
}
const realErrs = errs.filter(e => !/ERR_TUNNEL_CONNECTION_FAILED|ERR_FAILED/.test(e)); console.log((realErrs.length ? 'FAIL' : 'PASS') + ' no script errors on the page ' + JSON.stringify(realErrs)); await b.close();
