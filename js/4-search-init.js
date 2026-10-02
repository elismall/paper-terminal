// Paper Terminal front end, part 4 of 4. Plain classic scripts (no build); they share one global scope and load in order from index.html.
/* ---------- search suggestions ---------- */
let SYMS = null, symBusy = false, sgList = [], sgIdx = -1;
const POPULAR = new Set('SPY QQQ IWM DIA AAPL MSFT NVDA AMZN GOOGL GOOG META AVGO TSLA AMD NFLX ORCL CRM ADBE INTC QCOM MU TXN AMAT PLTR COIN MSTR SMCI ARM UBER SHOP CRWD PANW SNOW JPM BAC WFC GS MS V MA PYPL UNH LLY JNJ PFE MRK ABBV XOM CVX CAT DE BA GE LMT WMT COST HD TGT NKE SBUX MCD KO PEP PG DIS T VZ SOFI HOOD RIVN LCID F GM NIO BABA TSM ASML SMH XLK XLF XLE XLV GLD SLV TLT ARKK VOO VTI SCHD BTC/USD ETH/USD SOL/USD XRP/USD DOGE/USD'.split(' '));
async function loadSyms() { if (SYMS || symBusy) return; symBusy = true; const j = await api('symbols').catch(() => null); if (j?.list) SYMS = j.list; symBusy = false; const v = $('#cmd').value; if (v && document.activeElement === $('#cmd')) suggest(v); if (AC.el && document.activeElement === AC.el) acShow(AC.el); if (SYMS && JV?.res && !JV.busy && $('#jv-res')) $('#jv-res').innerHTML = jvAskView(); } // the Ask Jev result gets its company name once the list arrives
// Company name for a ticker (v0.13.2): the full symbol list when loaded, else the built-in names, else the name the quotes carry.
function symName(s) {
  s = String(s || '').toUpperCase(); if (!SYMS) loadSyms();
  const r = SYMS?.find(x => x[0] === s || x[0] === s + '/USD'); if (r && r[1] && r[1] !== r[0]) return r[1];
  return (typeof CO !== 'undefined' && CO[s]) || state.quotes?.quotes?.[s]?.n || '';
}
// Best matches for what was typed: exact ticker, then tickers starting with it (popular first, shorter first), then company-name words.
// stocksOnly drops crypto (Options and Catalyst fields). Before the full list loads, the quotes on screen + the watchlist are used.
function rankSyms(raw, { stocksOnly = false, n = 8 } = {}) {
  const v = raw.trim().toUpperCase(); if (!v) return [];
  let src = SYMS || [...new Set([...Object.keys(state.quotes?.quotes || {}), ...cfg.watch])].map(s => [s, state.quotes?.quotes?.[s]?.n || '', s.includes('/') ? 'CRYPTO' : '']);
  if (stocksOnly) src = src.filter(r => !r[0].includes('/'));
  const exact = [], pre = [], name = [];
  for (const r of src) {
    const s = r[0], base = s.replace('/USD', '');
    if (s === v || base === v) exact.push(r);
    else if (s.startsWith(v) || base.startsWith(v)) pre.push(r);
    else if (v.length >= 2 && (r[1] || '').toUpperCase().split(/[\s,.&-]+/).some(w => w.startsWith(v))) name.push(r);
    if (pre.length > 60 && name.length > 30) break;
  }
  pre.sort((a, b) => (POPULAR.has(b[0]) - POPULAR.has(a[0])) || a[0].length - b[0].length || a[0].localeCompare(b[0]));
  name.sort((a, b) => POPULAR.has(b[0]) - POPULAR.has(a[0]));
  return [...exact, ...pre, ...name].slice(0, n);
}
function suggest(raw) {
  const v = raw.trim().toUpperCase(), box = $('#sugg');
  if (!v) { box.hidden = true; sgList = []; return; }
  const tabs = TABS.filter(([id, n, label]) => label.toUpperCase().startsWith(v) || n.startsWith(v)).map(([id, n, label]) => ({ tab: id, label }));
  const syms = rankSyms(v);
  sgList = [...tabs.map(t => ({ kind: 'tab', ...t })), ...syms.map(r => ({ kind: 'sym', s: r[0], n: r[1], x: r[2] }))];
  sgIdx = sgList.length ? 0 : -1;
  if (!sgList.length) { box.innerHTML = `<div class="sgh">${SYMS ? 'No matches' : 'Loading symbol list…'}</div>`; box.hidden = false; return; }
  box.innerHTML = sgList.map((x, i) => x.kind === 'tab'
    ? `<button type="button" class="sg" role="option" data-i="${i}" aria-selected="${i === sgIdx}"><b>TAB</b><span>${esc(x.label)}</span><em>screen</em></button>`
    : `<button type="button" class="sg" role="option" data-i="${i}" aria-selected="${i === sgIdx}"><b>${esc(x.s.replace('/USD', ''))}</b><span>${esc(x.n || x.s)}</span><em>${esc(x.x || '')}</em></button>`).join('');
  box.hidden = false;
}
function pickSugg(i) { const x = sgList[i]; $('#sugg').hidden = true; $('#cmd').value = ''; sgList = []; $('#cmd').blur(); if (!x) return; if (x.kind === 'tab') go(x.tab); else openDetail(x.s); }
const cmdEl = $('#cmd');
cmdEl.addEventListener('focus', loadSyms);
cmdEl.addEventListener('input', () => { loadSyms(); suggest(cmdEl.value); });
cmdEl.addEventListener('keydown', e => {
  if (!sgList.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sgIdx = (sgIdx + (e.key === 'ArrowDown' ? 1 : -1) + sgList.length) % sgList.length; $$('#sugg .sg').forEach((b, i) => b.setAttribute('aria-selected', i === sgIdx)); $$('#sugg .sg')[sgIdx]?.scrollIntoView({ block: 'nearest' }); }
  if (e.key === 'Escape') { $('#sugg').hidden = true; }
});
cmdEl.addEventListener('blur', () => setTimeout(() => { $('#sugg').hidden = true; }, 150));
$('#sugg').addEventListener('mousedown', e => { const b = e.target.closest('.sg'); if (b) { e.preventDefault(); pickSugg(+b.dataset.i); } });

/* ---------- symbol fields: suggestions as you type (v0.13.2) ---------- */
// Same list and ranking as the top search box, under every ticker field: Option ideas, Catalyst scenario, Ask Jev, the order ticket.
// Arrow keys + Enter or a tap fill the field; Esc closes. Options and Catalyst are stocks only, so crypto is left out there.
const AC_FIELDS = { 'o-sym': 'stock', 'ca-sym': 'stock', 'jv-sym': 'any', 't-sym': 'any' };
const AC = { el: null, list: [], i: -1 };
(() => { const st = document.createElement('style'); st.textContent = '.acbox{position:fixed;right:auto;top:0;left:0;z-index:60;border-top:2px solid var(--orange);box-shadow:0 8px 24px rgba(0,0,0,.6)}.acbox .sg{grid-template-columns:70px 1fr auto}.jvhead{font:600 15px var(--sans);margin:2px 0 8px}.jvhead .sy{font:700 16px var(--mono);color:var(--orange);margin-right:6px}.jvask>*{min-width:0}@media (max-width:400px){.jvans>div{grid-template-columns:minmax(110px,max-content) minmax(0,1fr)}.jvbar{width:min(160px,30vw)}}'; document.head.appendChild(st); })();
const acBox = document.createElement('div'); acBox.className = 'sugg acbox'; acBox.id = 'acbox'; acBox.setAttribute('role', 'listbox'); acBox.hidden = true; document.body.appendChild(acBox);
function acPlace() {
  if (!AC.el || acBox.hidden) return;
  const r = AC.el.getBoundingClientRect(), w = Math.min(Math.max(r.width, 300), innerWidth - 16);
  acBox.style.width = w + 'px'; acBox.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px'; acBox.style.top = (r.bottom + 2) + 'px';
  acBox.style.maxHeight = Math.max(160, innerHeight - r.bottom - 12) + 'px';
}
function acHide() { acBox.hidden = true; AC.list = []; AC.i = -1; }
function acShow(el) {
  AC.el = el; const v = el.value.trim();
  if (!v) return acHide();
  AC.list = rankSyms(v, { stocksOnly: AC_FIELDS[el.id] === 'stock' }); AC.i = AC.list.length ? 0 : -1;
  if (AC.list.length === 1 && AC.list[0][0] === v.toUpperCase()) return acHide(); // already an exact ticker: nothing to suggest
  acBox.innerHTML = AC.list.length ? AC.list.map((r, i) => `<button type="button" class="sg" role="option" data-i="${i}" aria-selected="${i === AC.i}"><b>${esc(r[0].replace('/USD', ''))}</b><span>${esc(r[1] || r[0])}</span><em>${esc(r[2] || '')}</em></button>`).join('')
    : `<div class="sgh">${SYMS ? 'No matches' : 'Loading symbol list…'}</div>`;
  acBox.hidden = false; acPlace();
}
function acPick(i) {
  const r = AC.list[i], el = AC.el; acHide(); if (!r || !el) return;
  el.value = r[0]; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); acHide(); // the field's own listeners (ticket, saved draft) see the new value
  el.focus();
}
document.addEventListener('focusin', e => { if (AC_FIELDS[e.target.id]) { e.target.setAttribute('autocomplete', 'off'); e.target.spellcheck = false; loadSyms(); } }); // no browser history list on top of ours
document.addEventListener('input', e => { if (AC_FIELDS[e.target.id] && e.isTrusted) { loadSyms(); acShow(e.target); } });
document.addEventListener('keydown', e => {
  if (acBox.hidden || e.target !== AC.el) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!AC.list.length) return; AC.i = (AC.i + (e.key === 'ArrowDown' ? 1 : -1) + AC.list.length) % AC.list.length; acBox.querySelectorAll('.sg').forEach((b, i) => b.setAttribute('aria-selected', i === AC.i)); acBox.querySelectorAll('.sg')[AC.i]?.scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'Enter' && AC.i >= 0 && AC.list.length) { e.preventDefault(); acPick(AC.i); } // picks the suggestion; a second Enter submits the form
  else if (e.key === 'Escape') acHide();
}, true);
document.addEventListener('focusout', e => { if (e.target === AC.el) setTimeout(() => { if (document.activeElement !== AC.el) acHide(); }, 150); });
acBox.addEventListener('mousedown', e => { const b = e.target.closest('.sg'); if (b) { e.preventDefault(); acPick(+b.dataset.i); } });
addEventListener('resize', acPlace); addEventListener('scroll', acPlace, true);

/* ---------- settings ---------- */
function openSettings() {
  $('#pass').value = ''; $('#passmsg').hidden = true; $('#riskSwing').value = cfg.riskSwing; $('#riskDay').value = cfg.riskDay; $('#watch').value = cfg.watch.join(', ');
  $('#settings').hidden = false; checks(); pushUI(); $('#pass').focus();
}
// Setup check (v0.17.1): everything a copy of this app needs, each with what to do when it is missing. Required items first.
async function checks() {
  const h = await api('health').catch(() => null); state.health = h; if (h && !h.error) { liveBanner(); brand(); }
  const row = (ok, t, fix, opt) => `<div><span class="${ok ? 'up' : opt ? 'muted' : 'down'}">${ok ? '●' : '○'}</span> ${t}${!ok && fix ? ` <span class="muted">· ${fix}</span>` : ''}</div>`;
  if (!h || h.error) { $('#checks').innerHTML = '<div class="err">Could not reach the server.</div>'; return; }
  const guide = h.guide ? ` <a href="${safeUrl(h.guide)}" target="_blank" rel="noopener noreferrer">Setup guide</a>` : '';
  const L = h.lastRun, age = L?.at ? (Date.now() - Date.parse(L.at)) / 36e5 : null, T = h.trading;
  const when = (t) => new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
  $('#checks').innerHTML = `<div class="muted" style="margin-bottom:2px">Required</div>` +
    row(h.alpaca, 'Alpaca paper keys (stocks, options, news, account)', 'add ALPACA_KEY_ID and ALPACA_SECRET_KEY in Vercel') +
    row(h.locked, h.locked ? 'Passcode is set' : 'No passcode: market data is open to anyone with the link, the account stays locked', 'add DASH_PASSCODE in Vercel') +
    (h.locked && !h.passStrong ? row(false, '<span class="amber">Passcode is short: 12+ characters is much harder to guess</span>', 'change DASH_PASSCODE, then redeploy') : '') +
    row(h.cron, h.cron ? 'Scheduler secret set (CRON_SECRET)' : 'CRON_SECRET missing: the bot cannot run on a schedule and sign-in is off', 'add CRON_SECRET in Vercel') +
    (h.locked ? row(h.authorized, h.authorized ? `This device is signed in${state.session?.exp ? ' until ' + when(state.session.exp) : ''} <button class="btn" id="signout" style="padding:1px 8px;margin-left:6px">Sign out</button>` : 'This device is not signed in yet', 'type the passcode above and Save') : '') +
    (h.authorized ? row(h.store, h.store ? 'Storage connected (Vercel Blob)' : 'Storage missing: the bot cannot remember anything', 'Vercel → Storage → create a Blob store and connect it') +
      row(age != null && age < 26, L?.at ? `Last scheduled bot run ${when(L.at)}${age >= 26 ? ' (over a day ago)' : ''}` : 'No scheduled bot run yet', h.botPaused ? 'the bot is paused (BOT_PAUSED)' : 'check cron-job.org (free plan) or Vercel → Settings → Cron Jobs (Pro)') +
      row(!T?.blocked, T?.live ? `<b class="down">LIVE: real money, up to $${T.cap} in the market</b>` : T?.blocked ? `<span class="amber">${esc(T.blocked)}</span>` : 'Trading: paper (practice money)', T?.blocked ? 'finish the live settings or remove TRADING_MODE' : '') : '') +
    `<div class="muted" style="margin:6px 0 2px">Optional</div>` +
    row(h.push, 'Phone notifications (VAPID keys)', 'see the guide', 1) + row(!!h.jev?.key, 'Jev AI second opinion (TYPESAFE_API_KEY)', 'optional; the bots work without it', 1) +
    row(h.fred, 'FRED key (Macro tab)', 'free at fred.stlouisfed.org', 1) + row(h.sec, 'SEC contact (company financials)', 'set SEC_USER_AGENT to your name and email', 1) +
    row(true, `Crypto data (no key needed) · version ${esc(h.version || '')}${guide}`);
}
$('#checks').addEventListener('click', async e => { if (e.target.id !== 'signout') return; await apiSend('session', null, 'DELETE'); cfg.authed = false; cfg.gate = ''; state.session = null; await checks(); Object.keys(lastLoad).forEach(k => delete lastLoad[k]); loadFor(tab, true); });
$('#openSettings').onclick = openSettings; $('#closeSettings').onclick = () => $('#settings').hidden = true;
$('#settings').addEventListener('click', e => { if (e.target.id === 'settings') $('#settings').hidden = true; });
$('#saveSettings').onclick = async () => {
  const p = $('#pass').value, pm = $('#passmsg'); pm.hidden = true;
  if (p) {
    const r = await apiSend('session', { passcode: p }); $('#pass').value = '';
    if (r.error) { pm.textContent = r.message || 'Could not sign in.'; pm.hidden = false; return; }
    await sessionLoad();
  }
  cfg.riskSwing = Math.max(50, +$('#riskSwing').value || 1000); cfg.riskDay = Math.max(50, +$('#riskDay').value || 500);
  cfg.watch = $('#watch').value.toUpperCase().split(',').map(s => s.trim()).filter(Boolean).slice(0, 30);
  ['riskSwing', 'riskDay', 'watch'].forEach(k => LS.set(k, cfg[k]));
  await checks(); Object.keys(lastLoad).forEach(k => delete lastLoad[k]); loadFor(tab, true);
  setTimeout(() => { $('#settings').hidden = true; }, 600);
};

/* ---------- phone notifications (Web Push via /sw.js) ---------- */
const b64uBytes = s => { const b = atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
const pushOk = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
async function pushUI(note) {
  const box = $('#pushbox'); if (!box) return;
  if (!pushOk()) { box.innerHTML = '<div class="muted">This browser can’t get notifications here. On iPhone: add Paper Terminal to your Home Screen (Safari → Share → Add to Home Screen), open it from that icon, then come back to Settings. Needs iOS 16.4 or newer.</div>'; return; }
  const srv = await api('push').catch(e => ({ error: 'network', message: e.message }));
  if (srv.error) { box.innerHTML = `<div class="${srv.error === 'locked' ? 'muted' : 'err'}">${esc(srv.message || srv.error)}</div>`; return; }
  if (!srv.ready) { box.innerHTML = `<div class="muted">${esc(srv.message)}</div>`; return; }
  const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription().catch(() => null);
  const on = !!sub && Notification.permission === 'granted';
  box.innerHTML = `<div>${on ? '<span class="up">●</span> On for this device' : '<span class="muted">○</span> Off on this device'} · ${srv.count} device${srv.count === 1 ? '' : 's'} signed up</div>${note ? `<div class="amber">${esc(note)}</div>` : ''}<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${on ? '<button class="btn" data-push="test">Send test</button><button class="btn" data-push="off">Turn off here</button>' : '<button class="btn primary" data-push="on">Turn on notifications</button>'}</div><div class="muted">Buys, sells, stops moved to breakeven, and stop/target fills. Fills between runs arrive at the next run.</div>`;
}
$('#pushbox').addEventListener('click', async e => {
  const b = e.target.closest('[data-push]'); if (!b) return; const k = b.dataset.push; b.disabled = true;
  try {
    if (k === 'on') {
      const perm = await Notification.requestPermission();                      // must be the first await (needs the tap)
      if (perm !== 'granted') return pushUI('Notifications are blocked. Allow them for Paper Terminal in your phone’s settings, then try again.');
      const srv = await api('push'); const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(srv.publicKey) });
      const r = await apiSend('push', { subscription: sub.toJSON() });
      return pushUI(r.error ? r.message : 'Done. A welcome notification is on its way.');
    }
    if (k === 'test') { const r = await apiSend('push', { test: true }); return pushUI(r.error ? r.message : `Sent to ${r.sent} device${r.sent === 1 ? '' : 's'}.`); }
    if (k === 'off') { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) { await apiSend('push', { endpoint: sub.endpoint }, 'DELETE'); await sub.unsubscribe(); } return pushUI('Turned off on this device.'); }
  } catch (err) { pushUI('Could not finish: ' + err.message); }
});

render(); sessionLoad().finally(() => { loadFor(tab, true); load('health', true).then(render); });
