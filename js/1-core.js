// Paper Terminal front end, part 1 (js/1-core.js, 2-views.js, 3-*.js, 4-search-init.js). Plain classic scripts (no build); they share one global scope and load in order from index.html.
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => /^https?:\/\//i.test(String(u ?? '').trim()) ? esc(String(u).trim()) : '#'; // links from feeds: http(s) only, never javascript:
const LS = { get(k, d) { try { const v = localStorage.getItem('tb.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('tb.' + k, JSON.stringify(v)); } catch {} } };
const cfg = { authed: false, gate: '', riskSwing: LS.get('riskSwing', 1000), riskDay: LS.get('riskDay', 500), watch: LS.get('watch', ['AAPL', 'NVDA', 'TSLA', 'BTC/USD']) };

/* ---------- formatting ---------- */
const fp = (p) => p == null || !isFinite(p) ? '—' : Math.abs(p) >= 1000 ? p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.abs(p) >= 1 ? p.toFixed(2) : Math.abs(p) >= 0.01 ? p.toFixed(4) : p.toPrecision(3);
const fpct = (v, d = 2) => v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + '%';
const cls = v => v > 0 ? 'up' : v < 0 ? 'down' : 'muted';
const f$ = v => { if (v == null) return '—'; const a = Math.abs(v), d = a > 0 && a < 10 ? 2 : 0; return (v < 0 ? '−$' : '$') + a.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }; // cents under $10 (a +$0.31 take profit no longer shows as $0)
const ago = t => { if (!t) return ''; const s = (Date.now() - new Date(t)) / 1000; return s < 60 ? Math.round(s) + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago'; };
const scoreCell = s => `<span class="score"><i style="--w:${s}%"></i>${s}</span>`;
const spk = (a) => { if (!a || a.length < 2) return ''; const w = 84, h = 18, lo = Math.min(...a), hi = Math.max(...a); const d = a.map((v, i) => `${i ? 'L' : 'M'}${(i / (a.length - 1) * w).toFixed(1)},${(h - 2 - (hi === lo ? .5 : (v - lo) / (hi - lo)) * (h - 4)).toFixed(1)}`).join(''); return `<svg class="spk" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="${a.at(-1) >= a[0] ? '#35d07f' : '#ff4d4d'}" stroke-width="1.3"/></svg>`; };
// v0.17.1: live money mode (lib/trade.js tradingMode, reported by /api/health to signed-in devices). acctName() is the label every
// money screen uses; the red banner (liveBanner) is always on while real money is live.
const isLive = () => !!state.health?.trading?.live;
const acctName = (cap) => isLive() ? (cap ? 'LIVE ACCOUNT' : 'live account (real money)') : (cap ? 'Paper Account' : 'paper account');
function liveBanner() { const T = state.health?.trading, on = !!T?.live; document.body.classList.toggle('live-money', on); let b = $('#livebar'); if (!on) { b?.remove(); return; }
  if (!b) { b = document.createElement('div'); b.id = 'livebar'; b.setAttribute('role', 'alert'); document.body.prepend(b); } b.textContent = `REAL MONEY · live trading is on · the bots may have up to $${T.cap} in the market`; }
// v0.17.1: the app's name comes from the server (APP_NAME in Vercel, else lib/version.js), so a friend's copy shows its own name.
function brand() { const n = state.health?.app; if (!n) return; document.title = n; const b = $('.brand'); if (b) b.textContent = n.toUpperCase(); }
const dirTag = d => `<span class="tag ${d === 'long' ? 't-long' : 't-short'}">${d === 'long' ? 'LONG' : 'SHORT'}</span>`;

/* ---------- api ---------- */
const state = {};
// v0.17.0: no token in the URL. The browser sends the HttpOnly session cookie by itself; market routes also get today's
// market-data key as a header (it keys the CDN cache). A 401 on a market route re-reads the session once (new day's key).
try { localStorage.removeItem('tb.token'); } catch {} // the old URL token (before v0.17.0) is no longer used
async function sessionLoad() {
  const r = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' }).then(x => x.json()).catch(() => null);
  cfg.authed = !!r?.authorized; cfg.gate = r?.gate || ''; state.session = r; return r;
}
async function call(path, params, init = {}, retry = true) {
  const q = new URLSearchParams(params), headers = { ...(init.headers || {}) }; if (cfg.gate) headers['x-tb-gate'] = cfg.gate;
  const r = await fetch(`/api/${path}${q.toString() ? '?' + q : ''}`, { ...init, headers, credentials: 'same-origin' });
  let j; try { j = await r.json(); } catch { j = { error: 'bad_response', message: `HTTP ${r.status}` }; }
  if (r.status === 401 && retry && cfg.authed) { await sessionLoad(); if (cfg.authed) return call(path, params, init, false); }
  if (!r.ok && !j.error) j.error = 'http_' + r.status;
  return j;
}
const api = (path, params = {}) => call(path, params);
const apiSend = (path, body, method = 'POST', params = {}) => call(path, params, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const msg = (j) => j.error === 'locked' ? `<div class="empty"><b>Locked.</b> ${esc(j.message)} <button class="btn" data-act="settings">Open settings</button></div>`
  : j.error === 'no_keys' ? `<div class="empty"><b>Not connected yet.</b> ${esc(j.message)}</div>`
  : `<div class="empty err">Couldn't load: ${esc(j.message || j.error)}. It retries automatically.</div>`;

/* ---------- tabs ---------- */
const TABS = [['home', 'HOME', 'Home'], ['bot', 'BOT', 'Bot'], ['dca', 'DCA', 'DCA'], ['swing', 'SWING', 'Swing'], ['intraday', 'INTRADAY', 'Intraday'], ['options', 'OPTIONS', 'Options'], ['long', 'LONG-TERM', 'Long-Term'], ['crypto', 'CRYPTO', 'Crypto'], ['news', 'NEWS', 'News'], ['account', 'ACCOUNT', 'Account'], ['perf', 'BENCHMARK', 'Benchmark'], ['macro', 'MACRO', 'Macro'], ['jev', 'JEV', 'Jev AI']];
const TABKEY = { home: '1', bot: '2', swing: '3', intraday: '4', options: '5', long: '6', crypto: '7', news: '8', account: '9', perf: '0', macro: 'M', jev: 'J', dca: 'D' }; // keyboard shortcut per tab
let tab = TABS.some(t => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : LS.get('tab', 'home');
$('nav.tabs').innerHTML = TABS.map(([id, n, label]) => `<button role="tab" data-tab="${id}" aria-selected="${id === tab}"><b>${TABKEY[id]})</b>${label}</button>`).join('');
$('nav.tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); });
function go(t) { tab = t; LS.set('tab', t); try { history.replaceState(null, '', '#' + t); } catch {} $$('nav.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t)); render(); loadFor(t); window.scrollTo({ top: 0 }); }

/* ---------- loaders ---------- */
const SCHED = { jev: 6e4, botview: 2e4, benchmark: 36e5, performance: 6e4, quotes: 15e3, crypto: 30e3, intraday: 60e3, swing: 6e5, news: 12e4, longterm: 36e5, macro: 36e5, account: 3e4, health: 3e5 };
const NEED = { home: ['quotes', 'swing', 'news', 'account'], dca: ['botview', 'performance', 'benchmark'], swing: ['swing'], intraday: ['intraday'], options: ['swing', 'longterm'], long: ['longterm'], crypto: ['crypto', 'account', 'botview'], bot: ['botview', 'health'], news: ['news'], macro: ['macro'], account: ['account', 'health'], perf: ['benchmark', 'performance', 'health'], jev: ['jev', 'performance'] };
const lastLoad = {}, inflight = {};
const PARAMS = { swing: () => ({ risk: cfg.riskSwing }), intraday: () => ({ risk: cfg.riskDay }), crypto: () => ({ risk: cfg.riskSwing }), quotes: () => ({ symbols: cfg.watch.join(',') }) };
async function load(k, force) {
  if (inflight[k]) return inflight[k];
  if (!force && lastLoad[k] && Date.now() - lastLoad[k] < SCHED[k] * 0.9) return;
  inflight[k] = api(k, PARAMS[k] ? PARAMS[k]() : {}).then(j => { state[k] = j; lastLoad[k] = Date.now(); if (k === 'quotes') { tape(); header(); } if (k === 'health') { liveBanner(); brand(); } render(); if (k === 'swing' || k === 'longterm') autoOptions(); })
    .catch(e => { state[k] = { error: 'network', message: e.message }; render(); }).finally(() => { inflight[k] = null; });
  return inflight[k];
}
function loadFor(t, force) { ['quotes', 'health', ...(NEED[t] || [])].forEach(k => load(k, force)); }
setInterval(() => { if (document.hidden) return; loadFor(tab); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadFor(tab); });
$('#refresh').addEventListener('click', () => { Object.keys(lastLoad).forEach(k => delete lastLoad[k]); loadFor(tab, true); });

/* ---------- header / tape ---------- */
function header() {
  const q = state.quotes; if (!q || q.error) return;
  const c = q.clock || {}; const m = $('#mkt');
  const ph = c.open ? 'open' : (c.phase || 'closed');
  m.className = 'chip ' + (c.open ? 'c-open' : ph === 'pre-market' || ph === 'after-hours' ? 'c-pre' : 'c-closed');
  m.textContent = 'US stocks ' + (c.open ? 'open' : ph.replace('-', ' '));
  $('#livechip').hidden = false; $('#upd').textContent = 'updated ' + new Date(q.at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit' });
}
setInterval(() => { document.querySelectorAll('[data-ago]').forEach(el => { el.textContent = ago(el.dataset.ago); }); }, 5000);
setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit' }) + ' ET'; }, 1000);
function tape() {
  const q = state.quotes; if (!q || q.error) { $('#tape').innerHTML = ''; return; }
  const order = [...q.groups.indices, ...q.groups.crypto.slice(0, 2), 'TLT', 'GLD', 'USO', 'VIXY', 'UUP', ...cfg.watch];
  $('#tape').innerHTML = [...new Set(order)].map(s => q.quotes[s]).filter(Boolean).map(x =>
    `<button class="tk" data-sym="${esc(x.s)}"><span class="sy">${esc(x.s.replace('/USD', ''))}</span><span class="num">${fp(x.p)}</span><span class="num ${cls(x.pct)}">${fpct(x.pct * 100)}</span></button>`).join('');
}

/* ---------- panels ---------- */
const panel = (id, fk, title, meta, body, span = 'span12', note = '') => `<section class="panel ${span}" id="p-${id}"><div class="ph"><span class="fk">${fk}</span><h2>${title}</h2><span class="meta">${meta || ''}</span></div>${body}${note ? `<div class="note">${note}</div>` : ''}</section>`;
const loading = '<div class="empty">Loading…</div>';
const metaAt = j => j && j.at ? 'as of ' + new Date(j.at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET' : '';

function playTable(j, n, kind) {
  if (!j) return loading; if (j.error) return msg(j);
  const rows = (j.plays || []).slice(0, n || 999);
  if (!rows.length) return `<div class="empty">No setups pass the rules right now. That is a valid answer: no trade is better than a forced one.</div>`;
  const intr = kind === 'intraday';
  return `<div class="scroll"><table><thead><tr><th>Symbol</th>${intr ? '' : '<th class="l">Trend</th>'}<th class="l">Setup</th><th>Score</th><th>Price</th><th>Stop</th><th>Target</th><th>${kind === 'crypto' ? 'Units' : 'Shares'}</th>${intr ? '<th>Gap</th><th>RVol</th>' : '<th>RSI</th><th>RS 3m</th>'}${n ? '' : '<th class="l">Why</th>'}</tr></thead><tbody>${rows.map(r =>
    `<tr data-sym="${esc(r.s)}" data-plan='${esc(JSON.stringify(r))}'><td class="sy">${esc(r.s)}</td>${intr ? '' : `<td class="sp">${spk(r.spark)}</td>`}<td class="l">${dirTag(r.dir)} ${esc(r.setup)}</td><td>${scoreCell(r.score)}</td><td>${fp(r.px)}</td><td class="down">${fp(r.stop)}</td><td class="up">${fp(r.target)}</td><td>${kind === 'crypto' ? r.units : r.shares}</td>${intr ? `<td class="${cls(r.gap)}">${fpct(r.gap, 1)}</td><td>${r.rvol ?? '—'}×</td>` : `<td>${r.rsi ?? '—'}</td><td class="${cls(r.rs63)}">${fpct(r.rs63, 1)}</td>`}${n ? '' : `<td class="why">${esc(r.why.join(' · '))}</td>`}</tr>`).join('')}</tbody></table></div>`;
}
function moversTable(j) {
  if (!j || j.error || !j.movers?.length) return '';
  return `<div class="scroll"><table><thead><tr><th>Symbol</th><th>Price</th><th>Change</th><th>Gap</th><th>RVol</th><th>vs VWAP</th></tr></thead><tbody>${j.movers.map(r => `<tr data-sym="${esc(r.s)}"><td class="sy">${esc(r.s)}</td><td>${fp(r.p)}</td><td class="${cls(r.chg)}">${fpct(r.chg)}</td><td class="${cls(r.gap)}">${fpct(r.gap)}</td><td>${r.rvol ?? '—'}×</td><td class="${cls(r.vsVwap)}">${fpct(r.vsVwap)}</td></tr>`).join('')}</tbody></table></div>`;
}
// Company names for the long-term list (name first, then $TICKER); falls back to the search list, then the ticker.
const CO = { AAPL: 'Apple', MSFT: 'Microsoft', NVDA: 'Nvidia', AMZN: 'Amazon', GOOGL: 'Alphabet (Google)', META: 'Meta Platforms', AVGO: 'Broadcom', LLY: 'Eli Lilly', V: 'Visa', MA: 'Mastercard', COST: 'Costco', JPM: 'JPMorgan Chase', UNH: 'UnitedHealth', HD: 'Home Depot', PG: 'Procter & Gamble', KO: 'Coca-Cola', PEP: 'PepsiCo', JNJ: 'Johnson & Johnson', XOM: 'Exxon Mobil',
  ORCL: 'Oracle', CRM: 'Salesforce', ADBE: 'Adobe', NFLX: 'Netflix', ISRG: 'Intuitive Surgical', NOW: 'ServiceNow', INTU: 'Intuit', AMD: 'Advanced Micro Devices', TXN: 'Texas Instruments', QCOM: 'Qualcomm', CAT: 'Caterpillar', DE: 'Deere & Co.', HON: 'Honeywell', LMT: 'Lockheed Martin', MCD: "McDonald's", WMT: 'Walmart', ABBV: 'AbbVie', MRK: 'Merck', TMO: 'Thermo Fisher', SPGI: 'S&P Global', BLK: 'BlackRock',
  VOO: 'Vanguard S&P 500', VTI: 'Vanguard Total Stock Market', QQQ: 'Invesco QQQ (Nasdaq-100)', SCHD: 'Schwab US Dividend Equity', VXUS: 'Vanguard Total International', VIG: 'Vanguard Dividend Appreciation' };
const coName = s => CO[s] || (typeof SYMS !== 'undefined' && SYMS ? (SYMS.find(x => x[0] === s) || [])[1] : '') || '';
const nameCell = (s, etf) => { const nm = coName(s); return `${nm ? `<span class="cn">${esc(nm)}</span>` : ''}<span class="tkr">$${esc(s)}</span>${etf ? ' <span class="tag t-n">ETF</span>' : ''}`; };
function longTable(j, n) {
  if (!j) return loading; if (j.error) return msg(j);
  const rows = (j.picks || []).slice(0, n || 999);
  return `<div class="scroll"><table><thead><tr><th>Company</th><th class="l">Trend</th><th>Score</th><th>Price</th><th class="l">Zone</th><th>Add below</th><th>12-1 mom</th><th>From high</th>${n ? '' : '<th>Rev growth</th><th>Net margin</th><th>Volatility</th><th>vs 200d</th>'}</tr></thead><tbody>${rows.map(r =>
    `<tr data-sym="${esc(r.s)}"><td class="sy">${nameCell(r.s, r.etf)}</td><td class="sp">${spk(r.spark)}</td><td>${scoreCell(r.score)}</td><td>${fp(r.px)}</td><td class="l ${r.zone.startsWith('Wait') ? 'down' : r.zone.startsWith('Buy') ? 'up' : ''}">${esc(r.zone)}</td><td>${fp(r.addBelow)}</td><td class="${cls(r.mom)}">${fpct(r.mom, 1)}</td><td>${fpct(r.fromHigh, 1)}</td>${n ? '' : `<td class="${cls(r.revGrowth)}">${fpct(r.revGrowth, 1)}</td><td>${r.margin == null ? '—' : r.margin.toFixed(1) + '%'}</td><td>${r.vol}%</td><td class="${cls(r.ext)}">${fpct(r.ext, 1)}</td>`}</tr>`).join('')}</tbody></table></div>`;
}
function spark(arr, color) {
  if (!arr || arr.length < 2) return '';
  const w = 200, h = 34, lo = Math.min(...arr), hi = Math.max(...arr), X = i => i / (arr.length - 1) * w, Y = v => h - 3 - (hi === lo ? .5 : (v - lo) / (hi - lo)) * (h - 6);
  const d = arr.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}L${w},${h}L0,${h}Z" fill="${color}" fill-opacity=".12"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}
function newsList(j, n, bar = true) {
  if (!j) return loading; if (j.error) return msg(j);
  const top = bar ? `<div class="botrow" style="justify-content:space-between;align-items:center;border-bottom:1px solid var(--line)"><span class="muted num" style="font-size:12px">Benzinga via Alpaca · auto-refresh every 2 min · updated <span data-ago="${esc(j.at)}">${ago(j.at)}</span></span><button class="btn" data-act="news-refresh">Refresh news</button></div>` : '';
  const items = [...j.items].sort((a, z) => new Date(z.t) - new Date(a.t)); // newest first, by publish time
  return top + `<ul class="news">${items.slice(0, n || 99).map(x => `<li><a href="${safeUrl(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.h)}</a><div class="m"><span>${ago(x.t)}</span><span>${esc(x.src)}</span>${x.syms.map(s => `<button data-sym="${esc(s)}">${esc(s)}</button>`).join('')}</div>${!n && x.sum ? `<p>${esc(x.sum)}</p>` : ''}</li>`).join('') || '<li class="muted">No headlines.</li>'}</ul>`;
}
function botTag(o) { if (!o.coid || !o.coid.startsWith('tbbot')) return ''; const p = o.coid.split('-'); return ` <span class="tag t-n" title="Placed by the bot">BOT${p[3] ? ' · ' + esc(p[3]) : ''}</span>`; }
// v0.16.0: owner tags on the Account tab (routes/account.js decides by order id: tb* = a bot, anything else = you).
function ownTag(x) {
  if (x.own === 'bot') return `<span class="tag own-b" title="Opened by the bot (${esc(x.kind || '')}); Emergency stop closes it">BOT${x.kind ? ' · ' + esc(x.kind) : ''}</span>`;
  if (x.own === 'you') return '<span class="tag own-y" title="You placed this; the bots never touch it">YOURS</span>';
  if (x.own === 'mixed') return `<span class="tag own-m" title="${esc(x.why || '')}">MIXED</span>`;
  if (x.own === 'unknown') return `<span class="tag own-m" title="${esc(x.why || '')}">?</span>`;
  return botTag(x);
}
const occOf = (s) => { const m = /^([A-Z.]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(String(s || '')); return m ? { u: m[1], exp: `20${m[2]}-${m[3]}-${m[4]}`, type: m[5] === 'C' ? 'call' : 'put', k: +m[6] / 1000 } : null; }; // same as routes/account.js occ()
const ordSym = (o) => { const x = occOf(o.s); return x ? optName(x) : esc(o.s || 'spread'); };
const optName = (o) => o ? `${esc(o.u)} ${new Date(o.exp + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' })} $${+o.k % 1 ? o.k.toFixed(2) : o.k} ${o.type}` : '';
function accountView(j, compact) {
  if (!j) return loading; if (j.error) return msg(j);
  const a = j.account, day = a.equity - a.last;
  const tiles = `<div class="stats" style="padding:8px 10px"><div class="stat"><span>Equity</span><b>${f$(a.equity)}</b></div><div class="stat"><span>Today</span><b class="${cls(day)}">${f$(day)} ${fpct(day / a.last * 100)}</b></div><div class="stat"><span>Cash</span><b>${f$(a.cash)}</b></div><div class="stat"><span>Buying power</span><b>${f$(a.bp)}</b></div><div class="stat"><span>Positions</span><b>${j.positions.length}</b></div></div>`;
  const posRows = list => `<div class="scroll"><table><thead><tr><th>Symbol</th><th class="l">Owner</th><th>Side</th><th>Qty</th><th>Avg</th><th>Last</th><th>Value</th><th>P&amp;L</th><th>P&amp;L %</th><th>Today</th>${compact ? '' : '<th></th>'}</tr></thead><tbody>${list.map(p => { const sym = p.cls === 'crypto' && !p.s.includes('/') ? p.s.replace(/USD$/, '/USD') : p.s; return `<tr data-sym="${esc(p.opt ? p.opt.u : sym)}"><td class="sy">${p.opt ? `${optName(p.opt)}<div class="muted" style="font-size:11px">${esc(sym)}</div>` : esc(sym)}</td><td class="l">${ownTag(p)}</td><td>${esc(p.side)}</td><td>${p.qty}</td><td>${fp(p.avg)}</td><td>${fp(p.px)}</td><td>${f$(p.mv)}</td><td class="${cls(p.pl)}">${f$(p.pl)}</td><td class="${cls(p.plpc)}">${fpct(p.plpc)}</td><td class="${cls(p.day)}">${fpct(p.day)}</td>${compact ? '' : `<td><button class="xbtn" data-close="${esc(p.s)}">Close</button></td>`}</tr>`; }).join('')}</tbody></table></div>`;
  const group = (label, list) => { const mv = list.reduce((a, p) => a + (+p.mv || 0), 0), pl = list.reduce((a, p) => a + (+p.pl || 0), 0);
    return `<div class="pb"><div class="sub">${label} positions · ${list.length} <span class="muted" style="text-transform:none;letter-spacing:0">${list.length ? `${f$(mv)} value · <span class="${cls(pl)}">${f$(pl)}</span> P&amp;L` : ''}</span></div></div>${list.length ? posRows(list) : `<div class="empty" style="padding-top:4px">No open ${label.toLowerCase()} positions.</div>`}`; };
  const isOpt = (p) => p.cls === 'us_option' || !!p.opt, mine = j.positions.filter(p => p.own === 'you' || p.own === 'mixed').length;
  const pos = j.positions.length ? `${mine ? `<div class="pb" style="font-size:12.5px;color:var(--ink2)"><b class="amber">${mine} of your own position${mine > 1 ? 's' : ''}</b> (tagged YOURS or MIXED): the bots and Emergency stop never touch these.</div>` : ''}${group('Stock', j.positions.filter(p => p.cls !== 'crypto' && !isOpt(p)))}${group('Options', j.positions.filter(isOpt))}${j.positions.some(isOpt) ? '<div class="note" style="padding:2px 10px 6px">Options: quantity is contracts (1 contract = 100 shares); value and P&amp;L are for the whole position.</div>' : ''}${group('Crypto', j.positions.filter(p => p.cls === 'crypto'))}` : '<div class="empty">No open paper positions.</div>';
  if (compact) return tiles + pos;
  const eq = j.history?.eq?.filter(v => v != null);
  const legs = o => o.legs?.length ? `<div class="muted" style="font-size:11.5px">${o.legs.map(l => `${esc(l.side)} ${esc(l.s)} ${l.limit ? '@' + fp(+l.limit) : l.stop ? 'stop ' + fp(+l.stop) : ''} · ${esc(l.status)}`).join('<br>')}</div>` : '';
  const openT = `<div class="scroll"><table><thead><tr><th>Time</th><th class="l">Symbol</th><th>Side</th><th>Qty</th><th>Type</th><th class="l">Details</th><th>Status</th><th></th></tr></thead><tbody>${(j.open || []).map(o => `<tr><td>${new Date(o.t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td><td class="l sy">${ordSym(o)} ${ownTag(o)}</td><td class="${o.side === 'buy' ? 'up' : 'down'}">${esc(o.side || '')}</td><td>${esc(o.qty)}</td><td>${esc(o.type)}${o.cls && o.cls !== 'simple' ? ' · ' + esc(o.cls) : ''}</td><td class="l">${o.limit ? 'limit ' + fp(+o.limit) : ''}${legs(o)}</td><td>${esc(o.status)}</td><td><button class="xbtn" data-cancel="${esc(o.id)}">Cancel</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted l">No open orders.</td></tr>'}</tbody></table></div>`;
  const ord = `<div class="scroll"><table><thead><tr><th>Time</th><th class="l">Symbol</th><th>Side</th><th>Qty</th><th>Type</th><th>Status</th><th>Fill</th></tr></thead><tbody>${j.orders.slice(0, 40).map(o => `<tr data-sym="${esc(o.s || '')}"><td>${new Date(o.t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td><td class="l sy">${ordSym(o)} ${ownTag(o)}</td><td class="${o.side === 'buy' ? 'up' : 'down'}">${esc(o.side || '')}</td><td>${esc(o.qty)}</td><td>${esc(o.type)}${o.cls && o.cls !== 'simple' ? ' · ' + esc(o.cls) : ''}</td><td>${esc(o.status)}</td><td>${fp(o.fill ? +o.fill : null)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted l">No orders yet.</td></tr>'}</tbody></table></div>`;
  return `<div class="botrow"><button class="btn primary" data-act="ticket">New order</button>${(j.open || []).length ? '<button class="btn" data-act="cancel-all">Cancel all open orders</button>' : ''}</div>` + tiles + (eq && eq.length > 2 ? `<div class="pb"><div class="sub">Equity, 3 months</div>${spark(eq, '#3987e5')}</div>` : '') + `${pos}<div class="pb"><div class="sub">Open orders</div></div>${openT}<div class="pb"><div class="sub">Order history</div></div>${ord}`;
}
function botView() {
  const r = state.botRun;
  const rows = (list, kind) => list.map(x => `<tr data-sym="${esc(x.s)}"><td class="sy">${esc(x.s)}</td><td class="l">${kind === 'placed' ? `${esc(x.setup)} · score ${x.score}${x.filler ? ' · <span class="amber">filler, half size</span>' : ''}` : esc(x.why)}</td>${kind === 'placed' ? `<td>${x.qty}</td><td>${fp(x.entry)}</td><td class="down">${fp(x.stop)}</td><td class="up">${fp(x.target)}</td><td>${f$(x.risk)}</td><td>${x.preview ? '<span class="amber">preview</span>' : esc(x.order?.status || x.status || 'sent')}</td>` : ''}</tr>`).join('');
  const table = (list, kind, title) => list?.length ? `<div class="pb"><div class="sub">${title}</div></div><div class="scroll"><table>${kind === 'placed' ? '<thead><tr><th>Symbol</th><th class="l">Setup</th><th>Qty</th><th>Entry ~</th><th>Stop</th><th>Target</th><th>Risk</th><th>Status</th></tr></thead>' : ''}<tbody>${rows(list, kind)}</tbody></table></div>` : '';
  const trained = (tr, what) => tr ? `<div class="pb" style="font-size:12.5px;color:var(--ink2)"><b class="amber">${what} rules this run:</b> stop ${tr.exits.stop} ATR · target ${tr.exits.target} ATR · max hold ${tr.exits.hold} days · score ${tr.minScore}+ · benchmark ${tr.benchTrades} trades, ${nf(tr.benchWin, 1, '%')} win, ${sgn(tr.benchExpR, 2, 'R')}/trade${tr.blocked?.length ? ` · skipping ${esc(tr.blocked.join(', '))}` : ''}${tr.liveTrades != null ? ` · ${tr.liveTrades} live trades so far` : ''}${tr.proven === false ? ' · <span class="amber">not proven: no new entries</span>' : ''}${tr.probation ? ' · <span class="amber">probation: 1 small trade a day at 0.1% risk until a setting is proven</span>' : ''}</div>` : '';
  const intro = `<div class="pb" style="font-size:12.5px;color:var(--ink2)">No daily minimum (since v0.13.3): the bot only takes setups that clear its trained score bar, so some days have no stock trades. Steady wins over big swings. <b>Schedule (since v0.14.0, times ET):</b> pre-market gap check every 15 minutes from 8:00 AM; open trades watched every 5 minutes while the market is open; new trades at 9:45 AM from yesterday's finished candle (what training tests) and every 15 minutes from 10:00 AM from today's candle so far (tagged, so the two are scored separately); crypto every 5 minutes, day and night. The bot <b>trains</b> after the close (4:20 PM): it replays its rules over ~16 months (about 200 liquid US stocks) under 16 stop/target/hold settings and keeps the steadiest one for the next day. Breakeven rule: once a trade gets half way to its target, the stop moves up to the entry price (plus a small cushion for costs), so a trade that was working cannot turn into a real loss. Stocks: bracket orders (stop + target, good-till-canceled), 0.5% of equity at risk (filler trades below the bar at 0.25% only if a daily minimum is set; off now), max 6 new a day, 15 positions, 10% per stock, never on margin. Crypto: bought through the DCA bot only (swing entries are off unless the Vercel setting CRYPTO_SWING=on; when on: half the risk, max 2 new a day, 4 coins, 15% of equity, a standing stop on every coin). Crypto is checked every 5 minutes, weekends too. It trades the ${acctName()} and never touches positions you opened yourself.</div>`;
  if (!r) return intro;
  if (r.error) return msg(r) + intro;
  const c = r.crypto;
  return `${r.dry ? '<div class="pb amber" style="font-size:12.5px">Preview only: no orders were sent.</div>' : ''}
    ${r.stocksRan ? `<div class="pb"><div class="sub">Stocks</div></div>${r.stocksError ? `<div class="empty err">Stock run failed: ${esc(r.stocksError)}</div>` : ''}${trained(r.training, 'Stock')}
      ${typeof r.skipped === 'string' ? `<div class="empty"><b>No new stock entries:</b> ${esc(r.skipped)}</div>` : ''}
      ${table(r.exits, 'skip', 'Time exits')}${table(r.protect, 'skip', 'Stop/target checks')}${table(r.placed, 'placed', r.dry ? 'Would place' : 'Placed')}
      ${r.placed && !r.placed.length && typeof r.skipped !== 'string' ? '<div class="empty">No new stock trades qualified in this run.</div>' : ''}
      ${r.note ? `<div class="pb amber" style="font-size:12.5px">${esc(r.note)}</div>` : ''}${Array.isArray(r.skipped) ? table(r.skipped, 'skip', 'Passed on') : ''}` : ''}
    ${c ? `<div class="pb"><div class="sub">Crypto</div></div>${c.error ? `<div class="empty err">Crypto run failed: ${esc(c.message)}</div>` : ''}${trained(c.training, 'Crypto')}${table(c.exits, 'skip', 'Exits')}${table(c.protect, 'skip', 'Stops')}${table(c.placed, 'placed', r.dry ? 'Would place' : 'Placed')}${c.note ? `<div class="pb muted" style="font-size:12.5px">${esc(c.note)}</div>` : ''}${table(c.skipped, 'skip', 'Passed on')}` : ''}
    <details class="pb" style="font-size:12.5px"><summary class="muted">How the bot works</summary>${intro}</details>`;
}
function macroView(j) {
  if (!j) return loading; if (j.error) return msg(j);
  return `<div class="cards macro">${j.series.map(s => `<div class="card"><div class="muted" style="font-size:12.5px">${esc(s.name)}</div><div class="v num">${s.v == null ? '—' : (s.unit === '$' ? '$' : '') + s.v + (s.unit === '%' ? '%' : '')}</div><div class="num" style="font-size:12px"><span class="${cls(s.chg)}">${s.chg > 0 ? '+' : ''}${s.chg ?? '—'}</span> <span class="muted">since ${esc(s.since || '')} · ${esc(s.t || '')}</span></div>${spark(s.spark, '#3987e5')}</div>`).join('')}</div>`;
}

/* ---------- benchmark & performance ---------- */
const nf = (v, d = 2, suf = '') => v == null || !isFinite(v) ? '—' : (+v).toFixed(d) + suf;
const sgn = (v, d = 2, suf = '') => v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + suf;
function perfTiles(P, B) {
  const o = (P && !P.error && P.overall) || {}, b = (B && !B.error && B.overallLong) || {};
  const acct = P?.curve?.length ? P.curve.at(-1) : null;
  const t = (l, v, sub, c = '') => `<div class="stat"><span>${l}</span><b class="${c}">${v}</b>${sub ? `<div class="muted num" style="font-size:11.5px">${sub}</div>` : ''}</div>`;
  return `<div class="stats" style="padding:8px 10px">
    ${t('Closed trades', o.n ?? '—', `benchmark ${b.n ?? '—'}`)}
    ${t('Win rate', nf(o.win, 1, '%'), `benchmark ${nf(b.win, 1, '%')}`)}
    ${t('Avg R / trade', sgn(o.expR, 2, 'R'), `benchmark ${sgn(b.expR, 2, 'R')} ±${nf(b.band, 2)}`, cls(o.expR))}
    ${t('Avg return / trade', sgn(o.avgPct, 2, '%'), `benchmark ${sgn(b.avgPct, 2, '%')}`, cls(o.avgPct))}
    ${t('Profit factor', nf(o.pf, 2), `benchmark ${nf(b.pf, 2)}`, o.pf > 1 ? 'up' : o.pf != null ? 'down' : '')}
    ${t('Avg edge vs SPY', sgn(o.alpha, 2, '%'), 'per trade, same dates', cls(o.alpha))}
    ${t('Account vs SPY', acct ? sgn(acct.acct - acct.spy, 2, ' pts') : '—', acct ? `acct ${sgn(acct.acct, 1, '%')} · SPY ${sgn(acct.spy, 1, '%')}` : '3 months', acct ? cls(acct.acct - acct.spy) : '')}
  </div>`;
}
function setupTable(P, B) {
  const names = [...new Set([...Object.keys(B?.bySetup || {}), ...Object.keys(P?.bySetup || {})])];
  if (!names.length) return '<div class="empty">No trades yet.</div>';
  const blocked = n => { const b = B?.bySetup?.[n], l = P?.bySetup?.[n]; return (b && b.n >= 30 && b.expR < 0) || (l && l.n >= 20 && l.expR != null && l.expR < 0); };
  return `<div class="scroll"><table><thead><tr><th>Setup</th><th>Bench trades</th><th>Bench win</th><th>Bench avg R</th><th>Live trades</th><th>Live win</th><th>Live avg R</th><th>Live avg %</th><th>vs SPY</th><th class="l">Bot status</th></tr></thead><tbody>${names.map(n => { const b = B?.bySetup?.[n] || {}, l = P?.bySetup?.[n] || {}; const blk = blocked(n);
    return `<tr><td class="sy">${esc(n)}</td><td>${b.n ?? '—'}</td><td>${nf(b.win, 1, '%')}</td><td class="${cls(b.expR)}">${sgn(b.expR, 2, 'R')}${b.band != null ? ` <span class="muted">±${nf(b.band, 2)}</span>` : ''}</td><td>${l.n ?? 0}</td><td>${nf(l.win, 1, '%')}</td><td class="${cls(l.expR)}">${sgn(l.expR, 2, 'R')}</td><td class="${cls(l.avgPct)}">${sgn(l.avgPct, 2, '%')}</td><td class="${cls(l.alpha)}">${sgn(l.alpha, 2, '%')}</td><td class="l ${blk ? 'down' : n === 'Manual' ? 'muted' : n === 'Breakdown' ? 'muted' : 'up'}">${n === 'Manual' ? 'you' : n === 'Breakdown' ? 'long-only bot' : blk ? 'skipped (losing)' : 'active'}</td></tr>`; }).join('')}</tbody></table></div>`;
}
function trainTable(B) {
  if (!B || B.error) return B ? msg(B) : loading;
  const c = B.chosen || {};
  return `<div class="scroll"><table><thead><tr><th>Stop</th><th>Target</th><th>Max hold</th><th>Trades</th><th>Win</th><th>Avg R</th><th>Avg %</th><th>Profit factor</th><th>Steadiness</th><th class="l"></th></tr></thead><tbody>${(B.training || []).map(v => { const on = v.stop === c.stop && v.target === c.target && v.hold === c.hold;
    return `<tr${on ? ' style="outline:1px solid var(--amber)"' : ''}><td>${v.stop} ATR</td><td>${v.target} ATR</td><td>${v.hold}d</td><td>${v.n}</td><td>${nf(v.win, 1, '%')}</td><td class="${cls(v.expR)}">${sgn(v.expR, 2, 'R')}</td><td class="${cls(v.avgPct)}">${sgn(v.avgPct, 2, '%')}</td><td>${nf(v.pf, 2)}</td><td>${nf(v.cons, 3)}</td><td class="l ${on ? 'amber' : 'muted'}">${on ? '◀ bot uses this' : ''}</td></tr>`; }).join('')}</tbody></table></div>`;
}
function scoreTable(B) {
  if (!B || B.error) return B ? msg(B) : loading;
  const rows = Object.entries(B.byScore || {}).sort((a, z) => parseInt(z[0]) - parseInt(a[0]) || (a[0] === '<50') - (z[0] === '<50'));
  return `<div class="scroll"><table><thead><tr><th>Score</th><th>Trades</th><th>Win</th><th>Avg R</th><th>Avg %</th><th>Profit factor</th><th class="l">Bot</th></tr></thead><tbody>${rows.map(([k, st]) => { const lo = parseInt(k) || 0; const on = lo >= Math.max(55, B.recMinScore);
    return `<tr><td class="sy">${esc(k)}</td><td>${st.n}</td><td>${nf(st.win, 1, '%')}</td><td class="${cls(st.expR)}">${sgn(st.expR, 2, 'R')} <span class="muted">±${nf(st.band, 2)}</span></td><td class="${cls(st.avgPct)}">${sgn(st.avgPct, 2, '%')}</td><td>${nf(st.pf, 2)}</td><td class="l ${on ? 'up' : 'muted'}">${on ? 'trades' : 'skips'}</td></tr>`; }).join('')}</tbody></table></div>`;
}
function journal(P) {
  if (!P) return loading; if (P.error) return msg(P);
  if (!P.trades.length) return '<div class="empty">No closed trades yet. Every trade you or the bot closes lands here with its result against SPY over the same days.</div>';
  const d = t => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `<div class="scroll"><table><thead><tr><th>Closed</th><th class="l">Symbol</th><th class="l">Setup</th><th>Side</th><th>Qty</th><th>Entry</th><th>Exit</th><th>P&amp;L</th><th>Return</th><th>R</th><th>SPY same days</th><th>Edge</th><th class="l">Exit</th><th>Days</th></tr></thead><tbody>${P.trades.map(t => `<tr data-sym="${esc(t.s)}"><td>${d(t.out)}</td><td class="l sy">${esc(t.s)}</td><td class="l">${esc(t.setup)}</td><td>${esc(t.dir)}</td><td>${t.qty}</td><td>${fp(t.entry)}</td><td>${fp(t.exit)}</td><td class="${cls(t.pnl)}">${f$(t.pnl)}</td><td class="${cls(t.pct)}">${sgn(t.pct, 2, '%')}</td><td class="${cls(t.r)}">${t.r == null ? '—' : sgn(t.r, 2, 'R')}</td><td class="${cls(t.spy)}">${sgn(t.spy, 2, '%')}</td><td class="${cls(t.alpha)}">${sgn(t.alpha, 2, '%')}</td><td class="l">${esc(t.why)}</td><td>${t.hold}</td></tr>`).join('')}</tbody></table></div>`;
}
function perfView() {
  const P = state.performance, B = state.benchmark;
  const notes = [...(P?.notes || [])];
  if (B && !B.error) notes.push(`Benchmark: the same rules replayed on ${B.assumptions?.universe} from ${B.from} to ${B.to} made ${sgn(B.overallLong?.expR, 2, 'R')} per long trade (win rate ${nf(B.overallLong?.win, 1, '%')}). Trained exits: stop ${B.chosen?.stop} ATR, target ${B.chosen?.target} ATR, max ${B.chosen?.hold} days. Score ${Math.max(55, B.recMinScore)}+ is where the bot trades (~${B.signalsPerDay} long setups a day across the pool).`);
  notes.push('How it improves: after every close (4:20 PM ET) the bot retrains its exits and score bar on the latest 16 months, and stops trading any setup that is losing money over 30+ benchmark trades or 20+ live trades. Nothing changes on thin evidence.');
  if (P?.season?.label) notes.unshift(`Live numbers count ${P.season.label} only (trades entered since ${P.season.since}: fresh start with the new schedule). Earlier trades stay in the account history.`);
  return { tiles: perfTiles(P, B), notes: `<ul class="pnote">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` };
}
function lineCanvas(cv, series, labels, fmt) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
  cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
  g.font = '11px "IBM Plex Mono", monospace';
  const vals = series.flatMap(s => s.v).filter(v => v != null && isFinite(v));
  if (vals.length < 2) { g.fillStyle = '#8a8a8a'; g.fillText('Not enough closed trades yet to draw this.', 8, H / 2); return; }
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals); const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const m = { l: 6, r: 62, t: 8, b: 18 }, iw = W - m.l - m.r, ih = H - m.t - m.b, n = Math.max(...series.map(s => s.v.length));
  const X = i => m.l + (n < 2 ? 0 : i / (n - 1) * iw), Y = v => m.t + (1 - (v - lo) / (hi - lo)) * ih;
  for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4; g.strokeStyle = '#1e1e1e'; g.beginPath(); g.moveTo(m.l, Y(v)); g.lineTo(W - m.r, Y(v)); g.stroke(); g.fillStyle = '#8a8a8a'; g.fillText(fmt(v), W - m.r + 5, Y(v) + 4); }
  g.strokeStyle = '#555'; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(m.l, Y(0)); g.lineTo(W - m.r, Y(0)); g.stroke(); g.setLineDash([]);
  if (labels?.length) [0, Math.floor((labels.length - 1) / 2), labels.length - 1].forEach((i, k) => { g.fillStyle = '#8a8a8a'; g.textAlign = k === 0 ? 'left' : k === 2 ? 'right' : 'center'; g.fillText(labels[i], X(i), H - 3); }); g.textAlign = 'left';
  for (const s of series) { g.strokeStyle = s.c; g.lineWidth = 2; g.setLineDash(s.dash ? [6, 4] : []); g.beginPath(); let st = false; s.v.forEach((v, i) => { if (v == null) return; st ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)); st = true; }); g.stroke(); g.setLineDash([]);
    const li = s.v.length - 1; if (s.v[li] != null) { g.fillStyle = s.c; g.beginPath(); g.arc(X(li), Y(s.v[li]), 3.5, 0, 7); g.fill(); } }
}
function drawPerf() {
  const P = state.performance, B = state.benchmark;
  const a = document.querySelector('canvas[data-pc="acct"]');
  if (a) { const c = P?.curve || []; lineCanvas(a, [{ v: c.map(x => x.acct), c: '#3987e5' }, { v: c.map(x => x.spy), c: '#d95926' }], c.map(x => x.d.slice(5)), v => v.toFixed(1) + '%'); }
  const r = document.querySelector('canvas[data-pc="roll"]');
  if (r) { const x = P?.roll || []; const base = B?.overallLong?.avgPct; lineCanvas(r, [{ v: x.map(y => y.roll10), c: '#3987e5' }, { v: x.map(() => base ?? null), c: '#d95926', dash: true }], x.map(y => '#' + y.i), v => v.toFixed(1) + '%'); }
  const bc = document.querySelector('canvas[data-pc="bench"]');
  if (bc) { const c = B?.curve || []; lineCanvas(bc, [{ v: c, c: '#3987e5' }], null, v => v.toFixed(0) + 'R'); }
}

