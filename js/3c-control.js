/* ---------- Bot tab: kill switch + safety ladder + AI filter status (routes/control.js) ---------- */
const CT = { data: null, at: 0, arm: null, armT: null, busy: null, res: null };
const CT_LEVEL = { 1: ['Normal', 'up'], 2: ['Caution', 'amber'], 3: ['Hold', 'amber'], 4: ['Stopped', 'down'] };
function controlShell() {
  return `<section class="panel span12" id="ctl"><div class="ph"><span class="fk">01)</span><h2>Safety · kill switch</h2><span class="meta" id="ctl-meta"></span></div><div id="ctl-body">${loading}</div></section>`;
}
async function controlLoad(force) {
  if (!force && Date.now() - CT.at < 30e3) return;
  CT.at = Date.now();
  CT.data = await api('control').catch(e => ({ error: 'network', message: e.message }));
  if (CT.ovr && Date.now() < CT.ovr.until && CT.data && !CT.data.error) CT.data.mode = CT.ovr.mode; // the saved state can reach the page up to a minute late
  controlPaint(true);
}
function controlPaint(fromLoad) {
  const el = $('#ctl-body'); if (!el) return;
  if (!fromLoad) controlLoad();
  const c = CT.data; if (!c) return;
  if (c.error) { el.innerHTML = msg(c); return; }
  const sub = (x) => `<div class="muted" style="font-size:11.5px">${x}</div>`;
  const paused = c.mode === 'pause', L = c.last, lv = CT_LEVEL[L?.level] || ['—', 'muted'];
  const when = (t) => t ? new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : '';
  const modeTxt = paused ? `<b class="down">${c.by === 'auto' ? 'Auto-paused' : 'Paused'}</b>${sub(`${esc(c.reason || '')} · ${when(c.at)}`)}` : c.mode === 'unknown' ? `<b class="amber">Unknown</b>${sub(esc(c.reason || ''))}` : `<b class="up">Running</b>${sub('new trades allowed')}`;
  const J = c.jev || {}, jevTxt = !J.key ? `<b class="muted">Off</b>${sub('no TYPESAFE_API_KEY in Vercel yet')}`
    : J.mode === 'gate' ? `<b class="up">Gate</b>${sub(`${esc(J.model)} · skips weak setups, halves doubtful ones`)}`
    : J.mode === 'shadow' ? `<b class="amber">Shadow</b>${sub(`${esc(J.model)} · reads each chart as numbers, scores every new trade and reviews open ones; changes nothing yet (scorecard on the Jev tab)${c.review?.n ? ` · last review ${c.review.n} trade${c.review.n === 1 ? '' : 's'}` : ''}`)}`
    : `<b class="muted">Off</b>${sub('JEV_MODE=off')}`;
  const R = c.risk || {}, arm = (k, label, idle, klass = '') => `<button class="btn ${CT.arm === k ? 'arm' : klass}" data-ctl="${k}" ${CT.busy ? 'disabled' : ''}>${CT.arm === k ? `Tap again: ${label}` : idle}</button>`;
  el.innerHTML = `<div class="stats" style="padding:8px 10px">
      <div class="stat"><span>Kill switch</span>${modeTxt}</div>
      <div class="stat"><span>Last run safety level</span><b class="${lv[1]}">${L ? `${L.level} · ${lv[0]}` : '—'}</b>${sub(L ? `${when(L.at)}${L.drawdown != null ? ` · ${L.drawdown}% below 1-month high` : ''}` : 'shows after the next run')}</div>
      <div class="stat"><span>AI second opinion (Jev)</span>${jevTxt}</div>
    </div>
    ${L?.reasons?.length ? `<div class="pb" style="font-size:12.5px;color:var(--ink2)"><b class="amber">Why:</b> ${L.reasons.map(esc).join(' · ')}</div>` : ''}
    <div class="botrow btctl">${paused ? arm('resume', 'resume new trades', 'Resume', 'primary') : arm('pause', 'pause new trades', 'Pause new trades')}
      ${arm('stop', 'close all bot positions', 'Emergency stop', 'danger')}
      <span class="muted" style="font-size:12px">Pause = no new trades, open trades keep their stops and take profits. Emergency stop = pause + cancel the bots' orders + sell every bot position at market. Your own positions are never touched.</span></div>
    ${CT.busy ? `<div class="btbusy"><div class="bar"><i></i></div><span>${esc(CT.busy)}</span></div>` : ''}
    ${CT.res ? `<div class="${CT.res.error ? 'errmsg' : 'okmsg'}" style="margin:6px 10px">${esc(CT.res.text)}</div>` : ''}
    ${gapView(c.gap)}
    <details class="pb" style="font-size:12.5px"><summary class="muted">Safety ladder (checked at the start of every run)</summary><div style="color:var(--ink2);margin-top:6px">
      <b>1 Normal</b>: everything on. <b>2 Caution</b>: something degraded but safe (AI filter unreachable → rules only). <b>3 Hold</b>: no new trades this run: down ${Math.abs((R.dailyStop || 0) * 100)}% or more today, or prices look stale (stocks over ${R.staleStockMin} min old in market hours, crypto over ${R.staleCryptoMin} min). <b>4 Stopped</b>: no new trades until you press Resume: you paused, BOT_PAUSED is set, or the account fell ${(R.maxDrawdown || 0) * 100}% below its 1-month high (auto-pause, with a phone alert). At every level the bots still manage open trades. Only one run can happen at a time. ${isLive() ? '<b class="down">Live mode: real money, capped by LIVE_MAX_USD.</b>' : 'Paper money only.'}</div></details>`;
  $('#ctl-meta').innerHTML = `checked <span data-ago="${esc(c.at)}">${ago(c.at)}</span>`;
}
// Pre-market gap check (lib/gap.js): holdings gapping, and the stocks today's entries skip.
function gapView(g) {
  const btn = `<button class="btn" data-gaprun ${CT.gapBusy ? 'disabled' : ''}>${CT.gapBusy ? 'Checking…' : 'Run gap check now'}</button>`;
  if (!g) return `<div class="pb" style="font-size:12.5px;color:var(--ink2)"><b class="amber">Pre-market gap check:</b> not run today yet (weekdays ~8–9:25 AM ET, no orders). ${btn}</div>`;
  const when = new Date(g.at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET';
  const sk = Object.entries(g.skip || {}), mv = (g.holdings || []).filter(h => (g.movers || []).includes(h.s));
  const hl = mv.length ? mv.map(h => `<b class="${h.pct >= 0 ? 'up' : 'down'}">${esc(h.s)} ${h.pct > 0 ? '+' : ''}${h.pct}%</b> <span class="muted">(${esc(h.owner)}${h.throughStop ? `, below its stop ${h.stop}: fills near the open${h.estPl != null ? ' ≈ ' + f$(h.estPl) : ''}` : ''})</span>`).join(' · ') : '<span class="muted">no holding gapping 0.75+ ATR</span>';
  return `<div class="pb" style="font-size:12.5px;color:var(--ink2)"><b class="amber">Gap check ${esc(g.day)} ${when}${g.marketOpen ? ' (after the open: vs yesterday\'s close)' : ''}:</b> ${hl}.
    ${sk.length ? `<details style="display:inline"><summary style="display:inline;cursor:pointer" class="muted">${sk.length} stock${sk.length === 1 ? '' : 's'} skipped by today's entries</summary><div style="margin-top:4px">${sk.map(([s, w]) => `<div><b>${esc(s)}</b> ${esc(w)}</div>`).join('')}</div></details>` : '<span class="muted">No stock gapping 1+ ATR.</span>'} ${btn}</div>`;
}
async function controlAct(k) {
  CT.arm = null; CT.res = null;
  CT.busy = k === 'stop' ? 'Emergency stop: pausing, canceling the bots\' orders, selling bot positions…' : k === 'pause' ? 'Pausing new trades…' : 'Resuming…';
  controlPaint(true);
  const r = await apiSend('control', { action: k }).catch(e => ({ error: 'network', message: e.message }));
  CT.busy = null;
  if (!r.error && r.mode) CT.ovr = { mode: r.mode, until: Date.now() + 75e3 };
  CT.res = r.error ? { error: true, text: r.message || r.error }
    : k === 'stop' ? { text: `Stopped. Sent closes for ${r.closed?.length || 0} bot position(s) (${f$(r.pl)} open P&L), canceled ${r.canceled || 0} order(s)${r.errors?.length ? `. Problems: ${r.errors.join('; ')}` : ''}.${r.left?.length ? ` Still open after the check: ${r.left.map(l => `${l.s} (${f$(l.value)})`).join(', ')}; press Emergency stop again or close them in Alpaca.` : r.checked === false ? ' Could not re-check positions afterwards; look at the Account tab.' : ' Re-checked: no bot positions left.'} Bots paused until you press Resume.` }
    : { text: k === 'pause' ? 'Paused. No new trades until you resume.' : 'Resumed. New trades allowed from the next run.' };
  await controlLoad(true);
  if (k === 'stop' && typeof load === 'function') { delete lastLoad.botview; delete lastLoad.account; load('botview', true); load('account', true); }
}
document.addEventListener('click', async e => {
  if (e.target.closest('[data-gaprun]')) { CT.gapBusy = true; controlPaint(true); const r = await api('gapcheck', { run: '1' }).catch(x => ({ error: 'network', message: x.message })); CT.gapBusy = false; CT.res = r.error ? { error: true, text: r.message || r.error } : null; await controlLoad(true); return; }
  const b = e.target.closest('[data-ctl]'); if (!b) return;
  const k = b.dataset.ctl;
  if (CT.arm !== k) { CT.arm = k; clearTimeout(CT.armT); CT.armT = setTimeout(() => { CT.arm = null; controlPaint(true); }, 4000); controlPaint(true); return; }
  clearTimeout(CT.armT); controlAct(k);
});
