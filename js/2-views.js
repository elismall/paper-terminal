// Paper Terminal front end, part 2 of 4. Plain classic scripts (no build); they share one global scope and load in order from index.html.
/* ---------- Bloomberg-style board panels ---------- */
const sel = Object.assign({ idx: 'SPY', sec: 'XLK', cr: 'BTC/USD' }, LS.get('sel', {}));
const mini = {};
const nyT = t => new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' });
const nyT12 = t => new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }); // what people see (12-hour); nyT stays 24-hour for math
function bpanel(key, syms) {
  const q = state.quotes; if (!q) return loading; if (q.error) return msg(q);
  const Q = q.quotes; const have = syms.filter(s => Q[s]);
  if (!have.length) return `<div class="empty">Stock quotes appear after you add your Alpaca keys. Crypto is live now.</div>`;
  const cur = have.includes(sel[key]) ? sel[key] : have[0]; const x = Q[cur];
  const blocks = have.map(s => Q[s]).map(b => `<button class="blk ${b.pct > 0 ? 'u' : b.pct < 0 ? 'd' : 'z'}" data-bsel="${key}" data-s="${esc(b.s)}" aria-pressed="${b.s === cur}"><span class="n">${esc(b.n || b.s)}</span><span class="pc">${fpct(b.pct * 100)}</span><span class="px">${fp(b.p)}<br>${b.chg >= 0 ? '+' : ''}${fp(b.chg)}</span></button>`).join('');
  return `<div class="bp"><div class="blist">${blocks}</div><div class="bchart"><div class="t">${esc(x.n || '')} · <span class="sy">${esc(cur)}</span></div><div><span class="v num">${fp(x.p)}</span> <span class="num ${cls(x.pct)}">${x.chg >= 0 ? '+' : ''}${fp(x.chg)} (${fpct(x.pct * 100)})</span></div><canvas data-mini="${esc(cur)}" title="Open ${esc(cur)}"></canvas><div class="u2">${cur.includes('/') ? 'Last 48 hours, hourly' : 'Latest session, 5-minute'} · updated ${x.t ? nyT12(x.t) + ' ET' : '—'} · click chart for detail</div></div></div>`;
}
function crossTable() {
  const q = state.quotes; if (!q) return loading; if (q.error) return msg(q);
  const rows = q.groups.cross.map(s => q.quotes[s]).filter(Boolean);
  if (!rows.length) return `<div class="empty">Rates, dollar and commodity ETFs appear after you add your Alpaca keys.</div>`;
  return `<div class="scroll"><table><thead><tr><th>Ticker</th><th class="l">Market</th><th>Price</th><th>Change</th><th>% Chg</th><th>Time</th></tr></thead><tbody>${rows.map(r => `<tr data-sym="${esc(r.s)}"><td class="sy">${esc(r.s)}</td><td class="l" style="color:#fff;font-family:var(--sans)">${esc(r.n)}</td><td>${fp(r.p)}</td><td class="${cls(r.chg)}">${r.chg >= 0 ? '+' : ''}${fp(r.chg)}</td><td class="${cls(r.pct)}">${fpct(r.pct * 100)}</td><td class="muted">${r.t ? nyT12(r.t) : '—'}</td></tr>`).join('')}</tbody></table></div>`;
}
async function ensureMini(sym) {
  const m = mini[sym]; if (m && (m.busy || Date.now() - m.ts < 6e4)) return;
  mini[sym] = Object.assign({}, m, { busy: true });
  const j = await api('bars', { symbol: sym, tf: sym.includes('/') ? '1Hour' : '5Min' }).catch(e => ({ error: 'network', message: e.message }));
  mini[sym] = { ts: Date.now(), j };
  document.querySelectorAll('canvas[data-mini]').forEach(cv => { if (cv.dataset.mini === sym) miniChart(cv, j, sym); });
}
function drawMinis() { document.querySelectorAll('canvas[data-mini]').forEach(cv => { const sym = cv.dataset.mini; if (mini[sym]?.j) miniChart(cv, mini[sym].j, sym); ensureMini(sym); }); }
function miniChart(cv, j, sym) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
  cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
  g.font = '11px "IBM Plex Mono", monospace'; g.fillStyle = '#8a8a8a';
  if (!j || j.error || !j.bars?.length) { g.fillText(j?.error === 'no_keys' ? 'Chart turns on with Alpaca keys' : j?.error ? 'Chart unavailable' : 'Loading…', 8, H / 2); return; }
  let b = j.bars;
  if (sym.includes('/')) b = b.slice(-48);
  else { const d = t => new Date(t).toLocaleDateString('en-US', { timeZone: 'America/New_York' }); const mm = t => { const [h, mi] = nyT(t).split(':'); return (+h % 24) * 60 + +mi; }; const last = d(b.at(-1).t); const day = b.filter(x => d(x.t) === last); const reg = day.filter(x => mm(x.t) >= 570 && mm(x.t) < 960); b = reg.length > 1 ? reg : day; }
  if (b.length < 2) { g.fillText('Not enough data yet', 8, H / 2); return; }
  const prev = state.quotes?.quotes?.[sym]?.prev;
  const m = { l: 2, r: 58, t: 6, b: 16 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  let lo = Math.min(...b.map(x => x.l)), hi = Math.max(...b.map(x => x.h)); if (prev && !sym.includes('/')) { lo = Math.min(lo, prev); hi = Math.max(hi, prev); }
  const pad = (hi - lo) * 0.06 || 1; lo -= pad; hi += pad;
  const X = i => m.l + i / (b.length - 1) * iw, Y = v => m.t + (1 - (v - lo) / (hi - lo)) * ih;
  for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4; g.strokeStyle = '#1e1e1e'; g.lineWidth = 1; g.beginPath(); g.moveTo(m.l, Y(v)); g.lineTo(W - m.r, Y(v)); g.stroke(); g.fillStyle = '#8a8a8a'; g.fillText(fp(v), W - m.r + 5, Y(v) + 4); }
  [0, Math.floor((b.length - 1) / 2), b.length - 1].forEach((i, k) => { g.fillStyle = '#8a8a8a'; g.textAlign = k === 0 ? 'left' : k === 2 ? 'right' : 'center'; g.fillText(nyT12(b[i].t), X(i), H - 3); }); g.textAlign = 'left';
  const base = sym.includes('/') ? b[0].c : (prev || b[0].o); const upNow = b.at(-1).c >= base;
  if (!sym.includes('/') && prev) { g.strokeStyle = '#666'; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(m.l, Y(prev)); g.lineTo(W - m.r, Y(prev)); g.stroke(); g.setLineDash([]); }
  const grad = g.createLinearGradient(0, m.t, 0, m.t + ih); const c = upNow ? '53,208,127' : '255,77,77'; grad.addColorStop(0, `rgba(${c},.55)`); grad.addColorStop(1, `rgba(${c},.03)`);
  g.beginPath(); b.forEach((x, i) => i ? g.lineTo(X(i), Y(x.c)) : g.moveTo(X(i), Y(x.c))); g.lineTo(X(b.length - 1), m.t + ih); g.lineTo(X(0), m.t + ih); g.closePath(); g.fillStyle = grad; g.fill();
  g.beginPath(); b.forEach((x, i) => i ? g.lineTo(X(i), Y(x.c)) : g.moveTo(X(i), Y(x.c))); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke();
  const ly = Y(b.at(-1).c); g.fillStyle = upNow ? '#127a3c' : '#9a1c1c'; g.fillRect(W - m.r + 1, ly - 8, m.r - 1, 16); g.fillStyle = '#fff'; g.fillText(fp(b.at(-1).c), W - m.r + 4, ly + 4);
}

/* ---------- options ---------- */
const opt = LS.get('optCache', {});
let optBusy = false;
async function autoOptions() {
  if (optBusy) return; const sw = state.swing, lt = state.longterm;
  const wants = [];
  if (sw && !sw.error) { sw.plays.filter(p => p.dir === 'long').slice(0, 3).forEach(p => wants.push({ key: 'd:' + p.s, p: { symbol: p.s, dir: 'long', target: p.target }, from: `${p.setup} (score ${p.score})` })); sw.plays.filter(p => p.dir === 'short').slice(0, 1).forEach(p => wants.push({ key: 'd:' + p.s, p: { symbol: p.s, dir: 'short', target: p.target }, from: `${p.setup} (score ${p.score})` })); }
  if (lt && !lt.error) lt.picks.filter(p => !p.etf && p.trend).slice(0, 2).forEach(p => wants.push({ key: 'c:' + p.s, p: { symbol: p.s, strategy: 'csp' }, from: `Long-term pick (score ${p.score})` }));
  optBusy = true; state.optKeys = wants.map(w => w.key);
  for (const w of wants) { const c = opt[w.key]; if (c && Date.now() - c.ts < 6e5) continue; const j = await api('options', w.p).catch(e => ({ error: 'network', message: e.message })); opt[w.key] = { ts: Date.now(), j, from: w.from }; if (tab === 'options' || tab === 'home') render(); }
  optBusy = false; LS.set('optCache', opt);
}
// v0.13.0: earnings inside the expiry (estimated from SEC filings) and the move the options price in by then.
const earnLine = (i) => i.earn ? `<div class="amber" style="font-size:12px;margin:4px 0">Earnings expected about ${esc(i.earn.date)} (in ~${i.earn.inDays} days, estimated), before this expiry${i.implied ? `: options price a ±${i.implied.pct}% move by ${esc(i.implied.exp)}` : ''}. Implied volatility usually drops right after the report.</div>` : '';
// Long call / long put card: three strikes (shared with the Catalyst Scenario panel, which adds "past events cleared").
function longStrikes(sym, i, past) {
  const t = i.strategy === 'Long put' ? 'put' : 'call';
  return `<div class="scroll"><table><thead><tr><th class="l">Strike</th><th>Cost</th><th>Breakeven</th><th>Move needed</th>${past ? '<th>Past events cleared</th>' : ''}<th>Delta</th><th>Decay/day</th><th>IV</th>${i.target ? `<th>At ${fp(i.target)}</th>` : ''}<th></th></tr></thead><tbody>${i.strikes.map(k => `<tr><td class="l">${esc(k.label)} <b>${fp(k.k)}</b></td><td>${f$(k.cost)}</td><td>${fp(k.breakeven)}</td><td class="${cls(k.bePct * (t === 'call' ? 1 : -1))}">${sgn(k.bePct, 1, '%')}</td>${past ? `<td>${k.pastCleared == null ? '—' : `${k.pastCleared} of ${k.pastN}`}</td>` : ''}<td>${nf(k.delta, 2)}</td><td class="down">${k.thetaDay == null ? '—' : f$(k.thetaDay)}</td><td>${k.iv == null ? '—' : k.iv + '%'}</td>${i.target ? `<td class="${cls(k.atTarget)}">${f$(k.atTarget)}${k.multiple != null ? ` <span class="muted">(${k.multiple}×)</span>` : ''}</td>` : ''}<td><button class="btn tradebtn" style="padding:1px 8px" data-ticket='${esc(JSON.stringify({ symbol: k.occ, side: 'buy', qty: 1, type: 'limit', limit_price: k.mid > 0 ? k.mid : k.ask, label: `Buy ${sym} ${i.exp} ${k.k} ${t}` }))}'>Buy</button></td></tr>`).join('')}</tbody></table></div>`;
}
function longCard(j, from) {
  const i = j.idea;
  return `<div class="card" style="grid-column:1/-1"><h3><button class="btn" data-sym="${esc(j.s)}" style="padding:2px 8px"><span class="sy">${esc(j.s)}</span></button>${esc(i.strategy)} · ${esc(i.exp)} (${i.dte}d)</h3><div class="muted" style="font-size:12px">From: ${esc(from || 'manual')} · stock ${fp(j.px)}${i.target ? ` · target ${fp(i.target)}` : ''}</div>${earnLine(i)}${longStrikes(j.s, i, false)}<div class="plan">${esc(i.plan)}</div></div>`;
}
function optCard(o) {
  const j = o.j; if (!j) return '';
  if (j.error) return `<div class="card">${msg(j)}</div>`;
  if (!j.idea) return `<div class="card"><h3><span class="sy">${esc(j.s)}</span></h3><div class="muted">${esc(j.message)}</div></div>`;
  const i = j.idea;
  if (i.strikes) return longCard(j, o.from);
  const body = i.strategy === 'Cash-secured put'
    ? `<dl class="kv"><dt>Expiry</dt><dd>${i.exp} (${i.dte}d)</dd><dt>Sell put</dt><dd>${i.strike}</dd><dt>Credit</dt><dd class="up">$${(i.credit * 100).toFixed(0)}</dd><dt>Cash needed</dt><dd>${f$(i.capital)}</dd><dt>Yield, annualized</dt><dd>${i.yieldAnn}%</dd><dt>Breakeven</dt><dd>${fp(i.breakeven)}</dd><dt>Delta / IV</dt><dd>${i.delta ?? '—'} / ${i.iv ?? '—'}%</dd></dl>`
    : `<dl class="kv"><dt>Expiry</dt><dd>${i.exp} (${i.dte}d)</dd><dt>Buy</dt><dd>${i.buy.k} @ ${fp(i.buy.ask)}</dd><dt>Sell</dt><dd>${i.sell.k} @ ${fp(i.sell.bid)}</dd><dt>Debit (natural / mid)</dt><dd>${fp(i.debit)} / ${fp(i.debitMid)}</dd><dt>Max loss</dt><dd class="down">${f$(i.maxLoss)}</dd><dt>Max profit</dt><dd class="up">${f$(i.maxProfit)}</dd><dt>Payoff ratio</dt><dd>${i.payoff}×</dd><dt>Breakeven</dt><dd>${fp(i.breakeven)}</dd><dt>Long delta / IV</dt><dd>${i.buy.delta ?? '—'} / ${i.buy.iv ?? '—'}%</dd></dl>`;
  const pre = i.strategy === 'Cash-secured put' ? { symbol: i.occ, side: 'sell', qty: 1, type: 'limit', limit_price: i.credit, label: `Sell ${j.s} ${i.exp} ${i.strike} put` }
    : { kind: 'spread', symbol: j.s, qty: 1, limit_price: i.debitMid > 0 ? i.debitMid : i.debit, legs: [{ symbol: i.buy.occ, side: 'buy' }, { symbol: i.sell.occ, side: 'sell' }], label: `${i.strategy}: buy ${i.buy.k} / sell ${i.sell.k}, ${i.exp}`, maxLoss: i.maxLoss };
  return `<div class="card"><h3><button class="btn" data-sym="${esc(j.s)}" style="padding:2px 8px"><span class="sy">${esc(j.s)}</span></button>${esc(i.strategy)}</h3><div class="muted" style="font-size:12px">From: ${esc(o.from || 'manual')} · stock ${fp(j.px)}</div>${earnLine(i)}${body}<div class="plan">${esc(i.plan)}</div><button class="btn tradebtn" data-ticket='${esc(JSON.stringify(pre))}'>${i.strategy === 'Cash-secured put' ? 'Sell this put' : 'Place this spread'}</button></div>`;
}
// v0.13.0: the form and its answer live in a fixed shell (optShell) so a data refresh never wipes what you typed; only the
// automatic idea cards (#opt-cards) are redrawn.
const optForm = () => `<form class="inline" id="optform"><label>Symbol<input class="in" id="o-sym" required style="width:100px;text-transform:uppercase"></label><label>View<select class="in" id="o-dir"><option value="call">Bullish · long call</option><option value="long">Bullish · call spread</option><option value="put">Bearish · long put</option><option value="short">Bearish · put spread</option><option value="csp">Own it cheaper · cash-secured put</option></select></label><label>Target price<input class="in" id="o-tgt" type="number" step="0.01" style="width:110px" placeholder="optional"></label><label>Days out<input class="in" id="o-dte" type="number" min="10" max="120" step="1" style="width:80px" placeholder="35"></label><button class="btn primary">Build idea</button></form><div id="o-manual" class="cards" ${opt.manual ? '' : 'hidden'}>${opt.manual ? optCard(opt.manual) : ''}</div>`;
function optionsCards(limit) {
  const keys = (state.optKeys || []).slice(0, limit || 99);
  const cards = keys.map(k => opt[k]).filter(Boolean).map(optCard).join('');
  const sw = state.swing;
  const status = sw?.error ? msg(sw) : !keys.length ? '<div class="empty">Ideas appear here once the swing and long-term scans load.</div>' : '';
  return status || `<div class="cards">${cards || '<div class="empty">Building ideas…</div>'}</div>`;
}
const optionsView = (limit) => (limit ? '' : optForm()) + optionsCards(limit);
const OPT_NOTE = 'Long calls and puts: the most you can lose is what you pay; in the money moves most like the stock and decays slowest, out of the money is cheaper but needs a bigger move before expiry. Debit spreads cap the loss at what you pay; the long leg targets about 0.60 delta about 35 days out and the short leg sits near the swing target. Cash-secured puts target about 0.25 delta 30–45 days out on long-term picks you would be happy to own. When an expiry spans the next earnings report (estimated from SEC filings) the card says so: implied volatility usually drops right after the report. Free-plan option quotes are indicative, so check live prices with your broker before trading.';
function optShell() { return `<div class="grid" id="optroot">${typeof chartShell === 'function' ? chartShell() : ''}${typeof catShell === 'function' ? catShell() : ''}${panel('op', '41)', 'Option ideas', 'indicative feed · 15-min delayed trades', optForm() + '<div id="opt-cards"></div>', 'span12', OPT_NOTE)}</div>`; }
function optPaint() { const c = $('#opt-cards'); if (c) c.innerHTML = optionsCards(0); if (typeof catPaint === 'function') catPaint(); if (typeof chartPaint === 'function') chartPaint(); }

/* ---------- render ---------- */
function setupCard() {
  const h = state.health; if (!h || h.error || h.alpaca) return '';
  return `<section class="setup span12"><h2>Finish setup (about 10 minutes)</h2><ol>
    <li>Make a free Alpaca paper account at <b>alpaca.markets</b>, then create paper API keys in its dashboard.</li>
    <li>In Vercel open this project → Settings → Environment Variables. Add <code>ALPACA_KEY_ID</code> and <code>ALPACA_SECRET_KEY</code>, both marked Sensitive.</li>
    <li>Add <code>DASH_PASSCODE</code> (any phrase you'll remember) so only you can open the data.</li>
    <li>Optional: <code>FRED_API_KEY</code> (free at fred.stlouisfed.org) for macro, and <code>SEC_USER_AGENT</code> set to your name and email for company fundamentals.</li>
    <li>Redeploy from the Deployments tab (⋯ → Redeploy), then enter the passcode here under Settings.</li></ol>
    <div class="muted" style="font-size:12.5px">Crypto is already live without any keys.</div></section>`;
}
function render() {
  const m = $('#main');
  if (tab === 'bot') { if (!$('#botroot')) { m.innerHTML = botShell(); BT.charts = {}; } botPaint(); return; }
  if (tab === 'jev') { if (!$('#jevroot')) m.innerHTML = jevShell(); jevPaint(); return; }
  if (tab === 'dca') { if (!$('#dcaroot')) { m.innerHTML = dcaTabShell(); BT.charts = {}; } dcaTabPaint(); return; }
  if (tab === 'options') { if (!$('#optroot')) m.innerHTML = optShell(); optPaint(); return; }
  if (tab === 'crypto') { if (!$('#cbroot')) { m.innerHTML = cbShell(); CB.chart = null; } cbPaint(); return; } const sw = state.swing, it = state.intraday, lt = state.longterm;
  let html = '';
  if (tab === 'home') html = `<div class="grid">${setupCard()}
    ${panel('idx', '11)', 'Stock Indexes', metaAt(state.quotes), bpanel('idx', state.quotes?.groups?.indices || []), 'span6')}
    ${panel('sec', '12)', 'Industries', 'S&P sector ETFs', bpanel('sec', state.quotes?.groups?.sectors || []), 'span6')}
    ${panel('crb', '13)', 'Crypto', '24/7', bpanel('cr', state.quotes?.groups?.crypto || []), 'span6')}
    ${panel('xa', '14)', 'Bonds · Currencies · Commodities', 'ETF proxies', crossTable(), 'span6')}
    ${panel('sw', '21)', 'Top Swing Plays', metaAt(sw), playTable(sw, 6, 'swing'), 'span6')}
    ${panel('nw', '71)', 'Top News', metaAt(state.news), newsList(state.news, 8), 'span6')}
    ${panel('acct', '91)', acctName(true), `<button class="btn primary" data-act="ticket" style="padding:2px 10px">New order</button>`, accountView(state.account, true), 'span12')}</div>`;
  if (tab === 'swing') html = `<div class="grid">${panel('sw', '21)', 'Swing plays · daily bars', sw && !sw.error ? `${sw.plays.length} setups · ${sw.scanned} scanned · ${metaAt(sw)}` : '', playTable(sw, 0, 'swing'), 'span12',
    'Rules: Breakout = close above the 20-day high on 1.3× volume, above the 50-day. Pullback = uptrend (price above 50-day above 200-day), RSI 38–52, within 1 ATR of the 20-day. Oversold = RSI under 32 above the 200-day. Breakdown = mirror of breakout in a downtrend. Stop 1.5 ATR, target 3 ATR (2:1). Score adds 3-month strength vs SPY. Check earnings dates before entering.')}</div>`;
  if (tab === 'intraday') html = `<div class="grid">${panel('it', '31)', 'Intraday setups', it && !it.error ? (it.reviewOnly ? '<span class="amber">market closed · last session</span>' : metaAt(it)) : '', playTable(it, 0, 'intraday'), 'span12', it && !it.error ? esc(it.note) + ' Stops sit at VWAP or the opening-range edge; targets are 2R. Refreshes every minute while open.' : '')}
    ${panel('mv', '31)', 'Movers and most active', '', moversTable(it) || (it ? '' : loading), 'span12')}</div>`;
  if (tab === 'long') html = `<div class="grid">${panel('lt', '51)', 'Long-term holds', metaAt(lt), longTable(lt, 0), 'span12',
    (lt?.fundamentalsNote ? esc(lt.fundamentalsNote) + ' ' : '') + 'Score: 35% 12-1 month momentum, 25% revenue growth, 15% net margin, 15% trend above the 200-day, 10% low volatility. Growth and margin come from the latest two annual 10-K filings. ETFs are scored on price only. "Add below" is the higher of the 50- and 200-day averages.')}</div>`;
  if (tab === 'news') html = `<div class="grid">${panel('nw', '71)', 'Headlines', metaAt(state.news), newsList(state.news, 0), 'span12')}</div>`;
  if (tab === 'macro') html = `<div class="grid">${panel('mc', '81)', 'Macro', metaAt(state.macro), macroView(state.macro), 'span12', 'Source: FRED, Federal Reserve Bank of St. Louis. Daily series lag one business day; CPI and unemployment are monthly.')}</div>`;
  if (tab === 'account') html = `<div class="grid">${panel('ac', '91)', acctName(true), metaAt(state.account), accountView(state.account, false), 'span12', (isLive() ? 'Alpaca LIVE trading: real money, real fills; every bot buy is checked against your LIVE_MAX_USD limit first;' : 'Alpaca paper trading. No slippage, fees or market impact are simulated at the fills;') + ' the Benchmark tab scores results after estimated costs. Owner tags: BOT = opened by a bot (Emergency stop closes it), YOURS = yours (the bots never touch it), MIXED = you bought after the bot did (the bot leaves it alone).')}</div>`;
  if (tab === 'perf') { const P = state.performance, B = state.benchmark, v = perfView();
    html = `<div class="grid">${panel('ps', '01)', 'Scoreboard · live vs benchmark', metaAt(P), (P?.error ? msg(P) : '') + v.tiles + feeLine(P) + v.notes, 'span12')}
    ${panel('dv', '0A)', `Swing bots vs DCA bot · live ${isLive() ? 'money' : 'paper'}`, P?.compare?.since ? 'same dates, realized + open' : '', dcaCompareView(P), 'span12', 'Swing = the stock and crypto swing bots (your manual trades excluded). DCA = the 3Commas-style deals bot with its own $20k budget. Give it a few weeks: a handful of trades says little either way.')}
    ${panel('pa', '02)', 'Account vs S&amp;P 500', '<span class="legend"><span><i style="background:var(--s1)"></i>Your paper account</span><span><i style="background:var(--s2)"></i>SPY buy-and-hold</span></span>', '<div class="pb"><canvas class="pcv" data-pc="acct"></canvas></div>', 'span6', 'Both start at 0% on the first day of the last 3 months of account history.')}
    ${panel('pr', '03)', 'Are we improving?', '<span class="legend"><span><i style="background:var(--s1)"></i>Avg return, last 10 trades</span><span><i style="background:var(--s2)"></i>Benchmark avg</span></span>', '<div class="pb"><canvas class="pcv" data-pc="roll"></canvas></div>', 'span6', 'Above the dashed line means recent trades are beating what the rules did historically.')}
    ${panel('pt', '04)', 'By setup · live vs benchmark', '', setupTable(P, B), 'span12', 'R = profit divided by the risk to the stop. +0.20R means you make 20% of what you risk on each trade, on average. ± is a rough 95% range: if it crosses zero, the edge is not proven yet.')}
    ${panel('px', '04A)', 'Experiment ledger', 'one row per trading-rule change', expView(P), 'span12', 'Each closed trade or deal counts under the experiment that was live when it was entered, so results never mix across rule changes. Stocks in R, DCA in % of the deal, all after estimated costs. Rows can overlap (the DCA rules and the 5-minute crypto checks both apply to a crypto deal).')}
    ${panel('pcl', '04B)', 'Candidate ledger · what the bot passed on', 'every setup seen, graded the same way', candView(P), 'span12', esc(P?.candidates?.method || 'Each candidate graded the same way whether bought or not.') + ' If the skipped rows keep beating the taken row, a filter is costing money.')}
    ${panel('por', '04C)', 'Opening-range shadow · first-hour breakouts', 'shadow only · never traded', orbView(P), 'span12', esc(P?.orb?.rules || ''))}
    <details class="span12 deep" style="min-width:0" ${LS.get('deepOpen', false) ? 'open' : ''}><summary class="ph" style="cursor:pointer;border:1px solid var(--line)"><span class="fk">05–09)</span><h2>Stock bot deep dive</h2><span class="meta">training · benchmark by score · cumulative R · trade journal${state.health?.cryptoSwing ? ' · crypto training' : ''} · tap to open</span></summary><div class="grid" style="margin-top:6px">
    ${panel('ptr', '05)', 'Training · 16 exit settings tested', B && !B.error ? 'steadiness = avg R ÷ spread of R' : '', trainTable(B), 'span12', 'The bot picks the most consistent setting that made money over at least 60 historical trades. Higher win rate with smaller targets usually wins on steadiness; bigger targets win less often but pay more.')}
    ${panel('pb', '06)', 'Benchmark by score', B && !B.error ? `${esc(B.from)} → ${esc(B.to)}` : '', scoreTable(B), 'span6', B && !B.error ? esc(`Assumes ${B.assumptions.entry} entry, ${B.assumptions.stop} stop, ${B.assumptions.target} target, ${B.assumptions.maxHold} max, ${B.assumptions.costs}. ${B.assumptions.note}`) : '')}
    ${panel('pc', '07)', 'Benchmark equity (cumulative R)', B && !B.error ? `SPY over the same window ${sgn(B.spyBuyHold, 1, '%')}` : '', '<div class="pb"><canvas class="pcv" data-pc="bench"></canvas></div>', 'span6')}
    ${panel('pj', '08)', 'Trade journal', P && !P.error ? `${P.trades.length} closed` : '', journal(P), 'span12')}
    ${state.health?.cryptoSwing ? panel('pcr', '09)', 'Crypto · training (13 coins)', B?.crypto && !B.crypto.error && B.crypto.overallLong ? `${esc(B.crypto.from)} → ${esc(B.crypto.to)} · ${B.crypto.overallLong.n} trades · ${nf(B.crypto.overallLong.win, 1, '%')} win · ${sgn(B.crypto.overallLong.expR, 2, 'R')}/trade · BTC over the window ${sgn(B.crypto.spyBuyHold, 1, '%')}` : '', B ? trainTable(B.crypto) : loading, 'span12', 'Same swing rules replayed on crypto daily bars with 0.25% costs per side, trained separately from stocks. The bot only opens crypto trades when a setting made money over 40+ historical trades. Crypto live trades show in the journal above with a "Crypto ·" setup name.') : ''}</div></details></div>`; }
  m.innerHTML = html;
  drawMinis(); if (tab === 'perf') drawPerf();
}
// Benchmark: the stock-bot deep dive starts collapsed (remembered per device); its chart draws when opened.
document.addEventListener('toggle', e => { if (e.target.matches?.('details.deep')) { LS.set('deepOpen', e.target.open); if (e.target.open) drawPerf(); } }, true);

/* ---------- interactions ---------- */
document.addEventListener('click', e => {
  const a = e.target.closest('[data-act="settings"]'); if (a) return openSettings();
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'news-refresh') { delete lastLoad.news; load('news', true); return; }
  if (act === 'ticket') { openTicket({}); return; }
  const br = e.target.closest('[data-botrun]'); if (br) { const k = br.dataset.botrun; if (k !== 'dry' && BT.arm !== k) { BT.arm = k; clearTimeout(BT.armT); BT.armT = setTimeout(() => { BT.arm = null; if (tab === 'bot' || tab === 'dca') render(); }, 4000); render(); return; } runBotNow(k); return; }
  if (act === 'cancel-all') { const b = e.target.closest('button'); if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = 'Tap again to cancel all'; return; } apiSend('order', null, 'DELETE', { all: '1' }).then(() => { delete lastLoad.account; load('account', true); }); return; }
  const mx = e.target.closest('[data-max]'); if (mx) { const L = BT.last[mx.dataset.max]; if (L) openMax(mx.dataset.max, L.title, L.bars, L.opt); return; }
  const tk = e.target.closest('[data-ticket]'); if (tk) { openTicket(JSON.parse(tk.dataset.ticket)); return; }
  const cx = e.target.closest('[data-cancel]'); if (cx) { cx.disabled = true; cx.textContent = '…'; apiSend('order', null, 'DELETE', { id: cx.dataset.cancel }).then(r => { if (r.error) alertBox(r.message); delete lastLoad.account; load('account', true); }); return; }
  const cl = e.target.closest('[data-close]'); if (cl) { if (!cl.classList.contains('arm')) { cl.classList.add('arm'); cl.textContent = 'Confirm close'; setTimeout(() => { cl.classList.remove('arm'); cl.textContent = 'Close'; }, 4000); return; } cl.disabled = true; cl.textContent = '…'; apiSend('order', null, 'DELETE', { close: cl.dataset.close }).then(r => { if (r.error) alertBox(r.message); delete lastLoad.account; load('account', true); }); return; }
  const bs = e.target.closest('[data-bsel]'); if (bs) { sel[bs.dataset.bsel] = bs.dataset.s; LS.set('sel', sel); render(); return; }
  const mc = e.target.closest('canvas[data-mini]'); if (mc) return openDetail(mc.dataset.mini);
  const s = e.target.closest('[data-sym]'); if (s && !e.target.closest('a')) { const plan = s.dataset.plan ? JSON.parse(s.dataset.plan) : null; openDetail(s.dataset.sym, plan); }
});
document.addEventListener('submit', async e => {
  if (e.target.id === 'cmdform') { e.preventDefault(); if (sgList.length && sgIdx >= 0 && !$('#sugg').hidden) return pickSugg(sgIdx); const v = $('#cmd').value.trim().toUpperCase(); if (!v) return; $('#cmd').value = ''; $('#sugg').hidden = true;
    const t = TABS.find(([id, n]) => n === v || id.toUpperCase() === v || n.replace('-', '') === v); if (t) return go(t[0]);
    openDetail(/^[A-Z]{2,6}$/.test(v) && ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'AVAX', 'LINK', 'LTC', 'BCH', 'DOT', 'UNI', 'AAVE', 'SHIB'].includes(v) ? v + '/USD' : v); }
  if (e.target.id === 'optform') { e.preventDefault(); const sym = $('#o-sym').value.trim().toUpperCase(), d = $('#o-dir').value, t = $('#o-tgt').value, n = $('#o-dte').value;
    const box = $('#o-manual'); box.hidden = false; box.innerHTML = '<div class="empty">Building…</div>';
    const j = await api('options', d === 'csp' ? { symbol: sym, strategy: 'csp' } : d === 'call' || d === 'put' ? { symbol: sym, strategy: d, target: t, dte: n } : { symbol: sym, dir: d, target: t });
    opt.manual = { ts: Date.now(), j, from: 'manual' }; box.innerHTML = optCard(opt.manual); }
});
document.addEventListener('keydown', e => { if ((e.key === 'f' || e.key === 'F') && !$('#detail').hidden && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { LS.set('full', !LS.get('full', false)); drawDetail(); return; }
  if (e.key === 'Escape') { if (!$('#cmax').hidden) { closeMax(); return; } $('#detail').hidden = true; $('#settings').hidden = true; $('#ticket').hidden = true; } if (/^[0-9mMjJdD]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && $('#detail').hidden && $('#settings').hidden && $('#ticket').hidden && $('#cmax').hidden) { go(Object.keys(TABKEY).find(id => TABKEY[id] === e.key.toUpperCase())); return; }
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); $('#cmd').focus(); } });
$('#detail').addEventListener('click', e => { if (e.target.id === 'detail') $('#detail').hidden = true; });

/* ---------- detail drawer ---------- */
const RANGES = ['M1', 'M5', 'M15', '1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', 'ALL'];
const RLBL = { M1: '1m', M5: '5m', M15: '15m' }; // candle-size buttons; the rest are date ranges
let det = { sym: null, range: '6M', data: null, plan: null, stats: null };
async function openDetail(sym, plan) {
  det = { sym, range: RANGES.includes(LS.get('range', '6M')) ? LS.get('range', '6M') : '6M', data: null, plan: plan || findPlan(sym), stats: null }; $('#detail').hidden = false; drawDetail(); fetchDetail();
}
function findPlan(sym) { for (const k of ['swing', 'intraday', 'crypto']) { const p = state[k]?.plays?.find(x => x.s === sym); if (p) return p; } return null; }
async function fetchDetail() {
  const { sym, range } = det; const j = await api('bars', { symbol: sym, range });
  if (det.sym !== sym || det.range !== range) return; det.data = j; if (j?.stats?.rsi != null) det.stats = j.stats; drawDetail();
  if (!det.stats && !j.error) api('bars', { symbol: sym, range: '6M' }).then(d => { if (det.sym === sym && d?.stats) { det.stats = d.stats; const el = $('#d-stats'); if (el) el.outerHTML = statRow(); } });
  if (!sym.includes('/')) api('news', { symbols: sym }).then(n => { if (det.sym === sym) { det.news = n; const el = $('#d-news'); if (el) el.innerHTML = newsList(n, 8, false); } });
}
function drawDetail() {
  const { sym, range, data: j, plan } = det; const q = j?.quote;
  $('#drawer').innerHTML = `<div class="dh"><h2>${esc(sym)}</h2><span class="p num">${fp(q?.p)}</span><span class="num ${cls(q?.pct)}">${fp(q?.chg)} ${fpct(q?.pct * 100)}</span><button class="btn tradebtn" style="margin-left:auto" data-ticket='${esc(JSON.stringify({ symbol: sym, px: q?.p }))}'>Trade</button><button class="btn" id="d-full" title="Toggle full screen (F)">${LS.get('full', false) ? '⤡ Half screen' : '⤢ Full screen'}</button><button class="btn" id="d-close">Close ✕</button></div><div class="dbody">
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><div class="seg tvseg" id="d-tf">${RANGES.map(r => `${r === '1D' ? '<span style="width:10px"></span>' : ''}<button data-range="${r}" aria-pressed="${r === range}" title="${RLBL[r] ? RLBL[r] + ' candles' : r + ' range'}">${RLBL[r] || r}</button>`).join('')}</div>
    <span class="muted" style="font:11.5px var(--mono)">click the chart to zoom &amp; pan · double-click resets · Esc releases</span></div>
    <div class="chart" id="cvbox" aria-label="${esc(sym)} price chart">${j ? '' : '<div class="empty">Loading chart…</div>'}</div>
    ${j?.error ? msg(j) : ''}
    ${statRow()}
    ${plan ? `<section class="panel"><div class="ph"><h2>Trade plan</h2><span class="meta">${dirTag(plan.dir)} ${esc(plan.setup)} · score ${plan.score}</span></div><div class="pb"><dl class="kv"><dt>Entry (last)</dt><dd>${fp(plan.px)}</dd><dt>Stop</dt><dd class="down">${fp(plan.stop)}</dd><dt>Target</dt><dd class="up">${fp(plan.target)}</dd><dt>${sym.includes('/') ? 'Units' : 'Shares'} at your risk setting</dt><dd>${sym.includes('/') ? plan.units : plan.shares}</dd></dl><div class="plan" style="margin-top:8px">${esc(plan.why.join(' · '))}</div>
      <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap"><button class="btn tradebtn" data-ticket='${esc(JSON.stringify({ symbol: sym, side: plan.dir === 'long' ? 'buy' : 'sell', qty: sym.includes('/') ? plan.units : plan.shares, stop_loss: sym.includes('/') ? '' : plan.stop, take_profit: sym.includes('/') ? '' : plan.target, px: plan.px }))}'>Place this trade</button>${sym.includes('/') ? '' : `<button class="btn primary" id="d-opt">Build option idea</button><button class="btn" id="d-optl">Long ${plan.dir === 'long' ? 'call' : 'put'}</button>`}</div><div id="d-optbox"></div></div></section>` : ''}
    ${sym.includes('/') ? '' : `<section class="panel"><div class="ph"><h2>${esc(sym)} headlines</h2></div><div id="d-news">${det.news ? newsList(det.news, 8, false) : loading}</div></section>`}</div>`;
  $('#d-close').onclick = () => $('#detail').hidden = true;
  $('#drawer').classList.toggle('full', !!LS.get('full', false));
  $('#d-full').onclick = () => { LS.set('full', !LS.get('full', false)); drawDetail(); };
  $('#d-tf').onclick = e => { const b = e.target.closest('[data-range]'); if (!b) return; det.range = b.dataset.range; LS.set('range', det.range); det.data = null; drawDetail(); fetchDetail(); };
  const ol = $('#d-optl'); if (ol) ol.onclick = async () => { $('#d-optbox').innerHTML = '<div class="empty">Building…</div>'; const r = await api('options', { symbol: sym, strategy: plan.dir === 'long' ? 'call' : 'put', target: plan.target }); $('#d-optbox').innerHTML = `<div class="cards" style="padding:10px 0 0">${optCard({ j: r, from: plan.setup })}</div>`; };
  const ob = $('#d-opt'); if (ob) ob.onclick = async () => { $('#d-optbox').innerHTML = '<div class="empty">Building…</div>'; const r = await api('options', { symbol: sym, dir: plan.dir, target: plan.target }); $('#d-optbox').innerHTML = `<div class="cards" style="padding:10px 0 0">${optCard({ j: r, from: plan.setup })}</div>`; };
  if (j?.bars) detChart(j, plan);
}
function statRow() { const q = det.data?.quote, st = det.stats || {}; return `<div class="stats" id="d-stats">${[['Open', fp(q?.o)], ['High', fp(q?.h)], ['Low', fp(q?.l)], ['VWAP', fp(q?.vw)], ['RSI 14', st.rsi ?? '—'], ['ATR 14', fp(st.atr)], ['SMA 50', fp(st.s50)], ['SMA 200', fp(st.s200)], ['52w high', fp(st.hi52)], ['52w low', fp(st.lo52)]].map(([a, b]) => `<div class="stat"><span>${a}</span><b>${b}</b></div>`).join('')}</div>`; }
function detChart(j, plan) {
  const box = $('#cvbox'); if (!box) return;
  const ch = tvChart(box, { title: `${det.sym} · ${RLBL[det.range] || det.range}` });
  const c = j.bars.map(b => b.c);
  const lines = [[20, '#2962ff'], [50, '#ff9800'], [200, '#e040fb']].map(([n, color]) => ({ name: 'MA' + n, color, vals: smaSeries(c, n) }));
  const plines = plan ? [{ price: plan.stop, color: '#ef5350', label: 'STOP', fit: true }, { price: plan.target, color: '#26a69a', label: 'TARGET', fit: true }, { price: plan.px, color: '#8b93a7', label: 'ENTRY', dash: [2, 3], tag: false }] : [];
  ch.set(j.bars, { from: j.from, intraday: j.intraday, crypto: det.sym.includes('/'), lines, plines });
}
/* ---------- TradingView-style chart engine (canvas, no library) ---------- */
// Candles or area, volume overlay, right price scale with last-price tag, crosshair with axis labels,
// OHLC legend, zoom (wheel or pinch), drag to pan, double-click to reset, price lines, HTML markers, pulsing last price.
// Charts stay inert (the page scrolls over them) until clicked/tapped; click outside or Esc releases. o.live = always interactive.
const TV = { up: '#26a69a', dn: '#ef5350', upV: 'rgba(38,166,154,.38)', dnV: 'rgba(239,83,80,.38)', grid: '#1a1e29', axis: '#8b93a7', cross: '#758696', bg: '#0b0e14', tag: '#363a45' };
const MONO = '"IBM Plex Mono",ui-monospace,Consolas,monospace';
function niceStep(range, n) { const raw = range / Math.max(1, n), p = 10 ** Math.floor(Math.log10(raw)), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }
function smaSeries(c, n) { const o = []; let s = 0; for (let i = 0; i < c.length; i++) { s += c[i]; if (i >= n) s -= c[i - n]; o.push(i >= n - 1 ? s / n : null); } return o; }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const h12 = (a) => `${a.hh % 12 || 12}:${String(a.mi).padStart(2, '0')} ${a.hh < 12 ? 'AM' : 'PM'}`; // chart times in 12-hour Eastern
function tzParts(t, crypto) { const d = new Date(t); const s = d.toLocaleString('en-US', { timeZone: crypto ? 'UTC' : 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }); const [md, hm] = s.split(', '); const [mo, da, yr] = md.split('/').map(Number); const [hh, mi] = hm.split(':').map(Number); return { yr, mo, da, hh: hh % 24, mi }; }
function tvChart(box, o = {}) {
  box.classList.add('tv'); box.classList.remove('live');
  box.innerHTML = `<canvas></canvas><div class="tvleg"></div><div class="tvmk"></div>${o.pulse ? '<i class="tvdot" hidden></i>' : ''}<div class="tvhint"></div>`;
  const cv = box.querySelector('canvas'), leg = box.querySelector('.tvleg'), mk = box.querySelector('.tvmk'), dot = box.querySelector('.tvdot'), hint = box.querySelector('.tvhint');
  const S = { bars: [], lines: [], plines: [], marks: [], v0: 0, v1: 1, hover: null, touched: false, from: null, intraday: false, crypto: false, live: false };
  const coarse = matchMedia('(pointer:coarse)').matches, fixed = !!o.live, pts = new Map(); let pinch = null, tap = null;
  const HINT = { off: coarse ? 'Tap chart to zoom & pan' : 'Click chart to zoom & pan', on: coarse ? 'Drag to pan · pinch to zoom · tap outside to release' : 'Scroll to zoom · drag to pan · double-click resets · Esc releases' };
  const outside = e => { if (!box.contains(e.target)) setLive(false); };
  const onKey = e => { if (e.key === 'Escape' && S.live) { e.stopPropagation(); setLive(false); } };
  function setLive(on) {
    if (fixed || S.live === on) return; S.live = on; box.classList.toggle('live', on); hint.textContent = on ? HINT.on : HINT.off;
    if (on) { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', onKey, true); }
    else { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', onKey, true); drag = null; pinch = null; pts.clear(); S.hover = null; redraw(); }
  }
  if (fixed) { S.live = true; box.classList.add('live'); } else hint.textContent = HINT.off;
  const R = 64, B = 22, T = 6;
  let W = 0, H = 0, g = null, drag = null;
  const mode = o.mode || 'candle', vol = o.volume !== false;
  function size() { const dpr = window.devicePixelRatio || 1; W = cv.clientWidth; H = cv.clientHeight; if (!W || !H) return false; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); return true; }
  function defaultView() {
    const n = S.bars.length; let i0 = 0;
    if (S.from) { const f = new Date(S.from).getTime(); i0 = S.bars.findIndex(b => new Date(b.t).getTime() >= f); if (i0 < 0) i0 = Math.max(0, n - 60); }
    const shown = Math.max(8, n - i0); S.v0 = i0 - 0.5; S.v1 = n - 0.5 + Math.max(1.5, shown * 0.05);
  }
  function clampV() { const n = S.bars.length, span = S.v1 - S.v0; if (S.v1 > n + span * 0.6) { S.v1 = n + span * 0.6; S.v0 = S.v1 - span; } if (S.v0 < -span * 0.6) { S.v0 = -span * 0.6; S.v1 = S.v0 + span; } }
  const fmtT = (t, prev) => {
    const a = tzParts(t, S.crypto && !S.intraday);
    if (!S.intraday) { const p = prev ? tzParts(prev, S.crypto) : null; if (!p || p.yr !== a.yr) return a.mo === 1 || !p ? String(a.yr) : MON[a.mo - 1]; if (p.mo !== a.mo) return MON[a.mo - 1]; return String(a.da); }
    const p = prev ? tzParts(prev, S.crypto && !S.intraday) : null; if (!p || p.da !== a.da) return `${MON[a.mo - 1]} ${a.da}`;
    return h12(a);
  };
  const fmtFull = (t) => { const a = tzParts(t, S.crypto && !S.intraday); return S.intraday ? `${MON[a.mo - 1]} ${a.da} '${String(a.yr).slice(2)} ${h12(a)} ET` : `${MON[a.mo - 1]} ${a.da} '${String(a.yr).slice(2)}`; };
  function tag(y, text, bg, fg = '#fff') { g.font = `600 11px ${MONO}`; const w = R - 2, h = 17; g.fillStyle = bg; g.fillRect(W - R + 1, y - h / 2, w, h); g.fillStyle = fg; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(text, W - R + 5, y + 0.5); }
  function draw() {
    if (!g && !size()) return; if (!W || !H) return;
    g.fillStyle = o.bg || TV.bg; g.fillRect(0, 0, W, H);
    const n = S.bars.length; if (!n) { leg.innerHTML = ''; return; }
    const pw = W - R, ph = H - B - T, span = S.v1 - S.v0, bw = pw / span;
    const X = i => (i - S.v0) * bw;
    const i0 = Math.max(0, Math.floor(S.v0)), i1 = Math.min(n - 1, Math.ceil(S.v1));
    let lo = Infinity, hi = -Infinity, vmax = 0;
    for (let i = i0; i <= i1; i++) { const b = S.bars[i]; if (mode === 'area') { lo = Math.min(lo, b.c); hi = Math.max(hi, b.c); } else { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); } vmax = Math.max(vmax, b.v || 0); }
    for (const p of S.plines) if (p.fit && isFinite(p.price)) { lo = Math.min(lo, p.price); hi = Math.max(hi, p.price); }
    if (!isFinite(lo)) return;
    if (hi === lo) { const d = Math.abs(hi) * 0.01 || 1; hi += d; lo -= d; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const volH = vol && vmax ? ph * 0.2 : 0, pb = T + ph - (volH ? volH + 6 : 0);
    const Y = v => T + (1 - (v - lo) / (hi - lo)) * (pb - T), P = y => lo + (1 - (y - T) / (pb - T)) * (hi - lo);
    // grid + price scale
    const st = niceStep(hi - lo, Math.max(3, Math.floor((pb - T) / 52)));
    g.lineWidth = 1; g.font = `11px ${MONO}`; g.textBaseline = 'middle'; g.textAlign = 'left';
    for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) { const y = Math.round(Y(v)) + 0.5; g.strokeStyle = TV.grid; g.beginPath(); g.moveTo(0, y); g.lineTo(pw, y); g.stroke(); g.fillStyle = TV.axis; g.fillText(fp(v), pw + 6, y); }
    // time scale
    const k = Math.max(1, Math.ceil(95 / bw)); let prevT = i0 > 0 ? S.bars[Math.max(0, i0 - k)].t : null; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    for (let i = Math.ceil(Math.max(0, S.v0) / k) * k; i <= i1; i += k) { const x = Math.round(X(i)) + 0.5; if (x < 0 || x > pw) continue; g.strokeStyle = TV.grid; g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke(); const txt = fmtT(S.bars[i].t, prevT); prevT = S.bars[i].t; g.fillStyle = TV.axis; g.fillText(txt, Math.min(pw - 20, Math.max(20, x)), H - 6); }
    g.strokeStyle = '#2a2e39'; g.beginPath(); g.moveTo(pw + 0.5, 0); g.lineTo(pw + 0.5, H); g.moveTo(0, T + ph + 0.5); g.lineTo(W, T + ph + 0.5); g.stroke();
    g.save(); g.beginPath(); g.rect(0, 0, pw, T + ph); g.clip();
    // volume
    if (volH) for (let i = i0; i <= i1; i++) { const b = S.bars[i]; const h = (b.v || 0) / vmax * volH; g.fillStyle = b.c >= b.o ? TV.upV : TV.dnV; const w = Math.max(1, bw * 0.72); g.fillRect(X(i) - w / 2, T + ph - h, w, h); }
    // price
    if (mode === 'area') {
      const col = o.color || '#2962ff'; g.beginPath(); for (let i = i0; i <= i1; i++) { const x = X(i), y = Y(S.bars[i].c); i === i0 ? g.moveTo(x, y) : g.lineTo(x, y); }
      g.strokeStyle = col; g.lineWidth = 2; g.stroke(); g.lineTo(X(i1), pb); g.lineTo(X(i0), pb); g.closePath();
      const gr = g.createLinearGradient(0, T, 0, pb); gr.addColorStop(0, col + '55'); gr.addColorStop(1, col + '00'); g.fillStyle = gr; g.fill(); g.lineWidth = 1;
    } else {
      const w = Math.max(1, bw * 0.72);
      for (let i = i0; i <= i1; i++) { const b = S.bars[i], x = X(i), up = b.c >= b.o; g.strokeStyle = g.fillStyle = up ? TV.up : TV.dn; g.beginPath(); g.moveTo(Math.round(x) + 0.5, Y(b.h)); g.lineTo(Math.round(x) + 0.5, Y(b.l)); g.stroke(); if (bw > 2.5) { const y1 = Y(Math.max(b.o, b.c)), y2 = Y(Math.min(b.o, b.c)); g.fillRect(x - w / 2, y1, w, Math.max(1, y2 - y1)); } }
    }
    for (const L of S.lines) { g.strokeStyle = L.color; g.lineWidth = 1.4; g.beginPath(); let on = false; for (let i = i0; i <= i1; i++) { const v = L.vals[i]; if (v == null) { on = false; continue; } const x = X(i), y = Y(v); on ? g.lineTo(x, y) : g.moveTo(x, y); on = true; } g.stroke(); g.lineWidth = 1; }
    const lab = []; // line labels never draw on top of each other: shift right
    for (const p of S.plines) { if (!isFinite(p.price)) continue; const y = Math.round(Y(p.price)) + 0.5; g.strokeStyle = p.color; g.setLineDash(p.dash || [6, 4]); g.lineWidth = p.width || 1; g.beginPath(); g.moveTo(0, y); g.lineTo(pw, y); g.stroke(); g.setLineDash([]); g.lineWidth = 1; if (p.fill) { g.fillStyle = p.fill; const y2 = Y(p.fillTo); g.fillRect(0, Math.min(y, y2), pw, Math.abs(y2 - y)); }
      if (p.label) { g.font = `600 10.5px ${MONO}`; const w = g.measureText(p.label).width; let x = 6; for (const L of lab) if (Math.abs(L.y - y) < 12 && x < L.x + L.w + 8) x = L.x + L.w + 8; if (x + w < pw - 4) { g.fillStyle = p.color; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText(p.label, x, y - 2); lab.push({ x, y, w }); } } }
    g.restore();
    const last = S.bars[n - 1], prevC = n > 1 ? S.bars[n - 2].c : last.o, lastCol = mode === 'area' ? (o.color || '#2962ff') : last.c >= (o.lastVsPrev ? prevC : last.o) ? TV.up : TV.dn;
    { const y = Math.round(Y(last.c)) + 0.5; if (y > T && y < pb) { g.strokeStyle = lastCol; g.setLineDash([1, 3]); g.beginPath(); g.moveTo(0, y); g.lineTo(pw, y); g.stroke(); g.setLineDash([]); } }
    const lastY = Math.min(pb, Math.max(T + 8, Y(last.c))), tags = [lastY]; // price tags: the live price wins, others skip if they would overlap
    for (const p of S.plines) if (isFinite(p.price) && p.tag !== false) { const y = Y(p.price); if (y > T - 8 && y < pb + 8) { const yy = Math.min(pb, Math.max(T + 8, y)); if (tags.some(t => Math.abs(t - yy) < 17)) continue; tag(yy, fp(p.price), p.color); tags.push(yy); } }
    tag(lastY, fp(last.c), lastCol);
    // markers (HTML so they can animate)
    const have = new Set();
    for (const m of S.marks) {
      const key = m.key || m.i; have.add(String(key)); let el = mk.querySelector(`[data-k="${key}"]`);
      if (!el) { el = document.createElement('div'); el.className = 'tvm ' + (m.cls || ''); el.dataset.k = key; el.innerHTML = `<div><i></i><b>${esc(m.text)}</b></div>`; mk.appendChild(el); }
      const b = S.bars[m.i]; const x = X(m.i), y = m.price != null ? Y(m.price) : Y(b ? b.l : last.c);
      el.hidden = !b || x < 0 || x > pw; el.style.transform = `translate(${x}px,${Math.min(pb, y) + 4}px)`;
    }
    mk.querySelectorAll('.tvm').forEach(el => { if (!have.has(el.dataset.k)) el.remove(); });
    if (dot) { const x = X(n - 1), y = Y(last.c); dot.hidden = x < 0 || x > pw || y < T || y > pb; dot.style.transform = `translate(${x}px,${y}px)`; dot.style.setProperty('--c', lastCol); }
    // crosshair
    let hb = null;
    if (S.hover) {
      const i = Math.round(S.v0 + S.hover.x / bw); hb = i >= 0 && i < n ? i : null;
      g.strokeStyle = TV.cross; g.setLineDash([4, 4]);
      if (hb != null) { const x = Math.round(X(hb)) + 0.5; g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke(); }
      const y = Math.round(S.hover.y) + 0.5; if (y > T && y < pb) { g.beginPath(); g.moveTo(0, y); g.lineTo(pw, y); g.stroke(); g.setLineDash([]); tag(y, fp(P(y)), TV.tag); }
      g.setLineDash([]);
      if (hb != null) { const txt = fmtFull(S.bars[hb].t); g.font = `11px ${MONO}`; const tw = g.measureText(txt).width + 12, x = Math.min(pw - tw / 2, Math.max(tw / 2, X(hb))); g.fillStyle = TV.tag; g.fillRect(x - tw / 2, T + ph + 1, tw, B - 2); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, x, T + ph + B / 2); }
    }
    const b = S.bars[hb ?? n - 1], pc = (hb ?? n - 1) > 0 ? S.bars[(hb ?? n - 1) - 1].c : b.o, ch = b.c - pc, cc = ch >= 0 ? 'u' : 'd';
    leg.innerHTML = `${o.title ? `<b>${esc(o.title)}</b>` : ''}${mode === 'area' ? `<span class="${cc}">${fp(b.c)}</span>` : `<span>O<em class="${cc}">${fp(b.o)}</em></span><span>H<em class="${cc}">${fp(b.h)}</em></span><span>L<em class="${cc}">${fp(b.l)}</em></span><span>C<em class="${cc}">${fp(b.c)}</em></span>`}<span class="${cc}">${ch >= 0 ? '+' : ''}${fp(ch)} (${ch >= 0 ? '+' : ''}${(ch / pc * 100).toFixed(2)}%)</span>${vol && b.v ? `<span>Vol<em>${b.v >= 1e6 ? (b.v / 1e6).toFixed(2) + 'M' : b.v >= 1e3 ? (b.v / 1e3).toFixed(1) + 'K' : Math.round(b.v)}</em></span>` : ''}${S.lines.map(L => L.name ? `<span style="color:${L.color}">${esc(L.name)} ${L.vals[hb ?? n - 1] == null ? '—' : fp(L.vals[hb ?? n - 1])}</span>` : '').join('')}`;
  }
  let raf = 0; const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const spanOk = sp => Math.max(8, Math.min(S.bars.length * 1.6 + 20, sp));
  function zoomTo(x, sp, v0 = S.v0, v1 = S.v1) { const pw = W - R, at = v0 + x / pw * (v1 - v0); sp = spanOk(sp); S.v0 = at - x / pw * sp; S.v1 = S.v0 + sp; clampV(); S.touched = true; redraw(); }
  cv.addEventListener('wheel', e => { if (!S.live || !S.bars.length) return; e.preventDefault(); zoomTo(pos(e).x, (S.v1 - S.v0) * Math.exp((e.deltaY || e.deltaX) * 0.0016)); }, { passive: false });
  cv.addEventListener('pointerdown', e => {
    const p = pos(e);
    if (!S.live) { tap = { x: p.x, y: p.y, t: Date.now() }; if (e.pointerType === 'mouse') { S.hover = p; redraw(); } return; }
    pts.set(e.pointerId, p); try { cv.setPointerCapture(e.pointerId); } catch {}
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, v0: S.v0, v1: S.v1 }; drag = null; S.hover = null; }
    else if (pts.size === 1) { drag = { x: p.x, v0: S.v0, v1: S.v1 }; S.hover = p; }
    redraw();
  });
  cv.addEventListener('pointermove', e => {
    const p = pos(e);
    if (!S.live) { if (e.pointerType === 'mouse') { S.hover = p; redraw(); } return; }
    if (pts.has(e.pointerId)) pts.set(e.pointerId, p);
    if (pinch && pts.size >= 2) { const [a, b] = [...pts.values()]; zoomTo(pinch.mx, (pinch.v1 - pinch.v0) * pinch.d / (Math.hypot(a.x - b.x, a.y - b.y) || 1), pinch.v0, pinch.v1); return; }
    if (drag && (e.buttons || e.pointerType !== 'mouse')) { const dx = p.x - drag.x; if (Math.abs(dx) > 3) { const sh = dx / (W - R) * (drag.v1 - drag.v0); S.v0 = drag.v0 - sh; S.v1 = drag.v1 - sh; clampV(); S.touched = true; } }
    S.hover = p; redraw();
  });
  const up = e => {
    pts.delete(e.pointerId); if (pts.size < 2) pinch = null; drag = null;
    if (!S.live && tap && e.type === 'pointerup') { const p = pos(e); if (Math.hypot(p.x - tap.x, p.y - tap.y) < 10 && Date.now() - tap.t < 700) setLive(true); }
    tap = null; if (e.pointerType !== 'mouse') { S.hover = null; redraw(); }
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { drag = null; S.hover = null; redraw(); } });
  cv.addEventListener('dblclick', () => { if (!S.live) return; S.touched = false; defaultView(); redraw(); });
  if (window.ResizeObserver) new ResizeObserver(() => { if (size()) draw(); }).observe(cv);
  return {
    set(bars, opt = {}) {
      const grew = S.bars.length && bars.length >= S.bars.length && S.bars[0]?.t === bars[0]?.t;
      S.bars = bars || []; S.from = opt.from ?? S.from; S.intraday = !!opt.intraday; S.crypto = !!opt.crypto;
      S.lines = opt.lines || []; S.plines = opt.plines || []; S.marks = opt.marks || [];
      if (!(opt.keepView && S.touched && grew)) defaultView();
      if (!g) size(); draw();
    },
    reset() { S.touched = false; defaultView(); draw(); },
    release() { setLive(false); },
    get touched() { return S.touched; },
  };
}
/* ---------- maximized chart (full screen, always interactive) ---------- */
const CMAX = { key: null, ch: null };
function openMax(key, title, bars, opt) {
  $('#cmax').hidden = false; $('#cmax-t').textContent = title;
  if (CMAX.key !== key || !CMAX.ch) { CMAX.key = key; CMAX.ch = tvChart($('#cmax-c'), { title, pulse: true, lastVsPrev: true, live: true }); }
  CMAX.ch.set(bars, { ...opt, keepView: true });
}
function closeMax() { $('#cmax').hidden = true; CMAX.key = null; CMAX.ch = null; $('#cmax-c').innerHTML = ''; }
$('#cmax-x').addEventListener('click', closeMax);
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { drawMinis(); if (tab === 'perf') drawPerf(); }, 150); });
