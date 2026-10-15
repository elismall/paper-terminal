// UI check v0.13.0: the Options tab (key 5): the Catalyst Scenario panel (form, answer boxes, strikes with "past events cleared",
// saved scenarios + scorecard), long call ideas with the earnings flag, and that a data refresh never wipes what you typed. At 3 widths.
import { createRequire } from 'module'; const require = createRequire(import.meta.url);
const BASE = process.env.TB_URL || 'http://localhost:8767/';   // serve the project root first: python -m http.server 8767
const { chromium } = require('playwright'); const fs = require('fs');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const rd = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const cat = rd('fx-catalyst.json'), call = rd('fx-optcall.json');
const R = { health: { ok: true, alpaca: true, locked: true, authorized: true, cron: true, version: '0.13.2' }, swing: { plays: [], scanned: 0, at: new Date().toISOString() }, longterm: { picks: [], at: new Date().toISOString() },
  quotes: { quotes: {}, groups: { indices: [], sectors: [], crypto: [], cross: [] }, at: new Date().toISOString() } };
const b = await chromium.launch(); const errs = [];
for (const [w, h, tag] of [[1400, 1000, 'desk'], [390, 844, 'phone'], [320, 700, 'small']]) {
  const p = await b.newPage({ viewport: { width: w, height: h } }); let runs = 0, lastQ = null;
  p.on('pageerror', e => errs.push(tag + ' ' + e.message)); p.on('requestfailed', q => { if (!/fonts\./.test(q.url())) errs.push(tag + ' request failed ' + q.url()); }); p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_FAILED|ERR_TUNNEL|404/.test(m.text())) errs.push(tag + ' ' + m.text()); });
  await p.route('**/api/**', r => { const u = new URL(r.request().url()), k = u.pathname.split('/').pop();
    let body = R[k] || { error: 'x', message: 'no fixture ' + k };
    if (k === 'catalyst') { if (u.searchParams.get('symbol')) { runs++; lastQ = Object.fromEntries(u.searchParams); body = cat.run; } else body = cat.list; }
    if (k === 'options') body = u.searchParams.get('strategy') === 'call' ? call : { s: 'AAPL', px: 100, idea: null, message: 'none' };
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) }); });
  await p.route('https://fonts.**', r => r.abort());
  await p.addInitScript(() => { localStorage.setItem('tb.token', '"abc"'); localStorage.removeItem('tb.catRes'); localStorage.removeItem('tb.catForm'); localStorage.removeItem('tb.optCache'); });
  await p.goto(BASE + 'index.html#home'); await p.waitForTimeout(700);
  await p.keyboard.press('5'); await p.waitForTimeout(1200);
  ok(await p.evaluate(() => location.hash === '#options' && !!document.querySelector('#p-ca #catform') && !!document.querySelector('#p-op #optform')), `${tag} Options tab: Catalyst scenario panel above Option ideas`);
  ok(await p.evaluate(() => /saved here and graded|Saved scenarios/.test(document.querySelector('#ca-log')?.textContent || '')), `${tag} saved scenarios list loads`);
  // type, then force a data refresh: the draft must survive
  await p.fill('#ca-sym', 'aapl'); await p.fill('#ca-text', 'Apple beats earnings and raises guidance'); await p.selectOption('#ca-h', '5');
  await p.evaluate(() => { state.swing = { plays: [], scanned: 1, at: new Date().toISOString() }; render(); });
  ok(await p.evaluate(() => document.querySelector('#ca-text').value === 'Apple beats earnings and raises guidance' && document.querySelector('#ca-sym').value.toUpperCase() === 'AAPL'), `${tag} a refresh keeps what you typed`);
  await p.click('#ca-go'); await p.waitForTimeout(900);
  const r = await p.evaluate(() => ({ boxes: document.querySelectorAll('#ca-res .box').length, txt: document.querySelector('#ca-res')?.textContent || '', strikes: document.querySelectorAll('#ca-res .box table').length ? [...document.querySelectorAll('#ca-res .box')].find(b => /LONG CALL/.test(b.textContent))?.querySelectorAll('tbody tr').length : 0,
    cleared: /Past events cleared/.test(document.querySelector('#ca-res')?.textContent || ''), buy: document.querySelectorAll('#ca-res [data-ticket]').length, ev: document.querySelectorAll('#ca-res details tbody tr').length }));
  ok(runs === 1 && lastQ.symbol === 'AAPL' && lastQ.horizon === '5' && /raises guidance/.test(lastQ.text), `${tag} Run sends the scenario (${JSON.stringify(lastQ && { symbol: lastQ.symbol, horizon: lastQ.horizon })})`);
  ok(r.boxes === 3 && /PAST EVENTS LIKE THIS \(8/.test(r.txt) && /SWING PLAN \(LONG\)/.test(r.txt) && r.strikes === 3 && r.cleared && r.buy === 4, `${tag} answer: history, swing plan, 3 long-call strikes with past events cleared, 4 trade buttons (${r.boxes} boxes, ${r.strikes} strikes, ${r.buy} buttons)`);
  ok(r.ev === cat.run.events.length && /options price in ±/.test(r.txt) && /Graded range/.test(r.txt), `${tag} past events table (${r.ev}), implied move, graded range`);
  await p.click('#ca-log summary'); await p.waitForTimeout(200);
  const lg = await p.evaluate(() => ({ rows: document.querySelectorAll('#ca-log tbody tr').length, txt: document.querySelector('#ca-log')?.textContent || '' }));
  ok(/Scorecard by type/.test(lg.txt) && /✓ direction/.test(lg.txt) && /✗ direction/.test(lg.txt) && /waiting/.test(lg.txt), `${tag} saved scenarios with grades and a scorecard (${lg.rows} rows)`);
  // long call idea from the Option ideas form
  await p.selectOption('#o-dir', 'call'); await p.fill('#o-sym', 'AAPL'); await p.click('#optform button'); await p.waitForTimeout(700);
  const oc = await p.evaluate(() => ({ rows: document.querySelectorAll('#o-manual tbody tr').length, txt: document.querySelector('#o-manual')?.textContent || '' }));
  ok(oc.rows === 3 && /Long call/.test(oc.txt) && /Earnings expected about/.test(oc.txt) && /Decay\/day/.test(oc.txt), `${tag} long call idea: 3 strikes, earnings flag, decay per day`);
  const ov = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, panels: [...document.querySelectorAll('#optroot > section')].map(s => s.getBoundingClientRect().right) }));
  ok(ov.sw <= ov.cw + 1 && ov.panels.every(x => x <= ov.cw + 1), `${tag} no sideways page scroll (${ov.sw} vs ${ov.cw})`);
  await p.screenshot({ path: `opt-${tag}.png`, fullPage: true });
  await p.close();
}
ok(!errs.length, `no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
await b.close();
