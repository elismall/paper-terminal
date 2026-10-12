import { createRequire } from 'module'; const require = createRequire(import.meta.url);
const BASE = process.env.TB_URL || 'http://localhost:8767/';   // serve the project root first: python -m http.server 8767
const { chromium } = require('playwright'); const fs = require('fs');
const jv = JSON.parse(fs.readFileSync('fx-jev.json', 'utf8')), ask = JSON.parse(fs.readFileSync('fx-jevask.json', 'utf8'));
ask.rules = { setup: 'Pullback', dir: 'long', score: 72, why: ['uptrend: price > 50d > 200d', 'RSI cooled to 44'] };
jv.log.unshift({ t: new Date().toISOString(), kind: 'entry', s: 'NVDA', state: ask.state, a: { q: 2.1, conf: .72, trend: 2.6, regime: 'trending', ext: .41, rev: .18, vol: .66, down: .2 }, did: 'bought' },
  { t: new Date().toISOString(), kind: 'entry', s: 'SMCI', state: ask.state, a: { q: .7, conf: .8, trend: 1.1, regime: 'choppy', ext: .78, rev: .72, vol: .3, down: .6 }, did: 'passed: already up more than 0.75 ATR since yesterday\'s close' });
const perf = JSON.parse(fs.readFileSync('fx-control.json', 'utf8'));
perf.jev = { status: { key: true, mode: 'shadow' }, n: 0, buckets: [], flags: [] };
const R = { health: { ok: true, alpaca: true, locked: true, authorized: true, cron: true }, jev: jv, performance: perf, quotes: { quotes: {}, groups: { indices: [], sectors: [], crypto: [], cross: [] }, at: new Date().toISOString() } };
const b = await chromium.launch(); const errs = [];
for (const [w, h, tag] of [[1400, 1000, 'desk'], [390, 844, 'phone']]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  p.on('pageerror', e => errs.push(tag + ' ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/TUNNEL/.test(m.text())) errs.push(tag + ' ' + m.text()); });
  await p.route('**/api/**', r => { const u = new URL(r.request().url()); const k = u.pathname.split('/').pop(); r.fulfill({ contentType: 'application/json', body: JSON.stringify(k === 'jev' && u.searchParams.get('symbol') ? ask : R[k] || { error: 'x', message: 'no fixture ' + k }) }); });
  await p.route('https://fonts.**', r => r.abort());
  await p.addInitScript(() => localStorage.setItem('tb.token', '"abc"'));
  await p.goto(BASE + 'index.html#jev'); await p.waitForTimeout(1500);
  await p.click('#jv-go'); await p.waitForTimeout(600);
  await p.click('[data-jvrow="0"]'); await p.waitForTimeout(300);
  await p.screenshot({ path: `jev-${tag}.png`, fullPage: true });
  { const o = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); console.log((o > 0 ? 'FAIL ' : 'PASS ') + tag, 'Jev tab page overflow', o, 'tab label', await p.textContent('[data-tab="jev"]')); }
  await p.close();
}
const realErrs = errs.filter(e => !/ERR_TUNNEL_CONNECTION_FAILED|ERR_FAILED/.test(e)); console.log((realErrs.length ? 'FAIL' : 'PASS') + ' no script errors on the page ' + JSON.stringify(realErrs)); await b.close();
