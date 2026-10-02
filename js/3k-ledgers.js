/* ---------- Benchmark tab, Phase A (v0.16.0): costs line, experiment ledger, candidate ledger, opening-range shadow (routes/performance.js) ---------- */
(() => { const st = document.createElement('style'); st.textContent = `
.lgx td.l{white-space:normal;min-width:120px}.lgx td.l b{font-size:12.5px}.lgx .few{color:var(--muted);font-size:11px}.lgx tr.sub td:first-child{padding-left:18px;color:var(--ink2)}
.lgx .live{color:var(--up);font:700 10.5px var(--mono)}.lgx .ended{color:var(--muted);font:700 10.5px var(--mono)}.lgx tbody tr:nth-child(odd) td{background:var(--row)}
.feeline{padding:6px 10px;font-size:12.5px;color:var(--ink2);border-left:3px solid var(--amber);background:#1a1405;margin:0 10px 8px}`; document.head.appendChild(st); })();
const lgR = (v, unit = 'R') => v == null ? '—' : `<span class="${cls(v)}">${sgn(v, 2, unit === 'R' ? 'R' : '%')}</span>`;
const lgFew = (n, minN) => n < minN ? ` <span class="few">(too few)</span>` : '';
function feeLine(P) {
  const f = P?.fees; if (!f) return '';
  return `<div class="feeline"><b class="amber">Costs:</b> ${esc(f.note)}${f.paid ? ` Estimated costs so far: ${f$(f.paid)}.` : ''}</div>`;
}
function expView(P) {
  const E = P?.experiments; if (!P) return loading; if (P.error) return msg(P); if (!E) return '<div class="empty">No experiment data yet.</div>';
  return `<div class="scroll"><table class="lgx"><thead><tr><th class="l">#</th><th class="l">Experiment</th><th>Closed</th><th>Win</th><th>Avg</th><th>P&amp;L</th></tr></thead><tbody>${E.rows.map(r => `<tr><td class="l sy">${esc(r.id)}</td><td class="l"><b>${esc(r.title)}</b> <span class="${r.live ? 'live' : 'ended'}">${r.live ? 'LIVE' : 'ENDED'}</span><div class="muted" style="font-size:11.5px">since ${new Date(r.from).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET · v${esc(r.version)} · ${esc(r.bot)} bot</div><div class="muted" style="font-size:11.5px">${esc(r.change)} · measures: ${esc(r.measure)}</div>${(r.split || []).map(x => `<div style="font-size:11.5px">${esc(x.label)}: ${x.n} closed${x.n ? ` · ${nf(x.win, 0)}% win · ${lgR(x.avg)}` : ''}</div>`).join('')}</td><td>${r.n}${lgFew(r.n, E.minN)}</td><td>${r.n ? nf(r.win, 0) + '%' : '—'}</td><td>${r.n ? lgR(r.avg, r.unit) : '—'}</td><td>${r.n ? `<span class="${cls(r.pnl)}">${f$(r.pnl)}</span>` : '—'}</td></tr>`).join('')}</tbody></table></div>`;
}
function candView(P) {
  const C = P?.candidates; if (!P) return loading; if (P.error) return msg(P); if (!C || C.error) return `<div class="empty">${esc(C?.error || 'No candidate data yet.')}</div>`;
  const S = C.score || { rows: [] };
  if (!C.days) return '<div class="empty">Starts with the next stock run that looks for trades (9:45 AM ET and every 15 minutes after 10:00 AM). Each setup it sees is saved and graded after its holding period, whether it was bought or not.</div>';
  return `<div class="note" style="padding:6px 10px 0">${C.days} trading day${C.days > 1 ? 's' : ''} recorded since ${esc(C.since)}${C.pending ? ` · ${C.pending} day${C.pending > 1 ? 's' : ''} waiting for holding periods to end` : ''} · ${S.graded} graded. Needs ${S.minN}+ per row before it says anything.</div>
    <div class="scroll"><table class="lgx"><thead><tr><th class="l">What happened to the setup</th><th>Graded</th><th>Ambiguous</th><th>Win</th><th>Avg R</th></tr></thead><tbody>${S.rows.map(r => `<tr class="${/^ {2}/.test(r.label) ? 'sub' : ''}"><td class="l">${esc(r.label.trim())}</td><td>${r.n}${lgFew(r.n, S.minN)}</td><td>${r.amb}</td><td>${r.win == null ? '—' : nf(r.win, 0) + '%'}</td><td>${lgR(r.avgR)}</td></tr>`).join('')}</tbody></table></div>`;
}
function orbView(P) {
  const O = P?.orb; if (!P) return loading; if (P.error) return msg(P); if (!O || O.error) return `<div class="empty">${esc(O?.error || 'No opening-range data yet.')}</div>`;
  if (!O.last) return '<div class="empty">Starts today at the 4:20 PM ET wrap-up: the day\'s first-30-minute breakouts are replayed and scored. Nothing is traded.</div>';
  const S = O.score;
  return `<div class="note" style="padding:6px 10px 0">${S.days} trading day${S.days > 1 ? 's' : ''} since ${esc(O.since)}. Needs ${S.minN}+ signals per row before it says anything.</div>
    <div class="scroll"><table class="lgx"><thead><tr><th class="l">Signals</th><th>Scored</th><th>Ambiguous</th><th>Win</th><th>Targets</th><th>Stops</th><th>Avg R</th></tr></thead><tbody>${S.rows.map(r => `<tr><td class="l">${esc(r.label)}</td><td>${r.n}${lgFew(r.n, S.minN)}</td><td>${r.amb}</td><td>${r.win == null ? '—' : nf(r.win, 0) + '%'}</td><td>${r.targets}</td><td>${r.stops}</td><td>${lgR(r.avgR)}</td></tr>`).join('')}</tbody></table></div>
    ${O.latest?.length ? `<details style="padding:6px 10px"><summary class="amber" style="cursor:pointer">${esc(O.last)}: ${O.latest.length} signal${O.latest.length > 1 ? 's' : ''}</summary><div class="scroll"><table class="lgx"><thead><tr><th class="l">Stock</th><th class="l">Signal (ET)</th><th>Entry</th><th>Stop</th><th>Target</th><th class="l">Exit</th><th>R</th></tr></thead><tbody>${O.latest.map(x => `<tr data-sym="${esc(x.s)}"><td class="l sy">${esc(x.s)}</td><td class="l">${new Date(x.sigAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })}</td><td>${fp(x.entry)}</td><td class="down">${fp(x.stop)}</td><td class="up">${fp(x.target)}</td><td class="l">${esc(x.why)}</td><td>${lgR(x.r)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}`;
}
