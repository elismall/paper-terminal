// UI check v0.11.0: News tab (Market Brief dropdown with gainer/decliner rows, sources, filters) and Benchmark daily history, at 3 widths
import { createRequire } from 'module'; const require = createRequire(import.meta.url);
const BASE = process.env.TB_URL || 'http://localhost:8767/';   // serve the project root first: python -m http.server 8767
const { chromium } = require('playwright'); const fs = require('fs');
const news = JSON.parse(fs.readFileSync('fx-news.json', 'utf8')), brief = JSON.parse(fs.readFileSync('fx-brief.json', 'utf8')), hist = JSON.parse(fs.readFileSync('fx-history.json', 'utf8')), perf = JSON.parse(fs.readFileSync('fx-perf.json', 'utf8'));
// make the brief look like a real day: price moves and a longer read
brief.movers.forEach((m, i) => { m.move = [4.2, -6.1, -1.3, 0.4][i] ?? 1; m.relVol = [2.3, 3.1, 1.1, 0.9][i] ?? 1; m.px = [231.4, 3.12, 88.2, 510][i] ?? 10; });
brief.calendar = { events: [{ d: new Date(Date.now() + 864e5).toISOString().slice(0, 10), name: 'CPI', time: '8:30 AM', top: true }, { d: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10), name: 'Retail sales', time: '8:30 AM', top: false }], error: null };
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const R = { health: { ok: true, alpaca: true, locked: true, authorized: true, cron: true, version: '0.13.2' }, news, brief, performance: perf, history: hist, benchmark: { error: 'x', message: 'benchmark fixture not needed' },
  quotes: { quotes: {}, groups: { indices: [], sectors: [], crypto: [], cross: [] }, at: new Date().toISOString() } };
const b = await chromium.launch(); const errs = [];
for (const [w, h, tag] of [[1400, 1000, 'desk'], [390, 844, 'phone'], [320, 700, 'small']]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  p.on('pageerror', e => errs.push(tag + ' ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_FAILED|404/.test(m.text())) errs.push(tag + ' ' + m.text()); });
  await p.route('**/api/**', r => { const k = new URL(r.request().url()).pathname.split('/').pop(); r.fulfill({ contentType: 'application/json', body: JSON.stringify(R[k] || { error: 'x', message: 'no fixture ' + k }) }); });
  await p.route('https://fonts.**', r => r.abort());
  await p.addInitScript(() => localStorage.setItem('tb.token', '"abc"'));
  await p.goto(BASE + 'index.html#news'); await p.waitForTimeout(1500);
  const check = async (name) => {
    const bad = await p.evaluate(() => { const out = []; const hit = (a, z) => a.left < z.right - 1 && z.left < a.right - 1 && a.top < z.bottom - 1 && z.top < a.bottom - 1;
      document.querySelectorAll('.bcard, .bcard header, .bline, .bhead, .bcal, .nwbar, .news li .m').forEach((el, i) => { const k = [...el.children].map(c => c.getBoundingClientRect()).filter(r => r.width && r.height); for (let a = 0; a < k.length; a++) for (let z = a + 1; z < k.length; z++) if (hit(k[a], k[z])) out.push(el.className + ' ' + i); if (el.scrollWidth > el.clientWidth + 2) out.push('overflow ' + el.className + ' ' + i); });
      return out; });
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    console.log((bad.length || ov > 0 ? 'FAIL ' : 'PASS ') + tag, name, 'overlaps', JSON.stringify(bad.slice(0, 6)), 'page overflow', ov);
  };
  const closedH = await p.$eval('.brief', e => e.getBoundingClientRect().height);
  ok(await p.$$eval('.bcard', x => x.length) === 0 && await p.$$eval('.bline', x => x.length) === 0 && closedH < 80, `${tag} brief starts closed: one line (${Math.round(closedH)} px) · ` + await p.$eval('.bhead', e => e.textContent.trim()));
  console.log(tag, 'headlines', await p.$$eval('.news li', x => x.length), 'source chips', await p.$$eval('[data-nwsrc]', x => x.length));
  await check('news (brief closed)');
  await p.click('.bhead'); await p.waitForTimeout(200);
  const grp = await p.$$eval('.bgrp .sub', x => x.map(e => e.textContent.trim()));
  ok(grp.some(t => /^Top Gainers/.test(t)) && grp.some(t => /^Top Decliners/.test(t)) && await p.$$eval('.bline', x => x.length) === brief.movers.length && await p.$$eval('.bcard', x => x.length) === 0, `${tag} open: rows only, split ${JSON.stringify(grp)}`);
  ok(await p.$$eval('.bline', x => x.every(e => e.getBoundingClientRect().height < 40)), `${tag} each brief row is a single line`);
  await check('brief open (rows)'); const br = await p.$('.brief'); if (br) await br.screenshot({ path: `brief-${tag}.png` });
  await p.click('.bline'); await p.waitForTimeout(200);
  ok(await p.$$eval('.bcard', x => x.length) === 1 && await p.$$eval('.brow.on', x => x.length) === 1, `${tag} clicking a row opens just that card`);
  await check('brief row expanded'); await (await p.$('.brief'))?.screenshot({ path: `brief-row-${tag}.png` });
  await p.evaluate(() => render()); await p.waitForTimeout(100);
  ok(await p.$$eval('.bcard', x => x.length) === 1, `${tag} open row survives the 30-second refresh`);
  await p.click('.brow.on .bline'); await p.click('.bhead'); await p.waitForTimeout(100);
  ok(await p.$$eval('.bline', x => x.length) === 0, `${tag} dropdown closes again`);
  await p.screenshot({ path: `news-${tag}.png`, fullPage: false });
  await p.click('[data-nwsrc="8k"]'); await p.waitForTimeout(200); console.log(tag, '8-K filter rows', await p.$$eval('.news li', x => x.length), 'all 8-K:', await p.$$eval('.news li .m', x => x.every(e => /SEC 8-K/.test(e.textContent))));
  await p.click('[data-nwsrc="all"]');
  await p.evaluate(() => go('perf')); await p.waitForTimeout(1500);
  console.log(tag, 'history rows', await p.$$eval('[data-hist]', x => x.length) ? await p.evaluate(() => [...document.querySelectorAll('table')].find(t => /Day \(ET\)/.test(t.textContent))?.querySelectorAll('tbody tr').length) : 'no panel');
  const ov2 = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); console.log((ov2 > 0 ? 'FAIL ' : 'PASS ') + tag, 'Benchmark page overflow', ov2);
  const hp = await p.evaluateHandle(() => [...document.querySelectorAll('.sub')].find(e => /Daily scoreboard/.test(e.textContent))?.parentElement); try { await hp.asElement()?.screenshot({ path: `hist-${tag}.png` }); } catch {}
  await p.close();
}
const realErrs = errs.filter(e => !/ERR_TUNNEL_CONNECTION_FAILED|ERR_FAILED/.test(e)); console.log((realErrs.length ? 'FAIL' : 'PASS') + ' no script errors on the page ' + JSON.stringify(realErrs)); await b.close();
