import { createRequire } from 'module'; const require = createRequire(import.meta.url);
const BASE = process.env.TB_URL || 'http://localhost:8767/';   // serve the project root first: python -m http.server 8767
const { chromium } = require('playwright'); const fs = require('fs');
const dca = JSON.parse(fs.readFileSync('fx-dca.json', 'utf8'));
const { trainingSummary } = await import(new URL('../lib/dca.js', import.meta.url).href);
const bv = JSON.parse(fs.readFileSync('fx-botview.json', 'utf8')); bv.dca.training = trainingSummary(dca);
const now = Date.now(), iso = (m) => new Date(now - m * 6e4).toISOString();
bv.today.closed = 4; bv.today.closedPnl = 61.2; bv.today.stocks = 2;
bv.today.lists.closed.push({ t: iso(90), s: 'NVDA', bot: 'Stock swing', type: 'target', text: 'Target hit: sold 12 NVDA @ 188.40', qty: 12, px: 188.4, entry: 183.1, pnl: 63.6 },
  { t: iso(40), s: 'DOGE/USD', bot: 'DCA', type: 'target', text: 'DCA trailing take profit: sold 16234.123456 DOGE/USD @ 0.26123', qty: 16234.123456, px: 0.26123, entry: 0.2581, pnl: 49.2 },
  { t: iso(20), s: 'SPY', bot: 'DCA', type: 'stop', text: 'DCA hard exit: sold 3.1234 SPY @ 641.22', qty: 3.1234, px: 641.22, entry: 657.1, pnl: -51.7 });
bv.today.lists.stocks = [{ t: iso(200), s: 'NVDA', bot: 'Stock swing', type: 'fill', text: 'Filled 12 NVDA @ 183.10', qty: 12, px: 183.1 }, { t: iso(150), s: 'QQQ', bot: 'DCA', type: 'fill', text: 'DCA deal started: bought $143.21 QQQ @ 572.84', qty: 0.25, px: 572.84 }];
const d0 = bv.dca.deals[0]; if (d0) { d0.S = { ...d0.S, tr: 1 }; d0.trail = { tr: 1, act: +(d0.avg * 1.015).toFixed(4), minF: +(d0.avg * 1.0075).toFixed(4), peak: +(d0.avg * 1.04).toFixed(4), on: true, floor: +(d0.avg * 1.0296).toFixed(4), live: +(d0.avg * 1.0296).toFixed(4) }; }
const ctl = JSON.parse(fs.readFileSync('fx-control.json', 'utf8'));
const R = { health: { ok: true, alpaca: true, locked: true, authorized: true, cron: true, cryptoSwing: false }, botview: bv, control: ctl, quotes: { quotes: {}, groups: { indices: [], sectors: [], crypto: [], cross: [] }, at: iso(0) }, account: { account: { equity: 1e5, last: 1e5, cash: 5e4, bp: 1e5 }, positions: [], open: [], orders: [] } };
const b = await chromium.launch(); const errs = [];
for (const [w, h, tag] of [[1400, 1000, 'desk'], [390, 844, 'phone'], [320, 700, 'small']]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  p.on('pageerror', e => errs.push(tag + ' ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_FAILED/.test(m.text())) errs.push(tag + ' ' + m.text()); });
  await p.route('**/api/**', r => { const k = new URL(r.request().url()).pathname.split('/').pop(); r.fulfill({ contentType: 'application/json', body: JSON.stringify(R[k] || { error: 'x', message: 'no fixture ' + k }) }); });
  await p.route('https://fonts.**', r => r.abort());
  await p.addInitScript(() => localStorage.setItem('tb.token', '"abc"'));
  await p.goto(BASE + 'index.html#bot'); await p.waitForTimeout(1500);
  const tidy = await p.evaluate(() => ({ cryptoTile: !!document.querySelector('#bt-top [data-btlist="crypto"]'), csecHidden: document.querySelector('#bt-csec').hidden, dcaLine: document.querySelector('#bt-dcaline').textContent, dcaCards: document.querySelectorAll('#botroot #dca-cards').length, feedDca: [...document.querySelectorAll('#bt-feed li')].some(li => /DCA/.test(li.textContent)) }));
  const heldCoins = bv.trades.some(t => t.kind === 'crypto');
  console.log((!tidy.cryptoTile && tidy.csecHidden === !heldCoins && /DCA bot · \d+ open deal/.test(tidy.dcaLine) && /Open the DCA tab/.test(tidy.dcaLine) && !tidy.dcaCards && !tidy.feedDca ? 'PASS ' : 'FAIL ') + tag + ' crypto swing off: no crypto tile; crypto section only while a swing coin is still held (' + heldCoins + '); DCA is one line with a link (no deal cards, no DCA rows in the activity feed): ' + JSON.stringify(tidy).slice(0, 160));
  for (const k of ['closed', 'open', 'stocks']) {
    await p.click(`#bt-top [data-btlist="${k}"].stbtn`); await p.waitForTimeout(250);
    const el = await p.$('#bt-top'); await el.screenshot({ path: `bt-${k}-${tag}.png` });
    // overlap check: within each row, left/mid/right boxes must not intersect; nothing wider than the viewport
    const bad = await p.evaluate(() => { const out = []; const hit = (a, z) => a.left < z.right - 1 && z.left < a.right - 1 && a.top < z.bottom - 1 && z.top < a.bottom - 1;
      document.querySelectorAll('.btl-row').forEach((r, i) => { const [l, m, x] = [...r.children].map(c => c.getBoundingClientRect()); if (hit(l, m) || hit(m, x) || hit(l, x)) out.push('row ' + i); });
      document.querySelectorAll('#bt-top .stat').forEach((t, i) => { const kids = [...t.children].map(c => c.getBoundingClientRect()); for (let a = 0; a < kids.length; a++) for (let z = a + 1; z < kids.length; z++) if (hit(kids[a], kids[z])) out.push('tile ' + i); if (t.scrollWidth > t.clientWidth + 1) out.push('tile overflow ' + i); });
      return out; });
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    console.log((bad.length || ov > 0 ? 'FAIL ' : 'PASS ') + tag, k, 'rows', await p.$$eval('.btl-row', x => x.length), 'overlaps', JSON.stringify(bad), 'page overflow', ov);
  }
  await p.click('#bt-top .btl-h .xbtn'); await p.waitForTimeout(200); console.log(tag, 'list closed by ✕:', !(await p.$('#bt-list')));
  await p.click('#bt-dcaline [data-go="dca"]'); await p.waitForTimeout(400);
  console.log((await p.evaluate(() => location.hash === '#dca' && !!document.querySelector('#dcaroot')) ? 'PASS ' : 'FAIL ') + tag + ' "Open the DCA tab" goes to the DCA tab');
  await p.close();
}
const realErrs = errs.filter(e => !/ERR_TUNNEL_CONNECTION_FAILED|ERR_FAILED/.test(e)); console.log((realErrs.length ? 'FAIL' : 'PASS') + ' no script errors on the page ' + JSON.stringify(realErrs)); await b.close();
