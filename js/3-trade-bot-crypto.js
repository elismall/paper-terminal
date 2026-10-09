// Paper Terminal front end, part 3 of 4. Plain classic scripts (no build); they share one global scope and load in order from index.html.
/* ---------- order ticket ---------- */
function alertBox(m) { const d = document.createElement('div'); d.className = 'errmsg'; d.style.cssText = 'position:fixed;left:12px;right:12px;bottom:16px;z-index:60;margin:0'; d.textContent = m; document.body.appendChild(d); setTimeout(() => d.remove(), 6000); }
let tk = {};
function openTicket(pre) {
  tk = Object.assign({ side: 'buy', type: 'market', tif: 'day' }, pre); tk.stage = 'edit'; tk.result = null;
  if (!tk.px) { const q = state.quotes?.quotes?.[tk.symbol]; if (q) tk.px = q.p; }
  $('#ticket').hidden = false; drawTicket(); tkPrice();
}
let tkTimer;
function tkPrice() {
  clearTimeout(tkTimer); const sym = (tk.symbol || '').toUpperCase();
  if (!sym || tk.kind === 'spread' || /\d{6}[CP]\d{8}$/.test(sym)) return;
  tkTimer = setTimeout(async () => { const j = await api('bars', { symbol: sym, range: '1M' }).catch(() => null); if (j?.quote?.p && (tk.symbol || '').toUpperCase() === sym && !$('#ticket').hidden) { tk.px = j.quote.p; const el = $('#t-px'); if (el) el.textContent = fp(tk.px); } }, 400);
}
function tkKind() { const s = (tk.symbol || '').toUpperCase(); return tk.kind === 'spread' ? 'spread' : s.includes('/') ? 'crypto' : /^[A-Z.]{1,6}\d{6}[CP]\d{8}$/.test(s) ? 'option' : 'stock'; }
function drawTicket() {
  const k = tkKind(), v = x => x == null ? '' : esc(x);
  const locked = !cfg.authed || (state.health && state.health.locked === false);
  let body = '';
  if (k === 'spread') body = `<div class="field"><span>Order</span><b style="color:#fff">${esc(tk.label || 'Option spread')}</b><small>Two legs sent together as one order. The most you can lose is the net debit you pay.</small></div>
    <div class="tk-row"><div class="field"><label for="t-qty">Spreads</label><input class="in big" id="t-qty" type="number" min="1" step="1" value="${v(tk.qty || 1)}"></div><div class="field"><label for="t-lim">Limit (net debit per spread)</label><input class="in big" id="t-lim" type="number" step="0.01" value="${v(tk.limit_price)}"></div></div>`;
  else body = `<div class="tk-row"><div class="field"><label for="t-sym">Symbol</label><input class="in big" id="t-sym" value="${v(tk.symbol)}" placeholder="AAPL, BTC/USD" style="text-transform:uppercase"></div>
      <div class="field"><label>Last price</label><div class="in big" id="t-px" style="border-color:transparent">${fp(tk.px)}</div></div></div>
    <div class="sidebtn"><button data-side="buy" aria-pressed="${tk.side === 'buy'}">BUY</button><button data-side="sell" aria-pressed="${tk.side === 'sell'}">SELL${k === 'stock' ? ' / SHORT' : ''}</button></div>
    <div class="tk-row"><div class="field"><label for="t-qty">${k === 'option' ? 'Contracts' : k === 'crypto' ? 'Quantity (coins)' : 'Shares'}</label><input class="in big" id="t-qty" type="number" min="0" step="any" inputmode="decimal" value="${v(tk.qty)}"></div>
      ${k === 'crypto' ? `<div class="field"><label for="t-not">or dollar amount</label><input class="in big" id="t-not" type="number" min="0" step="1" inputmode="decimal" value="${v(tk.notional)}" placeholder="$"></div>` : ''}
      <div class="field"><label for="t-type">Order type</label><select class="in big" id="t-type"><option value="market" ${tk.type === 'market' ? 'selected' : ''}>Market</option><option value="limit" ${tk.type === 'limit' ? 'selected' : ''}>Limit</option></select></div>
      <div class="field" id="t-limwrap" ${tk.type === 'limit' ? '' : 'hidden'}><label for="t-lim">Limit price</label><input class="in big" id="t-lim" type="number" step="0.01" inputmode="decimal" value="${v(tk.limit_price)}"></div></div>
    ${k === 'stock' ? `<div class="tk-row"><div class="field"><label for="t-sl">Stop-loss (optional)</label><input class="in big" id="t-sl" type="number" step="0.01" inputmode="decimal" value="${v(tk.stop_loss)}"></div><div class="field"><label for="t-tp">Take-profit (optional)</label><input class="in big" id="t-tp" type="number" step="0.01" inputmode="decimal" value="${v(tk.take_profit)}"></div>
      <div class="field"><label for="t-tif">Good for</label><select class="in big" id="t-tif"><option value="day" ${tk.tif === 'day' ? 'selected' : ''}>Today</option><option value="gtc" ${tk.tif === 'gtc' ? 'selected' : ''}>Until cancelled</option></select></div></div>` : ''}
    ${k === 'option' ? '<div class="field"><small>Option orders are good for today. Selling a put without owning it needs enough cash to buy 100 shares per contract.</small></div>' : ''}
    ${k === 'crypto' ? '<div class="field"><small>Crypto trades 24/7. Stop-loss and target brackets are not available for crypto at Alpaca, so set a separate order to exit.</small></div>' : ''}`;
  const est = k === 'stock' && tk.px && +tk.qty ? `<small>Estimated value ${f$(tk.px * tk.qty)}${tk.stop_loss ? ` · risk to stop ${f$(Math.abs(tk.px - tk.stop_loss) * tk.qty)}` : ''}</small>` : '';
  const review = tk.stage === 'review' && tk.preview ? `<div class="review"><b style="color:var(--amber)">Review · ${isLive() ? 'LIVE ACCOUNT, REAL MONEY' : 'PAPER account'}</b>${Object.entries(tk.preview).filter(([key]) => key !== 'legs').map(([key, val]) => `<span>${esc(key)}: ${esc(typeof val === 'object' ? JSON.stringify(val) : val)}</span>`).join('')}${(tk.preview.legs || []).map(l => `<span>leg: ${esc(l.side)} ${esc(l.symbol)}</span>`).join('')}</div>` : '';
  const res = tk.result ? (tk.result.error ? `<div class="errmsg">${esc(tk.result.message || tk.result.error)}</div>` : `<div class="okmsg">Sent. Status: ${esc(tk.result.order?.status)} · ${esc(tk.result.order?.s || '')} ${esc(tk.result.order?.side || '')} ${esc(tk.result.order?.qty || '')}</div>`) : '';
  $('#tkbox').innerHTML = `<h2 id="tk-h">Order ticket · ${isLive() ? '<span class="down">LIVE · REAL MONEY</span>' : 'paper'}</h2>${locked ? '<div class="errmsg">Trading needs your passcode. Set DASH_PASSCODE in Vercel, then enter it in Settings.</div>' : ''}${body}<div class="field">${est}</div>${review}${res}
    <div class="row" style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button class="btn" id="t-cancel">${tk.result && !tk.result.error ? 'Done' : 'Cancel'}</button>${tk.result && !tk.result.error ? '' : tk.stage === 'review' ? '<button class="btn" id="t-back">Edit</button><button class="btn primary big" id="t-send">' + (isLive() ? 'Confirm REAL-MONEY order' : 'Confirm paper order') + '</button>' : '<button class="btn primary big" id="t-review">Review order</button>'}</div>`;
  const bind = (id, key, fn) => { const el = $(id); if (el) el.oninput = el.onchange = () => { tk[key] = el.value; if (fn) fn(); }; };
  bind('#t-sym', 'symbol', () => { tk.symbol = tk.symbol.toUpperCase(); const q = state.quotes?.quotes?.[tk.symbol]; tk.px = q?.p; const el = $('#t-px'); if (el) el.textContent = fp(tk.px); tkPrice(); });
  bind('#t-qty', 'qty'); bind('#t-not', 'notional'); bind('#t-lim', 'limit_price'); bind('#t-sl', 'stop_loss'); bind('#t-tp', 'take_profit'); bind('#t-tif', 'tif');
  const ty = $('#t-type'); if (ty) ty.onchange = () => { tk.type = ty.value; $('#t-limwrap').hidden = ty.value !== 'limit'; };
  $$('.sidebtn button').forEach(b => b.onclick = () => { tk.side = b.dataset.side; drawTicket(); });
  $('#t-cancel').onclick = () => { $('#ticket').hidden = true; if (tk.result && !tk.result.error) { delete lastLoad.account; load('account', true); } };
  const clean = () => { const { preview, result, stage, label, px, maxLoss, ...o } = tk; return o; };
  const rv = $('#t-review'); if (rv) rv.onclick = async () => { tk.result = null; const r = await apiSend('order', { ...clean(), preview: true }); if (r.error) { tk.result = r; drawTicket(); return; } tk.preview = r.preview; tk.stage = 'review'; drawTicket(); };
  const bk = $('#t-back'); if (bk) bk.onclick = () => { tk.stage = 'edit'; drawTicket(); };
  const sd = $('#t-send'); if (sd) sd.onclick = async () => { sd.disabled = true; sd.textContent = 'Sending…'; tk.result = await apiSend('order', clean()); if (!tk.result.error) tk.stage = 'done'; drawTicket(); delete lastLoad.account; load('account', true); };
}
$('#ticket').addEventListener('click', e => { if (e.target.id === 'ticket') $('#ticket').hidden = true; });
/* ---------- Bot tab: live bot trades, reasoning, animated charts, activity feed ---------- */
const BT = { charts: {}, last: {}, seenEv: null, seenTr: null, arm: null, busy: null, list: null };
// v0.14.0: the day runs on a 5-minute heartbeat (lib/schedule.js). Stock times are ET on weekdays; market holidays and early
// closes are handled on the server (Alpaca's calendar), so this list can show a stock run on a holiday that then only checks crypto.
const SCHED_ET = [[480, 'Pre-market gap check'], [495, 'Pre-market gap check'], [510, 'Pre-market gap check'], [525, 'Pre-market gap check'], [540, 'Pre-market gap check'], [555, 'Pre-market gap check'], [565, 'Pre-market gap check (final)'],
  [585, 'Morning entries (yesterday\'s finished candle)'], ...Array.from({ length: 24 }, (_, i) => [600 + i * 15, 'Scan for new trades (today\'s candle)']), [980, 'Wrap-up: retrain on the finished candle']];
const etParts = (ms) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(new Date(ms)); const g = k => p.find(x => x.type === k)?.value; return { day: `${g('year')}-${g('month')}-${g('day')}`, min: (+g('hour') % 24) * 60 + +g('minute'), wd: g('weekday') }; };
const etAt = (day, min) => { for (const off of [4, 5]) { const t = Date.parse(`${day}T00:00:00Z`) + (min + off * 60) * 6e4; const e = etParts(t); if (e.day === day && e.min === min) return t; } return Date.parse(`${day}T00:00:00Z`) + (min + 240) * 6e4; };
function nextRuns(n = 2) {
  const out = [], now = Date.now();
  for (let d = 0; d < 8 && out.length < n; d++) {
    const e = etParts(now + d * 864e5); if (['Sat', 'Sun'].includes(e.wd)) continue;
    for (const [m, what] of SCHED_ET) { const t = etAt(e.day, m); if (t > now) out.push({ t: new Date(t), what }); }
  }
  return out.sort((a, z) => a.t - z.t).slice(0, n);
}
const etTime = t => new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' });
const pips = (n, goal) => Array.from({ length: Math.max(goal, n) }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
function botShell() {
  return `<div class="grid" id="botroot">
    ${controlShell()}
    <section class="panel span12"><div class="ph"><span class="fk">02)</span><h2>${isLive() ? 'Bot · REAL MONEY' : 'Paper bot · live'}</h2><span class="meta" id="bt-meta"></span></div><div id="bt-top"></div></section>
    <div class="span12 btsec"><div class="ph"><span class="fk">S)</span><h2>Open stock trades</h2><span class="meta" id="bt-ns"></span></div><div class="btcards" id="bt-cards-s"></div></div>
    <div class="span12 btsec" id="bt-csec" hidden><div class="ph"><span class="fk">C)</span><h2>Open crypto swing trades</h2><span class="meta" id="bt-nc"></span></div><div class="btcards" id="bt-cards-c"></div></div>
    <section class="panel span12" id="bt-dcaline"></section>
    <section class="panel span6"><div class="ph"><span class="fk">03)</span><h2>Activity</h2><span class="meta">orders the bot sent, fills, stops, targets, time exits</span></div><ol class="feed" id="bt-feed"></ol></section>
    <section class="panel span6"><div class="ph"><span class="fk">04)</span><h2>Last run</h2><span class="meta" id="bt-runmeta"></span></div><div id="bt-run"></div></section></div>`;
}
function botTop(v) {
  const t = v && !v.error ? v.today : null, nr = nextRuns(2), h = state.health || {};
  const tile = (l, val, sub, c = '') => `<div class="stat"><span>${l}</span><b class="${c}">${val}</b>${sub ? `<div class="muted num" style="font-size:11.5px">${sub}</div>` : ''}</div>`;
  const tap = (k, l, val, sub, c = '') => `<button class="stat stbtn" data-btlist="${k}" aria-expanded="${BT.list === k}" ${t ? '' : 'disabled'}><span>${l} <i aria-hidden="true">${BT.list === k ? '▴' : '▾'}</i></span><b class="${c}">${val}</b>${sub ? `<div class="muted num" style="font-size:11.5px">${sub}</div>` : ''}</button>`;
  const busy = BT.busy ? `<div class="btbusy"><div class="bar"><i></i></div><span>${esc(BT.busy)}</span></div>` : '';
  const armed = (k, label) => BT.arm === k ? `Tap again: ${label}` : null;
  const ok = v && !v.error, deals = ok ? v.dca?.deals || [] : [], nOpen = ok ? v.trades.length + deals.length : 0, plOpen = ok ? (v.openPnl || 0) + (v.dcaOpenPnl || 0) : 0;
  const swingOn = ok ? v.cryptoSwing : h.cryptoSwing;
  return `<div class="stats" style="padding:8px 10px">
      ${tap('stocks', 'Stock trades today', t ? `${t.stocks} <span class="pips">${pips(t.stocks, t.goal || t.cap || 6)}</span>` : '—', t ? `${t.goal ? `goal ${t.goal}+ a day` : `no daily minimum · max ${t.cap || 6}`} · tap for list` : '')}
      ${swingOn ? tap('crypto', 'Crypto buys today', t ? `${t.cryptoBuys ?? t.crypto}` : '—', 'swing + DCA · tap for list') : ''}
      ${tap('open', 'Open now', ok ? `${nOpen} <span class="${cls(plOpen)}" style="font-size:13px">${f$(plOpen)}</span>` : '—', ok ? `${v.trades.length} swing · ${deals.length} DCA · tap for list` : '', '')}
      ${tap('closed', 'Closed today', t ? `${t.closed} <span class="${cls(t.closedPnl)}" style="font-size:13px">${f$(t.closedPnl)}</span>` : '—', t ? 'realized · tap for list' : '')}
      ${tile('Next stock run', nr[0] ? etTime(nr[0].t) + ' ET' : '—', nr[0] ? esc(nr[0].what) + ' · open trades watched every 5 min, crypto every 5 min' : '')}
      ${tile('Status', h.botPaused || CT.data?.mode === 'pause' ? '<span class="down">Paused</span>' : h.cron ? '<span class="up">Scheduled</span>' : '<span class="amber">Manual only</span>', v?.market ? (v.market.open ? 'US market open' : 'US market closed · crypto 24/7') : '')}
    </div>
    ${BT.list && ok ? btList(v, BT.list) : ''}
    <div class="botrow btctl"><span class="lbl">Run stock trades now</span>${[1, 2, 3].map(n => `<button class="btn ${BT.arm === 's' + n ? 'arm' : 'primary'}" data-botrun="s${n}" ${BT.busy ? 'disabled' : ''}>${armed('s' + n, `place up to ${n}`) || n}</button>`).join('')}
      <span class="lbl">·</span><button class="btn ${BT.arm === 'c' ? 'arm' : ''}" data-botrun="c" ${BT.busy ? 'disabled' : ''}>${armed('c', 'run crypto check') || 'Run crypto check now'}</button>
      <button class="btn ${BT.arm === 'd' ? 'arm' : ''}" data-botrun="d" ${BT.busy ? 'disabled' : ''}>${armed('d', 'run DCA') || 'Run DCA now'}</button>
      <button class="btn" data-botrun="dry" ${BT.busy ? 'disabled' : ''}>Preview (no orders)</button></div>${busy}
    ${v?.error ? msg(v) : ''}`;
}
// Tile lists: what is open now, what closed today, what the bots bought today. Rows wrap; nothing overlaps on a phone.
function btList(v, k) {
  const tm = (x) => new Date(x).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const tagOf = (b) => `<span class="tag ${/DCA/.test(b) ? 't-long' : 't-n'}">${esc(b || 'Bot')}</span>`;
  const row = (left, mid, right, goto) => `<li class="btl-row"${goto ? ` data-goto="${esc(goto)}" tabindex="0"` : ''}><div class="btl-l">${left}</div><div class="btl-m">${mid}</div><div class="btl-r">${right}</div></li>`;
  const T = v.today.lists || {}, head = (title, extra = '') => `<div class="btl-h"><b>${title}</b>${extra}<button class="xbtn" data-btlist="${k}">Close ✕</button></div>`;
  let body = '';
  if (k === 'open') {
    const sw = v.trades.map(x => row(`<b class="sy">${esc(x.s)}</b>${tagOf(x.kind === 'crypto' ? 'Crypto swing' : 'Stock swing')}`,
      `${+(+x.qty).toFixed(6)} @ ${fp(x.avg)} → ${fp(x.px)} · stop ${fp(x.stop)} · target ${fp(x.target)} · held ${x.held} of ${x.hold} ${x.holdUnit}`,
      `<b class="${cls(x.pl)}">${f$(x.pl)}</b><span class="${cls(x.plpc)}">${fpct(x.plpc)}</span>`, x.coid));
    const dc = (v.dca?.deals || []).map(d => row(`<b class="sy">${esc(d.s)}</b>${tagOf('DCA')}`,
      `avg ${fp(d.avg)} → ${fp(d.px)} · dip buys ${d.dips}/${d.n} · ${d.trail ? (d.trail.on ? `trailing: sells under ${fp(d.trail.floor)}` : `trailing starts at ${fp(d.trail.act)}`) : `take profit ${fp(d.tp)}`} · ${f$(d.invested)} in`,
      `<b class="${cls(d.pl)}">${f$(d.pl)}</b><span class="${cls(d.plpc)}">${fpct(d.plpc)}</span>`, d.key));
    const all = [...sw, ...dc], pl = v.trades.reduce((a, x) => a + (x.pl || 0), 0) + (v.dca?.deals || []).reduce((a, d) => a + (d.pl || 0), 0);
    body = head(`Open now · ${all.length}`, ` <span class="${cls(pl)} num">${f$(pl)} open P&amp;L</span>`) + (all.length ? `<ul class="btl">${all.join('')}</ul><div class="muted btl-f">Tap a row to jump to its card and chart.</div>` : '<div class="empty">Nothing open right now.</div>');
  } else if (k === 'closed') {
    const L = T.closed || [], pl = L.reduce((a, x) => a + (x.pnl || 0), 0);
    body = head(`Closed today · ${L.length}`, L.length ? ` <span class="${cls(pl)} num">${f$(pl)} realized</span>` : '') + (L.length ? `<ul class="btl">${L.map(x => row(`<b class="sy">${esc(x.s)}</b>${tagOf(x.bot)}<small>${tm(x.t)} ET</small>`,
      `${esc(x.text)}${x.entry != null ? ` · bought ${fp(x.entry)}` : ''}`, x.pnl != null ? `<b class="${cls(x.pnl)}">${f$(x.pnl)}</b>${x.entry && x.px ? `<span class="${cls(x.px - x.entry)}">${fpct((x.px / x.entry - 1) * 100)}</span>` : ''}` : '<span class="muted">—</span>')).join('')}</ul>` : '<div class="empty">Nothing closed yet today (New York time). Stops, targets, time exits, DCA take profits and hard exits show here.</div>');
  } else {
    const L = T[k] || [];
    body = head(k === 'stocks' ? `Stock buys filled today · ${L.length}` : `Crypto buys filled today · ${L.length}`, ` <span class="muted">${k === 'stocks' ? 'swing entries + ETF DCA' : 'DCA deals and dip buys' + (v.cryptoSwing ? ' + swing entries' : '')}</span>`)
      + (L.length ? `<ul class="btl">${L.map(x => row(`<b class="sy">${esc(x.s)}</b>${tagOf(x.bot)}<small>${tm(x.t)} ET</small>`, esc(x.text), x.px && x.qty ? `<b>${f$(x.px * x.qty)}</b>` : '')).join('')}</ul>` : '<div class="empty">No buys filled yet today.</div>');
  }
  return `<div class="btlist" id="bt-list">${body}</div>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-btlist]'); if (b) { BT.list = BT.list === b.dataset.btlist ? null : b.dataset.btlist; if (tab === 'bot') { $('#bt-top').innerHTML = botTop(state.botview); if (BT.list) $('#bt-list')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } return; }
  const g = e.target.closest('[data-goto]'); if (g) { const k = g.dataset.goto, show = () => { const c = document.querySelector(`.btc[data-k="${CSS.escape(k)}"]`); if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'start' }); c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash'); } };
    if (!document.querySelector(`.btc[data-k="${CSS.escape(k)}"]`) && state.botview?.dca?.deals?.some(d => d.key === k)) { go('dca'); setTimeout(show, 300); } else show(); } // DCA deal cards live on the DCA tab
});
function tradeCard(t) {
  return `<article class="btc" data-k="${esc(t.coid)}"><header><button class="sy" data-sym="${esc(t.s)}">${esc(t.s)}</button><span class="tag t-long">LONG</span><span class="tag t-n">${t.kind === 'crypto' ? 'CRYPTO' : 'STOCK'}</span>
      <span class="btsetup">${esc(t.setup)}</span>${t.score ? `<span class="tag t-n">score ${t.score}</span>` : ''}${t.filler ? '<span class="tag t-n" style="background:#4a3500;color:#ffcf66">FILLER · half size</span>' : ''}<span class="btpl"></span><button class="xbtn btmax" data-max="${esc(t.coid)}" title="Open this chart full screen">&#x2922; Maximize</button></header>
    <div class="btchart"></div><div class="btprog"></div><div class="btbody"><dl class="kv btkv"></dl><div class="btwhy"></div></div></article>`;
}
// Jev hold review (shadow: shown, never acted on)
const aiPct = v => v == null ? '—' : Math.round(v * 100) + '%';
const aiRow = a => a ? `<dt>AI view <span class="muted">(shadow)</span></dt><dd title="Jev ${esc(a.model || '')} · ${esc(a.at || '')}"><span class="${a.hold >= 2 ? 'up' : a.hold < 1 ? 'down' : 'amber'}">hold ${a.hold ?? '—'}/3</span> · keeps going ${aiPct(a.cont)} · fading ${aiPct(a.fade)} · drop risk ${aiPct(a.down)}</dd>` : '';
function paintCard(el, t) {
  const r = t.r == null ? '—' : sgn(t.r, 2, 'R');
  el.querySelector('.btpl').innerHTML = `<b class="${cls(t.pl)}">${f$(t.pl)}</b> <span class="${cls(t.plpc)}">${fpct(t.plpc)}</span> <span class="${cls(t.r)}">${r}</span>`;
  const p = t.progress == null ? null : Math.max(0, Math.min(1, t.progress)), e = t.stop && t.target ? Math.max(0, Math.min(1, (t.avg - t.stop) / (t.target - t.stop))) : null;
  el.querySelector('.btprog').innerHTML = p == null ? '' : `<div class="pbar"><em style="left:${(e * 100).toFixed(1)}%"></em><i style="left:${(p * 100).toFixed(1)}%"><span>${fp(t.px)}</span></i></div><div class="plbl"><span class="down">STOP ${fp(t.stop)}${t.stopLive ? '' : ' · not live'}</span><span class="muted">entry ${fp(t.avg)}</span><span class="up">TARGET ${fp(t.target)}${t.kind === 'crypto' || t.targetLive ? '' : ' · not live'}</span></div>`;
  const prot = t.kind === 'crypto' ? (t.stopLive ? '<span class="up">Standing stop live · target checked each run</span>' : '<span class="amber">Stop goes in on the next run</span>')
    : t.stopLive && t.targetLive ? (t.gtc ? '<span class="up">Stop + target live (good-till-canceled)</span>' : '<span class="amber">Day-only: re-armed on the next run</span>') : '<span class="amber">Missing: re-armed on the next run</span>';
  el.querySelector('.btkv').innerHTML = `<dt>Entry</dt><dd>${fp(t.avg)} · ${t.qty} ${t.kind === 'crypto' ? t.s.replace('/USD', '') : 'sh'}</dd><dt>Now</dt><dd class="${cls(t.px - t.avg)}">${fp(t.px)}</dd>
    <dt>Risk to stop</dt><dd class="down">${f$(t.riskUsd)}</dd><dt>Reward at target</dt><dd class="up">${f$(t.rewardUsd)}</dd>
    <dt>Held</dt><dd>${t.held} of ${t.hold} ${t.holdUnit}</dd><dt>Time exit by</dt><dd>${esc(String(t.exitBy).slice(0, 10))}</dd><dt>Protection</dt><dd>${prot}</dd><dt>Bought</dt><dd>${new Date(t.entryAt).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET</dd>${aiRow(t.ai)}`;
  el.querySelector('.btwhy').innerHTML = `<div class="sub">Why the bot took it</div><ul>${[...(t.story || []), ...(t.why || []).map(w => 'Signal: ' + w)].map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
  // chart: bars since the day before entry, BUY marker, stop/target zones, pulsing live price
  let ch = BT.charts[t.coid]; const title = `${t.s} · ${t.tf || ''}`;
  if (!ch || !el.querySelector('.btchart canvas')) ch = BT.charts[t.coid] = tvChart(el.querySelector('.btchart'), { title, pulse: true, lastVsPrev: true });
  const bars = (t.bars || []).map(b => ({ ...b }));
  if (bars.length && t.px) { const L = bars[bars.length - 1]; L.c = t.px; L.h = Math.max(L.h, t.px); L.l = Math.min(L.l, t.px); }
  const et = new Date(t.entryAt).getTime(); let bi = bars.findIndex(b => new Date(b.t).getTime() + 1 >= et); if (bi < 0) bi = bars.length - 1;
  const plines = [t.target && { price: t.target, color: '#26a69a', label: 'TARGET', fit: true, fill: 'rgba(38,166,154,.07)', fillTo: t.avg }, t.stop && { price: t.stop, color: '#ef5350', label: 'STOP', fit: true, fill: 'rgba(239,83,80,.08)', fillTo: t.avg }, { price: t.avg, color: '#2962ff', label: 'ENTRY', dash: [3, 3], tag: false }].filter(Boolean);
  const opt = { intraday: true, crypto: t.kind === 'crypto', plines, marks: [{ key: 'buy', i: bi, text: `BUY ${fp(t.avg)}`, cls: 'buy' }] };
  if (bars.length) { ch.set(bars, { ...opt, keepView: true }); BT.last[t.coid] = { title, bars, opt }; if (CMAX.key === t.coid && CMAX.ch) CMAX.ch.set(bars, { ...opt, keepView: true }); }
  else el.querySelector('.btchart').innerHTML = '<div class="empty">Chart data is loading…</div>';
}
const EVI = { sent: '➜', fill: '✓', stop: '■', target: '★', time: '⏱', rearm: '⟲', cancel: '✕' };
function botPaint() {
  const v = state.botview;
  $('#bt-top').innerHTML = botTop(v);
  $('#bt-meta').innerHTML = v && !v.error ? `${v.today?.season ? `<b>${esc(v.today.season.label)}</b> since ${esc(v.today.season.since)} · ` : ''}updated <span data-ago="${esc(v.at)}">${ago(v.at)}</span> · refreshes every 20 s` : '';
  // cards, stocks and crypto in separate sections
  const boxes = { stock: $('#bt-cards-s'), crypto: $('#bt-cards-c') }, metas = { stock: $('#bt-ns'), crypto: $('#bt-nc') };
  if (!v || v.error) { boxes.stock.innerHTML = v ? '' : `<section class="panel">${loading}</section>`; boxes.crypto.innerHTML = ''; metas.stock.textContent = metas.crypto.textContent = ''; }
  else {
    const keys = new Set(v.trades.map(t => t.coid));
    $$('#bt-cards-s .btc, #bt-cards-c .btc').forEach(el => { if (!keys.has(el.dataset.k)) { delete BT.charts[el.dataset.k]; delete BT.last[el.dataset.k]; el.remove(); } });
    const first = BT.seenTr == null; BT.seenTr ||= new Set();
    for (const kind of ['stock', 'crypto']) {
      const box = boxes[kind], list = v.trades.filter(t => t.kind === kind), pl = list.reduce((a, t) => a + (t.pl || 0), 0);
      metas[kind].innerHTML = list.length ? `${list.length} open · <span class="${cls(pl)}">${f$(pl)}</span> open P&amp;L` : 'none open';
      if (!list.length) { const nr = nextRuns(1)[0]; box.innerHTML = `<section class="panel"><div class="empty">${kind === 'stock' ? `<b>No open stock trades.</b> Next stock run ${nr ? etTime(nr.t) + ' ET' : 'soon'} (the bot scans every 15 minutes while the market is open), or use the Run buttons above. Each trade shows up here with its live chart, stop, target and the reasons the bot took it.` : v.cryptoSwing ? '<b>No open crypto swing trades.</b> Crypto is checked every 5 minutes, weekends too. Each trade shows up here with its live chart, stop, target and the reasons the bot took it.' : '<b>Crypto swing entries are off.</b> Crypto buys go through the DCA bot below (checked every 5 minutes, weekends too). Coins the swing bot bought earlier would show here until they close.'}</div></section>`; continue; }
      box.querySelector(':scope > .panel')?.remove();
      for (const t of list) {
        let el = box.querySelector(`.btc[data-k="${CSS.escape(t.coid)}"]`);
        if (!el) { box.insertAdjacentHTML('beforeend', tradeCard(t)); el = box.lastElementChild; if (!first && !BT.seenTr.has(t.coid)) el.classList.add('flash', 'enter'); }
        BT.seenTr.add(t.coid); paintCard(el, t);
      }
    }
  }
  // feed
  const feed = $('#bt-feed');
  if (v && !v.error) {
    const firstEv = BT.seenEv == null; BT.seenEv ||= new Set(); const fresh = [];
    const evs = v.events.filter(e => e.bot !== 'DCA' && e.bot !== 'Bull-run core'); // DCA activity has its own feed on the DCA tab
    feed.innerHTML = evs.length ? evs.slice(0, 60).map(e => { const k = e.t + e.type + e.s; const isNew = !firstEv && !BT.seenEv.has(k); if (isNew) fresh.push(e); return `<li class="ev ev-${e.type}${isNew ? ' new' : ''}"><i>${EVI[e.type] || '•'}</i><div><b>${esc(e.text)}</b><small>${new Date(e.t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET · <span data-ago="${esc(e.t)}">${ago(e.t)}</span></small></div>${e.pnl != null ? `<span class="${cls(e.pnl)} num">${f$(e.pnl)}</span>` : ''}</li>`; }).join('')
      : '<li class="empty">Nothing yet. Orders, fills, stops and targets appear here as they happen.</li>';
    v.events.forEach(e => BT.seenEv.add(e.t + e.type + e.s));
    for (const e of fresh) if (['fill', 'stop', 'target', 'time'].includes(e.type)) { const c = [...document.querySelectorAll('.btc')].find(x => x.querySelector('.sy')?.textContent === e.s); if (c) { c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash'); } }
  } else feed.innerHTML = v?.error ? '' : `<li>${loading}</li>`;
  $('#bt-csec').hidden = !(v && !v.error && (v.cryptoSwing || v.trades.some(t => t.kind === 'crypto'))); // crypto swing is off by default (crypto goes through DCA)
  $('#bt-dcaline').innerHTML = dcaLine(v);
  controlPaint();
  $('#bt-run').innerHTML = botView();
  $('#bt-runmeta').textContent = state.botRun?.ranAt ? 'ran ' + new Date(state.botRun.ranAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET' : 'runs by schedule or the buttons above';
}
async function runBotNow(k) {
  const params = k === 'dry' ? { dry: '1' } : k === 'c' ? { run: '1', check: '1' } : k === 'd' ? { run: '1', only: 'dca' } : { run: '1', only: 'stocks', max: k.slice(1) };
  BT.busy = k === 'dry' ? 'Training on ~16 months of history and picking setups (preview, no orders)… usually 20–60 s' : k === 'c' ? 'Crypto check: swing-coin stops, DCA dip buys, take profits and trailing floors, any new crypto deals… usually 5–20 s' : k === 'd' ? 'DCA bot: managing deals (dip buys, take profits, hard exits) and starting any new deals… usually 10–30 s, up to ~90 s when it retrains' : `Training, then placing up to ${k.slice(1)} stock trade${k === 's1' ? '' : 's'}… usually 20–60 s`;
  BT.arm = null; state.botRun = null; render();
  const r = await api('bot', params).catch(e => ({ error: 'network', message: e.message }));
  state.botRun = r; BT.busy = null; delete lastLoad.botview; delete lastLoad.account; load('botview', true); load('account', true); render();
}

/* ---------- Crypto tab: exchange-style screen (paper orders via Alpaca) ---------- */
const COIN = { BTC: ['Bitcoin', '#f7931a'], ETH: ['Ethereum', '#627eea'], SOL: ['Solana', '#9945ff'], XRP: ['XRP', '#8f9bb3'], DOGE: ['Dogecoin', '#c2a633'], AVAX: ['Avalanche', '#e84142'], LINK: ['Chainlink', '#2a5ada'], LTC: ['Litecoin', '#345d9d'], BCH: ['Bitcoin Cash', '#8dc351'], DOT: ['Polkadot', '#e6007a'], UNI: ['Uniswap', '#ff007a'], AAVE: ['Aave', '#b6509e'], SHIB: ['Shiba Inu', '#ffa409'], XTZ: ['Tezos', '#2c7df7'] };
const CB = { sel: LS.get('cbsel', 'BTC/USD'), range: LS.get('cbrange', '1D'), side: 'buy', amt: '', stage: 'edit', res: null, filter: 'all', star: new Set(LS.get('cbstar', ['BTC/USD', 'ETH/USD', 'SOL/USD'])), chart: null, data: null, loadedKey: '', hover: null, q: '', all: null, allAt: 0, allBusy: false, names: {} };
const tick = s => s.replace('/USD', '');
const coinIcon = (s, sz = 32) => { const [n, c] = COIN[tick(s)] || [s, '#555']; return `<span class="cbico" style="--c:${c};--s:${sz}px" aria-hidden="true">${esc(tick(s).slice(0, 4))}</span>`; };
const coinName = s => COIN[tick(s)]?.[0] || CB.names[s] || tick(s);
// v0.19.0: the Market list is the whole market (/api/crypto?all=1, every coin Alpaca trades, refreshed each minute while the tab
// is open); the bot's own coins take the fresher 30-second board's numbers. cbRow finds any coin's row in either.
const cbRow = s => state.crypto?.board?.find(x => x.s === s) || CB.all?.board?.find(x => x.s === s);
function cbBoard() {
  const mine = state.crypto?.board || [], all = CB.all?.board; if (!all?.length) return mine;
  const fresh = Object.fromEntries(mine.map(r => [r.s, r]));
  return all.map(r => fresh[r.s] ? { ...r, ...fresh[r.s] } : r);
}
function cbLoadAll() {
  if (CB.allBusy || CB.all && Date.now() - CB.allAt < 6e4) return; CB.allBusy = true;
  api('crypto', { all: 1 }).catch(e => ({ error: 'network', message: e.message })).then(j => {
    CB.all = j; CB.allAt = Date.now(); CB.allBusy = false;
    for (const r of j.board || []) if (r.n) CB.names[r.s] = r.n;
    if ($('#cbroot')) { cbMkt(); cbHead(); }
  });
}
const cbVol = v => v == null ? '—' : v >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? '$' + (v / 1e3).toFixed(0) + 'K' : '$' + Math.round(v);
const usd = (v, d) => v == null || !isFinite(v) ? '—' : '$' + (+v).toLocaleString('en-US', { minimumFractionDigits: d ?? (Math.abs(v) >= 1 ? 2 : 4), maximumFractionDigits: d ?? (Math.abs(v) >= 1 ? 2 : 6) });
const cbPos = () => (state.account?.positions || []).filter(p => p.cls === 'crypto').map(p => ({ ...p, sym: p.s.includes('/') ? p.s : p.s.replace(/USD$/, '/USD') }));
function cbShell() {
  return `<div id="cbroot" class="cb"><div class="cbmain">
    <section class="cbcard"><div class="cbbal" id="cb-bal"></div></section>
    <section class="cbcard"><div class="cbhead" id="cb-head"></div><div class="cbrng" id="cb-rng">${['1H', '1D', '1W', '1M', '1Y', 'ALL'].map(r => `<button data-cbr="${r}" aria-pressed="${r === CB.range}">${r}</button>`).join('')}</div><div class="cbchart" id="cb-chart"></div><div class="cbstats" id="cb-stats"></div></section>
    <section class="cbcard"><h3>Your crypto</h3><div id="cb-assets"></div></section>
    <section class="cbcard"><div class="cbmh"><h3>Market</h3><input id="cb-q" class="cbq" type="search" placeholder="Search every coin" aria-label="Search every coin" autocomplete="off" spellcheck="false" value="${esc(CB.q)}"><div class="cbpills" id="cb-f">${[['all', 'All assets'], ['star', 'Watchlist'], ['up', 'Top gainers'], ['down', 'Top losers']].map(([k, l]) => `<button data-cbf="${k}" aria-pressed="${k === CB.filter}">${l}</button>`).join('')}</div></div><div id="cb-mkt"></div></section>
  </div><aside class="cbside"><section class="cbcard cbtrade" id="cb-trade"></section><section class="cbcard" id="cb-bot"></section></aside></div>`;
}
async function cbLoadChart(force) {
  const key = CB.sel + '|' + CB.range; if (!force && CB.loadedKey === key && CB.data) return;
  CB.loadedKey = key; const j = await api('bars', { symbol: CB.sel, range: CB.range });
  if (CB.sel + '|' + CB.range !== key) return; CB.data = j; cbChartDraw(); cbHead();
}
function cbChartDraw() {
  const box = $('#cb-chart'); if (!box) return; const j = CB.data;
  if (!j) { box.innerHTML = '<div class="cbempty">Loading chart…</div>'; CB.chart = null; return; }
  if (j.error) { box.innerHTML = `<div class="cbempty">${esc(j.message || j.error)}</div>`; CB.chart = null; return; }
  const bars = j.bars, i0 = Math.max(0, bars.findIndex(b => b.t >= (j.from || bars[0].t))), up = bars.at(-1).c >= bars[i0].c;
  if (!CB.chart || !box.querySelector('canvas')) CB.chart = tvChart(box, { mode: 'area', volume: false, color: up ? '#27ad75' : '#f0616d', bg: '#0a0b0d', pulse: true });
  CB.chart.set(bars, { from: j.from, intraday: j.intraday, crypto: true });
}
function cbHead() {
  const el = $('#cb-head'); if (!el) return;
  const b = cbRow(CB.sel), j = CB.data;
  let chg = null; if (j?.bars?.length) { const i0 = Math.max(0, j.bars.findIndex(x => x.t >= (j.from || j.bars[0].t))); const a = j.bars[i0].c, z = b?.p ?? j.bars.at(-1).c; chg = { abs: z - a, pct: (z / a - 1) * 100 }; }
  const lbl = { '1H': 'past hour', '1D': 'past day', '1W': 'past week', '1M': 'past month', '1Y': 'past year', ALL: 'all time' }[CB.range];
  el.innerHTML = `<div class="cbcoin">${coinIcon(CB.sel, 40)}<div><h2>${esc(coinName(CB.sel))}</h2><span>${esc(tick(CB.sel))}</span></div><button class="cbstar ${CB.star.has(CB.sel) ? 'on' : ''}" data-cbstar="${esc(CB.sel)}" aria-label="Watchlist">★</button></div>
    <div class="cbprice">${usd(b?.p ?? j?.bars?.at(-1)?.c)}</div>${chg ? `<div class="${chg.abs >= 0 ? 'cbup' : 'cbdn'}">${chg.abs >= 0 ? '↗' : '↘'} ${usd(Math.abs(chg.abs))} (${Math.abs(chg.pct).toFixed(2)}%) <span class="cbmut">${lbl}</span></div>` : ''}`;
  const st = $('#cb-stats');
  if (st) st.innerHTML = b ? [['24h change', fpct(b.chg24)], ['7 days', fpct(b.d7, 1)], ['30 days', fpct(b.d30, 1)], ['RSI (daily)', b.rsi ?? '—'], ['Trend', b.above200 == null ? '—' : b.above200 ? 'Above 200-day' : 'Below 200-day'], ['24h volume trend', b.volTrend ? b.volTrend + '×' : '—']].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('') : '';
}
function cbBal() {
  const pos = cbPos(), a = state.account?.account; const tot = pos.reduce((s, p) => s + p.mv, 0), pl = pos.reduce((s, p) => s + p.pl, 0);
  $('#cb-bal').innerHTML = `<div><span class="cbmut">Crypto balance · ${isLive() ? 'LIVE' : 'paper'}</span><div class="cbbig">${a ? usd(tot) : '—'}</div>${pos.length ? `<span class="${pl >= 0 ? 'cbup' : 'cbdn'}">${pl >= 0 ? '↗' : '↘'} ${usd(Math.abs(pl))} all time</span>` : '<span class="cbmut">No crypto yet</span>'}</div><div class="cbcash"><span class="cbmut">Cash available</span><b>${a ? usd(a.cash) : state.account?.error ? 'Locked' : '—'}</b></div>`;
  $('#cb-assets').innerHTML = pos.length ? `<div class="cbscroll"><table class="cbt"><thead><tr><th>Asset</th><th>Balance</th><th class="hm">Price</th><th class="hm">Avg cost</th><th>Return</th></tr></thead><tbody>${pos.map(p => `<tr data-cbsel="${esc(p.sym)}"><td><div class="cbas">${coinIcon(p.sym)}<div><b>${esc(coinName(p.sym))}</b><span>${esc(tick(p.sym))}</span></div></div></td><td><b>${usd(p.mv)}</b><span>${(+p.qty).toFixed(6)} ${esc(tick(p.sym))}</span></td><td class="hm">${usd(p.px)}</td><td class="hm">${usd(p.avg)}</td><td class="${p.pl >= 0 ? 'cbup' : 'cbdn'}">${p.pl >= 0 ? '+' : '−'}${usd(Math.abs(p.pl))}<span>${fpct(p.plpc)}</span></td></tr>`).join('')}</tbody></table></div>`
    : `<div class="cbempty">${state.account?.error ? 'Enter your passcode in Settings to see balances.' : 'You don’t own any crypto in the ' + acctName() + ' yet. Pick a coin and use Buy on the right.'}</div>`;
}
function cbMkt() {
  const cr = state.crypto; const el = $('#cb-mkt'); cbLoadAll();
  if (!cr && !CB.all?.board) { el.innerHTML = '<div class="cbempty">Loading prices…</div>'; return; } if (cr?.error && !CB.all?.board) { el.innerHTML = msg(cr); return; }
  const plays = Object.fromEntries((cr?.plays || []).map(p => [p.s, p]));
  let rows = cbBoard(); const total = rows.length;
  if (CB.filter === 'star') rows = rows.filter(r => CB.star.has(r.s)); if (CB.filter === 'up') rows = rows.filter(r => r.chg24 > 0).sort((a, z) => z.chg24 - a.chg24); if (CB.filter === 'down') rows = rows.filter(r => r.chg24 < 0).sort((a, z) => a.chg24 - z.chg24);
  // v0.19.0: search by ticker or name; tickers that start with what was typed come first
  const q = CB.q.trim().toUpperCase();
  if (q) rows = rows.filter(r => tick(r.s).includes(q) || coinName(r.s).toUpperCase().includes(q)).sort((a, z) => tick(z.s).startsWith(q) - tick(a.s).startsWith(q));
  const info = CB.all?.board ? `${q || CB.filter !== 'all' ? `${rows.length} of ${total} coins · ` : ''}${esc(CB.all.note || '')}` : CB.all?.error ? `Only the bot's ${total} coins: the full market list did not load (${esc(CB.all.message || CB.all.error)}).` : 'Loading every coin…';
  el.innerHTML = `<div class="cbmut cbinfo">${info}</div>` + (rows.length ? `<div class="cbscroll"><table class="cbt cbmk"><thead><tr><th></th><th>Asset</th><th>Price</th><th>24h</th><th class="hm">7d</th><th class="hm">Volume (24h)</th><th class="hm">Chart (48h)</th><th class="hm">Bot signal</th><th></th></tr></thead><tbody>${rows.map(r => { const p = plays[r.s]; return `<tr data-cbsel="${esc(r.s)}" class="${r.s === CB.sel ? 'sel' : ''}"><td><button class="cbstar ${CB.star.has(r.s) ? 'on' : ''}" data-cbstar="${esc(r.s)}" aria-label="Watchlist">★</button></td><td><div class="cbas">${coinIcon(r.s)}<div><b>${esc(coinName(r.s))}</b><span>${esc(tick(r.s))}</span></div></div></td><td><b>${usd(r.p)}</b></td><td class="${r.chg24 >= 0 ? 'cbup' : 'cbdn'}">${r.chg24 == null ? '—' : (r.chg24 >= 0 ? '↗ ' : '↘ ') + Math.abs(r.chg24).toFixed(2) + '%'}</td><td class="hm ${r.d7 >= 0 ? 'cbup' : 'cbdn'}">${fpct(r.d7, 1)}</td><td class="hm">${cbVol(r.vol)}</td><td class="hm">${spk(r.spark)}</td><td class="hm">${p && p.dir === 'long' ? `<span class="cbsig">${esc(p.setup)} · ${p.score}</span>` : '<span class="cbmut">—</span>'}</td><td><button class="cbbtn sm" data-cbtrade="${esc(r.s)}">Trade</button></td></tr>`; }).join('')}</tbody></table></div>`
    : `<div class="cbempty">${q ? `No coin matches “${esc(CB.q.trim())}”.${CB.all?.board ? '' : ' Still loading the full list.'}` : 'Nothing here yet. Star coins to build your watchlist.'}</div>`);
}
// v0.19.0: the search box sits in the shell (not redrawn), so typing keeps focus. Enter opens the first match; Esc clears.
document.addEventListener('input', e => { if (e.target.id === 'cb-q') { CB.q = e.target.value; cbMkt(); } });
document.addEventListener('keydown', e => {
  if (e.target.id !== 'cb-q') return;
  if (e.key === 'Escape') { CB.q = e.target.value = ''; cbMkt(); }
  if (e.key === 'Enter') { const r = $('#cb-mkt tr[data-cbsel]'); if (r) { cbSelect(r.dataset.cbsel); window.scrollTo({ top: 0, behavior: 'smooth' }); } }
});
function cbTrade() {
  const el = $('#cb-trade'); const px = cbRow(CB.sel)?.p || CB.data?.bars?.at(-1)?.c;
  const pos = cbPos().find(p => p.sym === CB.sel), cash = state.account?.account?.cash, amt = +CB.amt || 0;
  const qty = px ? amt / px : 0, avail = pos ? +pos.qty : 0;
  const sellQty = CB.side === 'sell' ? (CB.max ? avail : Math.min(avail, qty)) : 0;
  const problem = !amt && !CB.max ? '' : CB.side === 'buy' ? (amt < 1 ? 'Minimum order is $1' : cash != null && amt > cash ? 'More than your cash' : '') : !avail ? `You don’t own any ${tick(CB.sel)}` : (!CB.max && qty > avail * 1.0001 ? `You have ${usd(avail * px)} of ${tick(CB.sel)}` : '');
  const res = CB.res ? (CB.res.error ? `<div class="cbmsg bad">${esc(CB.res.message || CB.res.error)}</div>` : `<div class="cbmsg ok">Order sent · ${esc(CB.res.order?.status || 'accepted')} · ${esc(CB.res.order?.side || '')} ${esc(CB.res.order?.qty || '')} ${esc(tick(CB.sel))}</div>`) : '';
  el.innerHTML = `<div class="cbtabs"><button data-cbside="buy" aria-pressed="${CB.side === 'buy'}">Buy</button><button data-cbside="sell" aria-pressed="${CB.side === 'sell'}">Sell</button></div>
    <div class="cbamt"><span>$</span><input id="cb-amt" inputmode="decimal" placeholder="0" value="${esc(CB.max ? (avail * px).toFixed(2) : CB.amt)}" aria-label="Amount in dollars"></div>
    <div class="cbest">${CB.side === 'buy' ? `≈ ${qty ? qty.toFixed(qty < 1 ? 6 : 4) : '0'} ${esc(tick(CB.sel))}` : `≈ ${sellQty ? sellQty.toFixed(6) : '0'} ${esc(tick(CB.sel))}`}${px ? ` at ${usd(px)}` : ''}</div>
    <div class="cbchips">${CB.side === 'buy' ? [10, 50, 100, 500, 1000].map(v => `<button data-cbamt="${v}">$${v}</button>`).join('') : [25, 50, 100].map(v => `<button data-cbpct="${v}">${v === 100 ? 'Max' : v + '%'}</button>`).join('')}</div>
    <label class="cbrow"><span>${CB.side === 'buy' ? 'Buy' : 'Sell'}</span><select id="cb-coin">${(() => { const L = cbBoard(); return L.some(b => b.s === CB.sel) ? L : [{ s: CB.sel }, ...L]; })().map(b => `<option value="${esc(b.s)}" ${b.s === CB.sel ? 'selected' : ''}>${esc(coinName(b.s))} (${esc(tick(b.s))})</option>`).join('')}</select></label>
    <div class="cbrow"><span>${CB.side === 'buy' ? 'Pay with' : 'Receive'}</span><b>Cash (${isLive() ? 'LIVE' : 'paper'}) · ${cash != null ? usd(cash) : '—'}</b></div>
    ${CB.side === 'sell' ? `<div class="cbrow"><span>You own</span><b>${avail ? avail.toFixed(6) + ' ' + esc(tick(CB.sel)) + ' · ' + usd(avail * px) : 'none'}</b></div>` : ''}
    ${problem ? `<div class="cbmsg bad">${esc(problem)}</div>` : ''}
    ${CB.stage === 'review' && !problem ? `<div class="cbreview"><div><span>${CB.side === 'buy' ? 'Buying' : 'Selling'}</span><b>${CB.side === 'buy' ? qty.toFixed(6) : sellQty.toFixed(6)} ${esc(tick(CB.sel))}</b></div><div><span>Price (market)</span><b>≈ ${usd(px)}</b></div><div><span>Total</span><b>${usd(CB.side === 'buy' ? amt : sellQty * px)}</b></div><div class="cbmut" style="font-size:12px">${isLive() ? 'LIVE ACCOUNT, REAL MONEY' : 'Paper account'} · market order · crypto trades 24/7. Alpaca charges crypto fees in the coin, so the amount you receive is slightly less.</div></div>` : ''}
    ${res}
    ${CB.stage === 'review' && !problem ? `<div class="cbrow2"><button class="cbbtn ghost" data-cbact="back">Back</button><button class="cbbtn" data-cbact="send">${CB.side === 'buy' ? 'Buy now' : 'Sell now'}</button></div>` : `<button class="cbbtn big" data-cbact="review" ${!amt && !CB.max || problem ? 'disabled' : ''}>Review order</button>`}`;
  const inp = $('#cb-amt'); inp.oninput = () => { CB.amt = inp.value.replace(/[^0-9.]/g, ''); CB.max = false; CB.stage = 'edit'; CB.res = null; const pos0 = inp.selectionStart; cbTrade(); const n = $('#cb-amt'); n.focus(); try { n.setSelectionRange(pos0, pos0); } catch {} };
  $('#cb-coin').onchange = e => cbSelect(e.target.value);
}
function cbBot() {
  const v = state.botview, cr = state.crypto; const mine = v && !v.error ? v.trades.filter(t => t.kind === 'crypto') : [];
  const sig = v?.cryptoSwing ? (cr?.plays || []).filter(p => p.dir === 'long').slice(0, 5) : [], deals = v && !v.error ? (v.dca?.deals || []).filter(d => d.market === 'crypto') : [];
  $('#cb-bot').innerHTML = `<h3>Bot · crypto</h3><p class="cbmut" style="margin:0 0 8px;font-size:12.5px">${v?.cryptoSwing ? 'Swing trades coins at half the stock risk with a standing stop on every coin. Max 2 new a day, 4 coins, 15% of equity. ' : 'Crypto swing entries are off: the bot buys crypto through DCA deals only (DCA tab). '}Crypto is checked every 5 minutes.</p>
    ${mine.length ? mine.map(t => `<div class="cbbt" data-cbsel="${esc(t.s)}">${coinIcon(t.s, 28)}<div><b>${esc(tick(t.s))} · ${esc(t.setup)}</b><span>stop ${usd(t.stop)} · target ${usd(t.target)}</span></div><em class="${t.pl >= 0 ? 'cbup' : 'cbdn'}">${t.pl >= 0 ? '+' : '−'}${usd(Math.abs(t.pl))}</em></div>`).join('') : '<div class="cbmut" style="font-size:13px">No open bot crypto trades.</div>'}
    ${deals.length ? `<h4>DCA deals open</h4>${deals.map(d => `<div class="cbbt" data-cbsel="${esc(d.s)}">${coinIcon(d.s, 28)}<div><b>${esc(tick(d.s))} · DCA</b><span>${d.dips}/${d.n} dip buys · avg ${usd(d.avg)}</span></div><em class="${d.pl >= 0 ? 'cbup' : 'cbdn'}">${d.pl >= 0 ? '+' : '−'}${usd(Math.abs(d.pl))}</em></div>`).join('')}` : ''}
    ${v?.cryptoSwing ? `<h4>Signals right now</h4>${sig.length ? sig.map(p => `<div class="cbbt" data-cbsel="${esc(p.s)}">${coinIcon(p.s, 28)}<div><b>${esc(tick(p.s))} · ${esc(p.setup)}</b><span>${esc(p.why.join(' · '))}</span></div><em class="cbsig">${p.score}</em></div>`).join('') : '<div class="cbmut" style="font-size:13px">No coin passes the swing rules today.</div>'}` : ''}
    <button class="cbbtn ghost" style="width:100%;margin-top:10px" data-cbact="botgo">${v?.cryptoSwing ? 'Open the Bot tab' : 'Open the DCA tab'}</button>`;
}
function cbPaint() { cbBal(); cbHead(); cbMkt(); cbTrade(); cbBot(); if (!CB.chart || !$('#cb-chart canvas')) cbChartDraw(); cbLoadChart(); }
function cbSelect(s) { if (s === CB.sel) return; CB.sel = s; LS.set('cbsel', s); CB.data = null; CB.chart = null; CB.stage = 'edit'; CB.res = null; CB.max = false; cbChartDraw(); cbPaint(); }
document.addEventListener('click', async e => {
  if (!e.target.closest('#cbroot')) return;
  const st = e.target.closest('[data-cbstar]'); if (st) { e.stopPropagation(); const s = st.dataset.cbstar; CB.star.has(s) ? CB.star.delete(s) : CB.star.add(s); LS.set('cbstar', [...CB.star]); cbHead(); cbMkt(); return; }
  const r = e.target.closest('[data-cbr]'); if (r) { CB.range = r.dataset.cbr; LS.set('cbrange', CB.range); $$('#cb-rng button').forEach(b => b.setAttribute('aria-pressed', b.dataset.cbr === CB.range)); CB.data = null; CB.chart = null; cbChartDraw(); cbLoadChart(true); return; }
  const f = e.target.closest('[data-cbf]'); if (f) { CB.filter = f.dataset.cbf; $$('#cb-f button').forEach(b => b.setAttribute('aria-pressed', b.dataset.cbf === CB.filter)); cbMkt(); return; }
  const sd = e.target.closest('[data-cbside]'); if (sd) { CB.side = sd.dataset.cbside; CB.stage = 'edit'; CB.res = null; CB.max = false; cbTrade(); return; }
  const am = e.target.closest('[data-cbamt]'); if (am) { CB.amt = am.dataset.cbamt; CB.max = false; CB.stage = 'edit'; CB.res = null; cbTrade(); return; }
  const pc = e.target.closest('[data-cbpct]'); if (pc) { const pos = cbPos().find(p => p.sym === CB.sel); const px = cbRow(CB.sel)?.p; if (pos && px) { CB.max = pc.dataset.cbpct === '100'; CB.amt = CB.max ? '' : (pos.qty * px * pc.dataset.cbpct / 100).toFixed(2); } CB.stage = 'edit'; CB.res = null; cbTrade(); return; }
  const tr = e.target.closest('[data-cbtrade]'); if (tr) { e.stopPropagation(); cbSelect(tr.dataset.cbtrade); CB.side = 'buy'; cbTrade(); if (innerWidth <= 980) $('#cb-trade').scrollIntoView({ behavior: 'smooth', block: 'center' }); else $('#cb-amt')?.focus(); return; }
  const a = e.target.closest('[data-cbact]');
  if (a) {
    const act = a.dataset.cbact;
    if (act === 'botgo') return go(state.botview?.cryptoSwing ? 'bot' : 'dca');
    if (act === 'review') { CB.stage = 'review'; CB.res = null; cbTrade(); return; }
    if (act === 'back') { CB.stage = 'edit'; cbTrade(); return; }
    if (act === 'send') {
      a.disabled = true; a.textContent = 'Sending…';
      const px = cbRow(CB.sel)?.p || CB.data?.bars?.at(-1)?.c; const pos = cbPos().find(p => p.sym === CB.sel);
      const body = CB.side === 'buy' ? { symbol: CB.sel, side: 'buy', type: 'market', notional: +CB.amt } : { symbol: CB.sel, side: 'sell', type: 'market', qty: CB.max ? +pos.qty : +Math.min(+pos.qty, +CB.amt / px).toFixed(8) };
      CB.res = await apiSend('order', body); CB.stage = 'edit'; if (!CB.res.error) { CB.amt = ''; CB.max = false; } cbTrade(); delete lastLoad.account; load('account', true); return;
    }
  }
  const row = e.target.closest('[data-cbsel]'); if (row) { cbSelect(row.dataset.cbsel); window.scrollTo({ top: 0, behavior: 'smooth' }); }
});

