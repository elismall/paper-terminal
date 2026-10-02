// Paper Terminal front end, part 3i (v0.12.0): the DCA tab (key D). Everything about the DCA bot in one place: run buttons, live
// stats and rules, every open deal with its chart and full dip-buy ladder, every resting order (dip buys, take profits, trailing
// floors) with its distance from the price, DCA-only activity, closed deals, the $100 plan (concentrated DCA vs momentum,
// virtual), the DCA lab and the daily training. The Bot tab keeps a one-line DCA summary (dcaLine). Classic script; loads after 3h.
const DT = { html: {} };
(() => { const st = document.createElement('style'); st.textContent = `
.dtrest .st{font:700 11px var(--mono);letter-spacing:.03em}.dtrest .st.rest{color:var(--up)}.dtrest .st.wait{color:var(--muted)}.dtrest small{display:block;font-size:11px}@media(max-width:640px){.dtrest .amt{display:none}}
.sm .vbox dl{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:6px 0;font:12.5px var(--mono)}.sm .vbox dt{color:var(--muted)}.sm .vbox dd{margin:0;text-align:right}
.sm .big{font:700 22px var(--mono);color:#fff}.sm ul{margin:4px 0 0;padding-left:16px;font:12px var(--mono)}.sm li{margin:2px 0}`; document.head.appendChild(st); })();
const dtSet = (id, html) => { const el = $('#' + id); if (el && DT.html[id] !== html) { el.innerHTML = html; DT.html[id] = html; } };
const dtT = (t) => new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';

function dcaTabShell() {
  DT.html = {};
  return `<div class="grid" id="dcaroot">
    <section class="panel span12"><div class="ph"><span class="fk">D1)</span><h2>DCA bot · ${isLive() ? 'LIVE' : 'paper'}</h2><span class="meta" id="dt-meta"></span></div><div id="dt-ctl"></div></section>
    ${dcaShell()}
    <section class="panel span6"><div class="ph"><span class="fk">D3)</span><h2>Resting orders</h2><span class="meta">dip buys and take profits waiting at Alpaca</span></div><div id="dt-rest"></div></section>
    <section class="panel span6"><div class="ph"><span class="fk">D4)</span><h2>DCA activity</h2><span class="meta">deals started, dip buys, take profits, hard exits</span></div><ol class="feed" id="dt-feed"></ol></section>
    <section class="panel span12"><div class="ph"><span class="fk">D5)</span><h2>Closed deals</h2><span class="meta" id="dt-closedmeta"></span></div><div id="dt-closed"></div></section>
    <section class="panel span12"><div class="ph"><span class="fk">D6)</span><h2>$100 plan · concentrated DCA vs momentum</h2><span class="meta">virtual: real prices, no orders</span></div><div id="dt-small"></div></section>
    <section class="panel span12"><div class="ph"><span class="fk">D7)</span><h2>Crypto DCA lab</h2><span class="meta">which coins, bull runs, up to 4 years</span></div><div id="dt-lab"></div></section>
    <section class="panel span12"><div class="ph"><span class="fk">D8)</span><h2>DCA training</h2><span class="meta" id="dt-trainmeta"></span></div><div id="dt-train"></div></section></div>`;
}
function dcaCtl(v) {
  const armed = (k, label) => BT.arm === k ? `Tap again: ${label}` : null, busy = BT.busy ? `<div class="btbusy"><div class="bar"><i></i></div><span>${esc(BT.busy)}</span></div>` : '';
  return `<div class="botrow btctl"><button class="btn ${BT.arm === 'd' ? 'arm' : 'primary'}" data-botrun="d" ${BT.busy ? 'disabled' : ''}>${armed('d', 'run DCA') || 'Run DCA now'}</button>
    <button class="btn ${BT.arm === 'c' ? 'arm' : ''}" data-botrun="c" ${BT.busy ? 'disabled' : ''}>${armed('c', 'run crypto check') || 'Run crypto check now'}</button>
    <button class="btn" data-botrun="dry" ${BT.busy ? 'disabled' : ''}>Preview (no orders)</button>
    <span class="muted" style="font-size:12px">Crypto deals are checked every 5 minutes; ETF deals every 15 minutes while the market is open.</span></div>${busy}${v?.error ? msg(v) : ''}`;
}
// Every order the DCA bot has resting (or will place at the next check), nearest to the price first.
function dcaRestView(v) {
  const deals = v?.dca?.deals; if (!deals) return v?.error ? '' : loading;
  const rows = [];
  for (const d of deals) {
    for (const L of d.levels.filter(L => !L.filled)) rows.push({ s: d.s, what: `Dip #${L.j} −${L.dev}%`, px: L.px, usd: L.usd, live: L.live, now: d.px });
    if (d.trail) rows.push({ s: d.s, what: d.trail.on ? `Trail floor` : `Trail starts`, px: d.trail.on ? d.trail.floor : d.trail.act, usd: null, live: d.trail.on ? d.trail.live : null, now: d.px, sell: true });
    else rows.push({ s: d.s, what: `Take profit +${d.S.tp}%`, px: d.tp, usd: d.qty * d.tp, live: d.tpLive, now: d.px, sell: true });
    if (d.exitPx) rows.push({ s: d.s, what: 'Hard exit', px: d.exitPx, usd: null, live: null, now: d.px, sell: true, exit: true });
  }
  if (!rows.length) return '<div class="empty">No open deals, so nothing is resting.</div>';
  rows.forEach(r => { r.away = (r.px / r.now - 1) * 100; }); rows.sort((a, z) => Math.abs(a.away) - Math.abs(z.away));
  const st = (r) => r.live === true ? '<span class="st rest">RESTING</span>' : r.live === false ? '<span class="st wait">NEXT</span>' : '<span class="st wait">WATCH</span>';
  return `<div class="scroll dtrest"><table><thead><tr><th class="l">Coin</th><th class="l">Order</th><th>Price · away</th><th class="amt">Amount</th><th>Status</th></tr></thead><tbody>${rows.map(r => `<tr data-sym="${esc(r.s)}"><td class="l sy">${esc(r.s.replace('/USD', ''))}</td><td class="l ${r.exit ? 'down' : r.sell ? 'up' : ''}">${esc(r.what)}</td><td>${fp(r.px)}<small class="${cls(r.away)}">${sgn(r.away, 2, '%')}</small></td><td class="amt">${r.usd != null ? f$(r.usd) : '—'}</td><td>${st(r)}</td></tr>`).join('')}</tbody></table></div>
    <div class="muted" style="font-size:11.5px;padding:4px 10px 8px">RESTING = the order is at Alpaca now. NEXT = placed at the next check (every 5 minutes). WATCH = the bot acts itself when price gets there: the trailing take profit starts, or the hard exit sells at market.</div>`;
}
function dcaFeedView(v) {
  if (!v || v.error) return v?.error ? '' : `<li>${loading}</li>`;
  const evs = v.events.filter(e => e.bot === 'DCA' || e.bot === 'Bull-run core');
  return evs.length ? evs.slice(0, 60).map(e => `<li class="ev ev-${e.type}"><i>${EVI[e.type] || '•'}</i><div><b>${esc(e.text)}</b><small>${dtT(e.t)} · <span data-ago="${esc(e.t)}">${ago(e.t)}</span></small></div>${e.pnl != null ? `<span class="num"><b class="${cls(e.pnl)}">${f$(e.pnl)}</b>${e.entry && e.px ? ` <span class="${cls(e.px - e.entry)}">${fpct((e.px / e.entry - 1) * 100)}</span>` : ''}</span>` : ''}</li>`).join('')
    : '<li class="empty">No DCA activity yet.</li>';
}
// The $100 plan: live virtual accounts + the lab's backtest (fresh $100 on each window).
const m2 = (v) => v == null ? '—' : (v < 0 ? '−$' : '$') + Math.abs(v).toFixed(2); // the $100 plan shows cents everywhere
function smallView(J) {
  if (!J) return `<div class="lab">${loading}</div>`; if (J.error) return `<div class="lab">${msg(J)}</div>`;
  const live = J.small, B = J.lab?.small, R = live?.rules || B?.rules;
  const upd = `<div class="row"><button class="btn" data-small="run" ${DT.smallBusy ? 'disabled' : ''}>${DT.smallBusy ? 'Updating…' : 'Update now'}</button><span class="note">${esc(DT.smallNote || '')}</span></div>`;
  const rules = R ? `<div class="note">Each strategy trades its own $${R.start}: ${R.slots} positions at once, ${Math.round(R.keep * 100)}% of every profit goes back into trading and ${Math.round((1 - R.keep) * 100)}% into a vault it never touches, no new entries once the account is under $${R.floor} (this is a pause, not a loss cap: open positions keep running and can fall further). Costs as on a real Alpaca account: ${R.taker * 100}% market orders, ${R.maker * 100}% limit orders, $${R.minOrder} minimum order. <b>Virtual</b>: tracked on real prices, no orders are sent, not even paper ones.</div>` : '';
  const acctBox = (m) => {
    const A = live?.acct?.[m]; const text = live?.params?.text?.[m];
    if (!A) return `<div class="vbox"><b class="h">${m === 'dca' ? 'CONCENTRATED DCA' : 'MOMENTUM'}</b><div class="muted">Season 2 restarted it at $100 (Sep 30, 2026). Starts at the next hourly step (or press Update now).</div></div>`;
    const flags = [A.killed ? `<span class="down">Under $${R.floor} since ${dtT(A.killed)}: no new entries</span>` : '', A.hit2 ? `<span class="up">Doubled on ${dtT(A.hit2)}</span>` : '', A.hit10 ? `<span class="up">Hit $1,000 on ${dtT(A.hit10)}</span>` : ''].filter(Boolean).join(' · ');
    const open = A.open.length ? `<div class="scroll"><table><thead><tr><th class="l">Coin</th><th>In</th><th>Now</th><th>P&amp;L</th><th>${m === 'dca' ? 'Dip buys' : 'Sells under'}</th></tr></thead><tbody>${A.open.map(p => `<tr data-sym="${esc(p.s)}"><td class="l sy">${esc(p.s.replace('/USD', ''))}</td><td>${m2(p.cost)}</td><td>${m2(p.value)}</td><td class="${cls(p.pl)}">${m2(p.pl)}</td><td>${m === 'dca' ? `${p.dips}${p.next ? ` · next ${fp(p.next.px)}` : ''}` : fp(p.stop)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="muted">No open positions.</div>';
    const last = A.last.length ? `<ul>${A.last.slice(0, 5).map(t => `<li>${dtT(t.out)} · ${esc(t.s.replace('/USD', ''))} · ${esc(t.why)} · <b class="${cls(t.pnl)}">${m2(t.pnl)}</b> (${sgn(t.pct, 1, '%')})${t.vault ? ` · ${m2(t.vault)} to vault` : ''}</li>`).join('')}</ul>` : '';
    return `<div class="vbox"><b class="h">${m === 'dca' ? 'CONCENTRATED DCA' : 'MOMENTUM'}</b><span class="big">${m2(A.total)}</span> <span class="${cls(A.ret)}">${sgn(A.ret, 1, '%')}</span>
      <dl><dt>Trading</dt><dd>${m2(A.trading)}</dd><dt>Vault (kept)</dt><dd>${m2(A.vault)}</dd><dt>Closed</dt><dd>${A.n}${A.n ? ` · ${nf(A.win, 0, '%')} win` : ''}</dd><dt>Worst drop</dt><dd>${nf(A.dd, 1, '%')}</dd></dl>
      ${flags ? `<div style="margin-bottom:4px">${flags}</div>` : ''}<div class="muted" style="font-size:12px;margin-bottom:4px">${esc(text || '')}</div>${open}${last}</div>`;
  };
  const since = live?.since ? `<div class="note">Virtual accounts since ${dtT(live.since)} · settings ${esc(live.params?.src || '')} · last check ${live.at ? dtT(live.at) : '—'}</div>` : '';
  let bt = '<div class="empty">Backtest: runs with the DCA lab (Sunday about 5:10 AM ET, or Run the lab now below).</div>';
  if (B) {
    const row = (m) => { const x = B[m], d = (v) => v == null ? '—' : `${v} days`; return `<tr class="${B.better === m ? 'pick' : ''}"><td class="l">${esc(x.name)}${B.better === m ? ' <span class="tag t-n">better on unseen data</span>' : ''}</td><td>${m2(x.b.end)}</td><td>${nf(x.b.dd, 1, '%')}</td><td>${x.b.n}</td><td>${m2(x.a.end)}</td><td>${m2(x.all.end)}</td><td>${nf(x.all.dd, 1, '%')}</td><td>${d(x.all.to2x)}</td><td>${d(x.all.to10x)}</td><td>${x.all.stopped || '—'}</td></tr>`; };
    bt = `<div class="scroll"><table><thead><tr><th class="l">$100 start</th><th>Last third (unseen)</th><th>Worst drop</th><th>Trades</th><th>First 2/3</th><th>Whole test</th><th>Worst drop</th><th>To $200</th><th>To $1,000</th><th>Fell under $${B.rules.floor} (entries paused)</th></tr></thead><tbody>
      ${row('dca')}${row('mom')}<tr><td class="l muted">Hold BTC</td><td>${m2(B.btc.b)}</td><td></td><td></td><td>${m2(B.btc.a)}</td><td>${m2(B.btc.all)}</td><td colspan="4"></td></tr></tbody></table></div>
      <div class="note">Picked settings: DCA · ${esc(B.dca.text)}. Momentum · ${esc(B.mom.text)}. ${esc(B.note)} Split at ${esc(B.split)}.</div>`;
  }
  return `<div class="lab sm">${upd}${rules}${since}<div class="verd">${acctBox('dca')}${acctBox('mom')}</div><div class="sub amber">Backtest</div>${bt}</div>`;
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-small]'); if (!b || DT.smallBusy) return;
  DT.smallBusy = true; DT.smallNote = ''; render();
  const j = await api('dcalab', { small: '1' }).catch(x => ({ error: 'network', message: x.message }));
  DT.smallBusy = false; if (!j.error) state.dcalab = j; DT.smallNote = j.error ? (j.message || j.error) : (j.small?.notes || []).join(' · ') || 'Checked: nothing new.'; render();
});
function dcaTabPaint() {
  const v = state.botview, P = state.performance, Bm = state.benchmark;
  $('#dt-meta').innerHTML = v && !v.error ? `updated <span data-ago="${esc(v.at)}">${ago(v.at)}</span> · refreshes every 20 s` : '';
  $('#dt-ctl').innerHTML = dcaCtl(v);
  dcaPaint(v);
  dtSet('dt-rest', dcaRestView(v));
  dtSet('dt-feed', dcaFeedView(v));
  const n = P?.compare?.deals?.length; $('#dt-closedmeta').textContent = n ? `${n} most recent · P&L to the cent` : '';
  dtSet('dt-closed', dcaClosedView(P));
  dtSet('dt-small', smallView(state.dcalab));
  dtSet('dt-lab', labView(state.dcalab));
  $('#dt-trainmeta').textContent = Bm?.dca?.at ? 'retrained daily · as of ' + dtT(Bm.dca.at) : '';
  dtSet('dt-train', dcaTrainView(Bm));
}
// Bot tab: one line about the DCA bot, the rest lives on the DCA tab.
function dcaLine(v) {
  const d = v && !v.error ? v.dca : null; if (!d) return '';
  const deals = d.deals || [], pl = deals.reduce((a, x) => a + (x.pl || 0), 0), resting = deals.reduce((a, x) => a + x.levels.filter(L => !L.filled && L.live).length, 0);
  return `<div class="botrow" style="align-items:center;justify-content:space-between"><span><b>DCA bot</b> · ${deals.length} open deal${deals.length === 1 ? '' : 's'} · open P&amp;L <b class="${cls(pl)}">${f$(pl)}</b> · ${resting} dip buy${resting === 1 ? '' : 's'} resting · ${v.today?.dca ?? 0} started today</span><button class="btn primary" data-go="dca">Open the DCA tab (D)</button></div>`;
}
document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go); });
