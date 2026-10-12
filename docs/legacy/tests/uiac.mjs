// UI check v0.13.2: ticker suggestions as you type in every symbol field (Option ideas, Catalyst scenario, Ask Jev, order ticket), the
// company name + an old-data warning on Ask Jev results,
// same list and ranking as the top search box. Stock-only fields leave crypto out. Arrow keys + Enter or a tap fill the field. At 3 widths.
import { createRequire } from 'module'; const require = createRequire(import.meta.url);
const BASE = process.env.TB_URL || 'http://localhost:8767/';   // serve the project root first: python -m http.server 8767
const { chromium } = require('playwright');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const SYMS = { n: 9, list: [['BTC/USD', 'Bitcoin', 'CRYPTO'], ['APT/USD', 'Aptos', 'CRYPTO'], ['AAPL', 'Apple Inc.', 'NASDAQ'], ['APP', 'AppLovin Corporation', 'NASDAQ'], ['APLD', 'Applied Digital Corporation', 'NASDAQ'],
  ['AMAT', 'Applied Materials, Inc.', 'NASDAQ'], ['NVDA', 'NVIDIA Corporation', 'NASDAQ'], ['MSFT', 'Microsoft Corporation', 'NASDAQ'], ['SPY', 'SPDR S&P 500 ETF Trust', 'ARCA']] };
const R = { health: { ok: true, alpaca: true, locked: true, authorized: true, cron: true, version: '0.13.2' }, symbols: SYMS, swing: { plays: [], scanned: 0, at: new Date().toISOString() },
  quotes: { quotes: {}, groups: { indices: [], sectors: [], crypto: [], cross: [] }, at: new Date().toISOString() }, catalyst: { log: [], scorecard: [] } };
const fs = require('fs'), ask = JSON.parse(fs.readFileSync('fx-jevask.json', 'utf8'));
const askFor = (sym) => ({ ...ask, s: sym, asOf: sym === 'APLD' ? new Date(Date.now() - 55 * 864e5).toISOString() : new Date(Date.now() - 864e5).toISOString() });
const b = await chromium.launch(); const errs = [];
for (const [w, h, tag] of [[1400, 1000, 'desk'], [390, 844, 'phone'], [320, 700, 'small']]) {
  const p = await b.newPage({ viewport: { width: w, height: h } }); let symCalls = 0;
  p.on('pageerror', e => errs.push(tag + ' ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_FAILED|ERR_TUNNEL|404/.test(m.text())) errs.push(tag + ' ' + m.text()); });
  await p.route('**/api/**', r => { const k = new URL(r.request().url()).pathname.split('/').pop(); if (k === 'symbols') symCalls++;
    const q = new URL(r.request().url()).searchParams.get('symbol');
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(k === 'jev' && q ? askFor(q) : R[k] || { error: 'x', message: 'no fixture ' + k }) }); });
  await p.route('https://fonts.**', r => r.abort());
  await p.addInitScript(() => { localStorage.setItem('tb.token', '"abc"'); localStorage.removeItem('tb.catForm'); });
  await p.goto(BASE + 'index.html#home'); await p.waitForTimeout(600);
  await p.keyboard.press('5'); await p.waitForTimeout(900);
  const box = async () => p.evaluate(() => { const b = document.querySelector('#acbox'), r = b.getBoundingClientRect(); return { shown: !b.hidden, rows: [...b.querySelectorAll('.sg b')].map(x => x.textContent), right: r.right, left: r.left, cw: document.documentElement.clientWidth }; });
  // Option ideas: stock field
  await p.click('#o-sym'); await p.keyboard.type('ap', { delay: 30 }); await p.waitForTimeout(300);
  let B = await box();
  ok(symCalls >= 1 && B.shown && B.rows[0] === 'APP' && B.rows.includes('AAPL') && B.rows.includes('APLD') && !B.rows.includes('APT'), `${tag} Option ideas: typing "ap" suggests ${B.rows.join(', ')} (stocks only, no crypto)`);
  ok(B.left >= 0 && B.right <= B.cw + 1, `${tag} suggestion list stays on screen (${Math.round(B.left)}–${Math.round(B.right)} of ${B.cw})`);
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  B = await box();
  ok(!B.shown && (await p.inputValue('#o-sym')) === B.rows?.[1] || (!B.shown && (await p.inputValue('#o-sym')).length >= 3), `${tag} arrow + Enter fills the field (${await p.inputValue('#o-sym')}) and closes the list`);
  // company-name words
  await p.fill('#o-sym', ''); await p.click('#o-sym'); await p.keyboard.type('micro', { delay: 20 }); await p.waitForTimeout(250);
  B = await box(); ok(B.shown && B.rows[0] === 'MSFT', `${tag} company names match too ("micro" → ${B.rows.join(', ')})`);
  // Catalyst: tap a suggestion; the saved draft sees it
  await p.click('#ca-sym'); await p.keyboard.type('app', { delay: 30 }); await p.waitForTimeout(250);
  B = await box(); const ix = B.rows.indexOf('AAPL');
  ok(B.shown && ix >= 0 && !B.rows.some(r => r.includes('APT')), `${tag} Catalyst: "app" → ${B.rows.join(', ')}`);
  await p.click(`#acbox .sg[data-i="${ix}"]`); await p.waitForTimeout(200);
  const draft = await p.evaluate(() => JSON.parse(localStorage.getItem('tb.catForm') || '{}').sym);
  ok((await p.inputValue('#ca-sym')) === 'AAPL' && draft === 'AAPL' && !(await box()).shown, `${tag} tapping a suggestion fills the field and the saved draft (${draft})`);
  await p.keyboard.press('Escape');
  // Ask Jev (any symbol): crypto allowed
  await p.evaluate(() => { document.activeElement?.blur(); go('jev'); }); await p.waitForTimeout(700);
  if (await p.$('#jv-sym')) {
    await p.fill('#jv-sym', ''); await p.click('#jv-sym'); await p.keyboard.type('bt', { delay: 30 }); await p.waitForTimeout(250);
    B = await box(); ok(B.shown && B.rows[0] === 'BTC', `${tag} Ask Jev: "bt" suggests crypto too (${B.rows.join(', ')})`);
    await p.keyboard.press('Enter'); await p.waitForTimeout(150);
    ok((await p.inputValue('#jv-sym')) === 'BTC/USD', `${tag} Enter fills BTC/USD`);
    await p.fill('#jv-sym', 'AAPL'); await p.click('#jv-go'); await p.waitForTimeout(500);
    let hd = await p.evaluate(() => ({ head: document.querySelector('.jvhead')?.textContent || '', warn: !!document.querySelector('#jv-res .errmsg') }));
    ok(/AAPL\s+Apple Inc\./.test(hd.head) && !hd.warn, `${tag} Ask Jev result shows the company name ("${hd.head.trim()}"), no old-data warning`);
    await p.fill('#jv-sym', 'APLD'); await p.click('#jv-go'); await p.waitForTimeout(500);
    hd = await p.evaluate(() => ({ head: document.querySelector('.jvhead')?.textContent || '', warn: document.querySelector('#jv-res .errmsg')?.textContent || '' }));
    ok(/Applied Digital/.test(hd.head) && /days ago/.test(hd.warn), `${tag} old candles get a warning ("${hd.warn.slice(0, 60)}…")`);
  } else ok(false, `${tag} Jev tab form not found`);
  const sw = await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  ok(sw, `${tag} no sideways page scroll`);
  await p.close();
}
ok(!errs.length, `no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
await b.close();
