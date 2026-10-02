// Paper Terminal front end, part 3j: the Catalyst panel on the Options tab (routes/catalyst.js, lib/catalyst.js). v0.13.0; rebuilt in
// v0.15.0 as "Catalyst evidence and outcomes": event evidence (dated sources, status, missing details), comparable past events with
// source coverage, bull / base / bear cards (history shown as counts, conditional cards labeled), trade plans side by side with
// costs and scenario payoffs, option contracts with payoffs, Jev's reading of the evidence kept apart, and the graded log. Classic script.
SCHED.catalyst = 6e5; NEED.options.push('catalyst');
const CA = { busy: false, res: LS.get('catRes', null), err: '' };
(() => { const st = document.createElement('style'); st.textContent = `
.cat{padding:8px 10px;display:grid;gap:10px;min-width:0}.cat>*{min-width:0}
.cat form{display:grid;grid-template-columns:120px 1fr;gap:6px 10px;align-items:center}
.cat form .row{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;grid-column:1/-1}
.cat textarea{width:100%;min-height:52px;resize:vertical;font:13px var(--sans);box-sizing:border-box}
.cat .box{background:var(--panel2);border:1px solid var(--line);padding:8px 10px;font:13px var(--sans);color:var(--ink2);min-width:0}
.cat .box b.h{display:block;font:700 12px var(--mono);letter-spacing:.04em;color:var(--amber);margin-bottom:4px}
.cat .boxes{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:8px}
.cat .scen{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:8px}.cat .scen .box{border-top:3px solid var(--line)}.cat .scen .bull{border-top-color:#26a69a}.cat .scen .bear{border-top-color:#ef5350}
.cat .chip{display:inline-block;font:700 11px var(--mono);padding:1px 6px;border:1px solid currentColor;border-radius:3px;margin-right:6px;white-space:nowrap}.cat .chip.ok{color:#26a69a}.cat .chip.warnc{color:var(--amber)}.cat .chip.bad{color:#ef5350}
.cat ul.src{margin:4px 0 0;padding-left:16px}.cat ul.src li{margin:2px 0;overflow-wrap:anywhere}.cat .big{font:700 15px var(--mono);color:var(--ink)}.cat .kvt.wrap td:first-child{white-space:normal;min-width:88px}.cat .kvt.wrap td{overflow-wrap:anywhere}.cat .sub2{font:11.5px var(--mono);color:var(--muted);margin-top:4px}
.cat table{width:100%;border-collapse:collapse;font:12.5px var(--mono)}.cat td,.cat th{padding:3px 6px;text-align:right;border-bottom:1px solid #151515;white-space:nowrap}
.cat td.l,.cat th.l{text-align:left}.cat .kvt td{white-space:normal;vertical-align:top}.cat .kvt td:first-child{white-space:nowrap;color:var(--muted)}.cat td.w{white-space:normal;min-width:220px}.cat .warn{font-size:12.5px;color:var(--amber)}.cat .note{font:11.5px var(--mono);color:var(--muted)}
@media (max-width:560px){.cat form{grid-template-columns:1fr}}`; document.head.appendChild(st); })();
const catT = (t) => t ? new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : '—';
const catP = (v, d = 1) => v == null ? '—' : `<span class="${cls(v)}">${sgn(v, d, '%')}</span>`;
const CAT_KINDS = { earnings: 'Earnings', product: 'Product launch / company event', rumor: 'Rumor / media report', regulatory: 'FDA / regulatory / court', deal: 'Deal / merger / partnership', analyst: 'Analyst upgrade / downgrade', macro: 'Macro (Fed, CPI, jobs)', other: 'Other' };
const CAT_NOTE = 'Stocks only. Four things are kept apart: whether the event is supported by dated sources (Unverified hypothetical when none are found), what could happen (bull / base / bear), how comparable past events for THIS stock actually moved (counts, not probabilities; bull and bear cards only look at the events that rose or fell), and whether a trade plan is attractive after costs. Numbers come from code (SEC filings, SEC full-text search, past headlines, Fed and FRED dates, the option chain); Jev only judges the evidence it is shown, and its answer confidence is not a chance the event happens or the stock rises. Every run is saved and graded from the next session\'s open. A planning tool, not advice; paper account.';
function catShell() {
  const f = LS.get('catForm', {});
  const opt = (v, l, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`;
  return panel('ca', '40)', 'Catalyst evidence and outcomes', 'stocks · evidence, history, scenarios, plans', `<div class="cat"><form id="catform">
    <label for="ca-sym">Stock</label><input class="in" id="ca-sym" required maxlength="30" autocomplete="off" spellcheck="false" style="width:110px;text-transform:uppercase" value="${esc(f.sym || '')}" placeholder="AAPL">
    <label for="ca-text">Scenario</label><textarea class="in" id="ca-text" maxlength="500" placeholder="e.g. beats and raises guidance · rumored new product next month · FDA decision Friday · CPI comes in hot">${esc(f.text || '')}</textarea>
    <div class="row"><label>Type <select class="in" id="ca-kind">${opt('', 'Auto (Jev / keywords)', f.kind)}${Object.entries(CAT_KINDS).map(([k, l]) => opt(k, l, f.kind)).join('')}</select></label>
      <label>Direction <select class="in" id="ca-dir">${opt('', 'Auto', f.dir)}${opt('up', 'Up', f.dir)}${opt('down', 'Down', f.dir)}</select></label>
      <label>Date <input class="in" id="ca-date" type="date" value="${esc(f.date || '')}" title="Leave empty if the news is out now"></label>
      <label>Hold for <select class="in" id="ca-h">${[[1, '1 day'], [5, '1 week'], [10, '2 weeks'], [20, '1 month']].map(([v, l]) => opt(String(v), l, String(f.h || 5))).join('')}</select></label>
      <button class="btn primary" id="ca-go">Run scenario</button><span class="note" id="ca-busy"></span></div></form>
    <div id="ca-res"></div><div id="ca-log"></div></div>`, 'span12', CAT_NOTE);
}
function catPaint() {
  const r = $('#ca-res'), l = $('#ca-log'); if (!r || !l) return;
  const b = $('#ca-busy'); if (b) b.textContent = CA.busy ? 'Reading sources, history, filings and the option chain…' : '';
  const go = $('#ca-go'); if (go) go.disabled = CA.busy;
  r.innerHTML = CA.err ? `<div class="errmsg">${esc(CA.err)}</div>` : CA.res ? catResult(CA.res) : '';
  l.innerHTML = catLog(state.catalyst);
}
const catChip = (code) => ({ confirmed: 'ok', scheduled: 'ok', scheduled_est: 'ok', credible: 'ok', sources: 'warnc', rumor: 'warnc', unverified: 'bad' }[code] || 'warnc');
const catJ = (a, labels) => a && a.choice ? `<b>${esc(labels?.[a.choice] || a.choice.replace(/_/g, ' '))}</b>${a.conf != null ? ` <span class="muted">(answer confidence ${Math.round(a.conf * 100)}%)</span>` : ''}` : '<span class="muted">no answer</span>';
function catResult(x) {
  if (x.v !== 2) return '<div class="note">This saved answer is from before v0.15.0. Run the scenario again for the evidence and outcomes view.</div>';
  const S = x.stats || {}, m = S.move || {}, dd = S.day || {}, ru = S.runup || {}, h = x.horizon, hl = h === 1 ? '1-day' : `${h}-day`, E = x.evidence || {}, up = x.dir === 'up';
  const head = `<div style="font-size:13px"><b class="sy">${esc(x.s)}</b> at ${fp(x.px)} · <b>${esc(x.kindLabel)}</b> <span class="muted">(${esc(x.how.kind)})</span> · if it happens: <b class="${up ? 'up' : x.dir === 'down' ? 'down' : 'muted'}">${up ? 'up' : x.dir === 'down' ? 'down' : 'unclear'}</b> <span class="muted">(${esc(x.how.dir)})</span> · hold ${h === 1 ? '1 day' : h + ' trading days'}${x.date ? ` · event ${esc(x.date)}` : ' · news out now'}<div class="muted" style="font-size:12px">"${esc(x.text || '(no text)')}" · ran ${catT(x.at)} · graded from ${x.start === 'event' ? 'the close before the event session' : 'the next session\'s open'}</div></div>`;
  const warn = [...(x.warn || []), ...(x.notes || []).map(n => `Note: ${n}.`)].map(w => `<div class="warn">${esc(w)}</div>`).join('');
  const ev = `<div class="box"><b class="h">1 · EVENT EVIDENCE</b><div><span class="chip ${catChip(E.status?.code)}">${esc((E.status?.code || '').replace('_est', '').toUpperCase())}</span>${esc(E.status?.label || '')}</div>
    <div class="sub2">${esc(E.basis || '')}</div>
    ${E.sources?.length ? `<ul class="src">${E.sources.map(s => `<li><span class="muted">${esc(s.date)} · ${esc(s.src)}</span> ${s.url ? `<a href="${safeUrl(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.text)}</a>` : esc(s.text)}</li>`).join('')}</ul>` : '<div class="muted" style="margin-top:4px">No dated source about this in the last 30 days (this stock\'s headlines and SEC 8-Ks were searched).</div>'}
    ${E.missing?.length ? `<div class="warn" style="margin-top:4px">Missing: ${esc(E.missing.join(' · '))}</div>` : ''}</div>`;
  const cov = (x.coverage || []).map(c => `<li>${esc(c.src)}: ${c.ok === false ? '<span class="down">unavailable</span>' : `${c.n ?? '—'} ${c.matched != null ? `headlines read, ${c.matched} matched` : 'found'}${c.from ? ` · from ${esc(c.from)}` : ''}`}${c.dropped ? ` · ${c.dropped} multi-stock stories left out` : ''}${c.left ? ` · ${esc(c.left)}` : ''}${c.note ? ` · <span class="amber">${esc(c.note)}</span>` : ''}</li>`).join('');
  const hist = `<div class="box"><b class="h">2 · COMPARABLE PAST EVENTS (${x.counted} since ${esc(x.since)})</b><div><span class="chip ${x.match?.code === 'exact' || x.match?.code === 'words' ? 'ok' : x.match?.code === 'none' ? 'bad' : 'warnc'}">MATCH</span>${esc(x.match?.label || '')}</div>${x.counted ? `<table class="kvt wrap"><tbody>
      <tr><td class="l">${hl} move, all events</td><td class="l">median ${catP(m.median)} · middle half ${catP(m.p25)} to ${catP(m.p75)} · 10–90% ${catP(m.p10)} to ${catP(m.p90)}</td></tr>
      <tr><td class="l">Up / down</td><td class="l"><b>${m.upN}</b> up, <b>${m.downN}</b> down of ${m.n}${m.n < 20 ? ' <span class="amber">(small sample: counts, not odds)</span>' : ''}</td></tr>
      <tr><td class="l">Only the rises</td><td class="l">${S.upMoves?.n ? `median ${catP(S.upMoves.median)} (${S.upMoves.n} events)` : '—'}</td></tr>
      <tr><td class="l">Only the falls</td><td class="l">${S.downMoves?.n ? `median ${catP(S.downMoves.median)} (${S.downMoves.n} events)` : '—'}</td></tr>
      <tr><td class="l">Reaction day</td><td class="l">median ${catP(dd.median)} · typical size ${catP(dd.medAbs)}</td></tr>
      <tr><td class="l">Run-up before</td><td class="l">median ${catP(ru.median)} over the 5 days before · now ${catP(x.anticipation?.runup_5d_pct)}</td></tr></tbody></table>` : '<div class="muted">No past events matched.</div>'}
    <div style="margin-top:4px">Normal ${hl} move: ±${nf(x.normal.hPct, 1)}% · ATR ${fp(x.normal.atr)} (${nf(x.normal.atrPct, 1)}%)${x.implied ? ` · options price in <b>±${x.implied.pct}%</b> by ${esc(x.implied.exp)}` : ''}</div>
    <div class="sub2">Coverage (missing history means unknown, not "no events"):</div><ul class="src" style="font-size:12px">${cov || '<li>—</li>'}${x.clustered || x.earnWeek ? `<li>Left out: ${x.clustered ? `${x.clustered} repeat headlines merged` : ''}${x.clustered && x.earnWeek ? ' · ' : ''}${x.earnWeek ? `${x.earnWeek} in earnings weeks` : ''}</li>` : ''}</ul>
    <div class="sub2">Graded range: ${catP(x.band.lo)} to ${catP(x.band.hi)} (${esc(x.band.src)})</div></div>`;
  const sc = x.scen || {}, card = (k, t) => { const c = sc[k]; if (!c) return ''; const num = c.median == null ? '—' : catP(c.median);
    return `<div class="box ${k}"><b class="h">${t}${c.conditional ? ' · CONDITIONAL' : ''}</b><div class="big">${num} <span class="muted" style="font:12px var(--mono)">median ${hl}${c.basis === 'volatility' ? ', from volatility' : ''}</span></div>
      <div style="margin-top:3px">${esc(c.cond)}</div>${k === 'base' && c.p25 != null ? `<div class="sub2">middle half ${catP(c.p25)} to ${catP(c.p75)}${c.upN != null ? ` · ${c.upN} up / ${c.downN} down` : ''}</div>` : ''}
      ${k === 'bull' && c.max != null ? `<div class="sub2">largest rise ${catP(c.max)}</div>` : ''}${k === 'bear' && c.min != null ? `<div class="sub2">largest fall ${catP(c.min)}</div>` : ''}
      <div class="sub2">${esc(c.check || '')}</div>${(c.uncertain || []).map(u => `<div class="warn">${esc(u)}</div>`).join('')}</div>`; };
  const scen = `<div><b class="h" style="font:700 12px var(--mono);color:var(--amber)">3 · WHAT COULD HAPPEN</b> <span class="note">historical outcomes for this stock; bull and bear only count the events that rose or fell, so they are not odds</span><div class="scen" style="margin-top:4px">${card('bear', 'BEAR')}${card('base', 'BASE')}${card('bull', 'BULL')}</div></div>`;
  const P = x.plans || [], T = x.test, cond = x.targetKind === 'conditional';
  const plans = P.length ? `<div class="box" style="grid-column:1/-1"><b class="h">4 · TRADE PLANS (${up ? 'LONG' : 'SHORT'}) · costs ${x.costPct}% a side</b><div class="scroll"><table><thead><tr><th class="l">Plan</th><th>Entry</th><th>Stop</th><th>Target${cond ? ' (conditional ref.)' : ''}</th><th>Reward/risk after costs</th><th>If bear</th><th>If base</th><th>If bull</th><th></th></tr></thead><tbody>
    ${P.map(p => p.id === 'none' ? `<tr><td class="l"><b>${esc(p.label)}</b></td><td class="l w" colspan="8">${p.supported ? `<span class="amber">${esc(p.note)}</span>` : esc(p.note)}</td></tr>`
      : `<tr><td class="l"><b>${esc(p.label)}</b><div class="note" style="white-space:normal;max-width:260px">${esc(p.note)}</div></td><td>${fp(p.entry)}</td><td class="down">${fp(p.stop)}</td><td class="up">${fp(p.target)}</td><td class="${p.rr >= 1 ? '' : 'amber'}">${nf(p.rr, 2)}×</td><td>${catP(p.pay?.bear)}</td><td>${catP(p.pay?.base)}</td><td>${catP(p.pay?.bull)}</td>
        <td>${p.id !== 'confirm' ? `<button class="btn tradebtn" style="padding:1px 8px" data-ticket='${esc(JSON.stringify({ symbol: x.s, side: up ? 'buy' : 'sell', type: p.id === 'now' ? 'market' : 'limit', limit_price: p.id === 'now' ? undefined : p.entry, stop_loss: p.stop, take_profit: p.target, px: x.px }))}'>Ticket</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
    ${cond ? `<div class="muted" style="font-size:12px">Target = ${esc(x.swing?.basis || '')}. A reward/risk near 1× does not by itself mean an edge.</div>` : ''}
    ${T ? `<div class="sub2">"Enter now" replayed on the ${T.n} past events: target first ${T.target} · stop first ${T.stop} · time exit ${T.time} · ambiguous ${T.ambiguous} · average ${nf(T.avgR, 2)}R (worst case ${nf(T.avgRWorst, 2)}R)${T.win != null ? ` · ${T.win}% winners` : ''}. ${esc(T.note)}</div>` : ''}
    <div class="sub2">Scenario columns: the plan's result if the stock ends the hold at that card's median, capped at the stop and target; ignores the path.</div></div>`
    : `<div class="box"><b class="h">4 · TRADE PLANS</b>No clear direction, so no plan. Pick Up or Down if you have a view.</div>`;
  const O = x.options, opts = O?.strikes ? `<div class="box" style="grid-column:1/-1"><b class="h">5 · ${esc(O.strategy.toUpperCase())} · ${esc(O.exp)} (${O.dte} days)</b><div class="scroll"><table><thead><tr><th class="l">Strike</th><th>Cost</th><th>Bid/ask spread</th><th>Breakeven</th><th>Past events cleared</th><th>IV</th><th>If bear</th><th>If base</th><th>If bull</th><th>Quote</th><th></th></tr></thead><tbody>${O.strikes.map(k => `<tr><td class="l">${esc(k.label)} <b>${fp(k.k)}</b></td><td>${f$(k.cost)}</td><td class="${k.spread > 15 ? 'amber' : ''}">${k.spread == null ? '—' : k.spread + '%'}</td><td>${fp(k.breakeven)} <span class="muted">(${sgn(k.bePct, 1, '%')})</span></td><td>${k.pastCleared == null ? '—' : `${k.pastCleared} of ${k.pastN}`}</td><td>${k.iv == null ? '—' : k.iv + '%'}</td><td class="${cls(k.pay?.bear)}">${f$(k.pay?.bear)}</td><td class="${cls(k.pay?.base)}">${f$(k.pay?.base)}</td><td class="${cls(k.pay?.bull)}">${f$(k.pay?.bull)}</td><td class="muted">${k.qt ? catT(k.qt) : '—'}</td><td><button class="btn tradebtn" style="padding:1px 8px" data-ticket='${esc(JSON.stringify({ symbol: k.occ, side: 'buy', qty: 1, type: 'limit', limit_price: k.mid > 0 ? k.mid : k.ask, label: `Buy ${x.s} ${O.exp} ${k.k} ${O.strategy === 'Long put' ? 'put' : 'call'}` }))}'>Buy</button></td></tr>`).join('')}</tbody></table></div>
    <div class="muted" style="font-size:12px;margin-top:4px">Payoff columns: per contract at expiry if the stock ends at that card's median move (ignores time value left). "Past events cleared" = past events that moved at least to the breakeven. Indicative quotes; max loss = what you pay. A bullish catalyst alone does not make buying a call attractive.</div></div>`
    : x.dir === 'unclear' ? '' : `<div class="box"><b class="h">5 · OPTIONS</b>Not assessed: ${esc(O?.message || x.optErr || 'no option quotes right now')}.</div>`;
  const J = x.jev, jv = J ? `<div class="box" style="grid-column:1/-1"><b class="h">JEV'S READING OF THE SUPPLIED EVIDENCE · not probabilities</b>${J.error ? `<div class="warn">Jev: ${esc(J.error)}</div>` : ''}<table class="kvt wrap"><tbody>
      <tr><td class="l">Sources support the event</td><td class="l">${catJ(J.support, { credible_report: 'credible report' })}</td></tr>
      <tr><td class="l">Business impact in the window</td><td class="l">${catJ(J.materiality)} <span class="muted">(business, not the next-day move)</span></td></tr>
      <tr><td class="l">Past events comparable</td><td class="l">${catJ(J.match)}</td></tr>
      <tr><td class="l">Why the reaction could differ</td><td class="l">${catJ(J.divergence, { weak_commercial_impact: 'weak business impact', competing_news: 'competing news' })}</td></tr>
      <tr><td class="l">Already priced in</td><td class="l">${catJ(J.anticipation)}</td></tr>
      <tr><td class="l">Would undermine it</td><td class="l">${J.invalidation?.text ? `<b>${esc(J.invalidation.text)}</b> <span class="muted">(answer confidence ${Math.round((J.invalidation.conf ?? 0) * 100)}%)</span>` : '<span class="muted">no answer</span>'}</td></tr></tbody></table>
    <div class="note">Jev ${esc(J.model || '')} · question set ${esc(J.qset || '')} · judges only what code supplied; answer confidence is how sure it is of its own answer, not a forecast.</div></div>` : `<div class="note">Jev is ${esc(x.jevMode)}: evidence and numbers only.</div>`;
  const evs = x.events?.length ? `<details><summary class="muted" style="font-size:12.5px">The ${x.events.length} past events</summary><div class="scroll"><table><thead><tr><th class="l">Date</th><th class="l">What</th><th>Gap</th><th>Day</th><th>${hl}</th><th>vs SPY</th><th>Run-up</th></tr></thead><tbody>${x.events.map(e => `<tr><td class="l">${esc(e.day)}</td><td class="l w">${esc(e.what)} <span class="muted">· ${esc(e.src)}${e.when !== '?' ? ', ' + esc(e.when) : ''}</span></td><td>${catP(e.gapPct)}</td><td>${catP(e.dayPct)}</td><td>${e.done ? catP(e.movePct) : '<span class="muted">not over</span>'}</td><td>${catP(e.vsSpyPct)}</td><td>${catP(e.runupPct)}</td></tr>`).join('')}</tbody></table></div></details>` : '';
  return `${head}${warn}<div class="boxes">${ev}${hist}</div>${scen}<div class="boxes">${plans}${opts}${jv}</div>${evs}`;
}
function catLog(j) {
  if (!j) return ''; if (j.error) return msg(j);
  const it = j.items || []; if (!it.length) return '<div class="note">Your scenarios are frozen here and graded from the next session\'s open once their holding period is over. (Scenarios from before v0.15.0 used the old grading and are not shown.)</div>';
  const S = j.score || {}, cv = S.coverage || {};
  const sc = S.rows?.length ? `<div class="scroll"><table><thead><tr><th class="l">Scorecard by type</th><th>Graded</th><th>Right direction</th><th>…when the event showed up</th><th>Inside the range</th><th>Target first</th><th>Stop first</th><th>Ambiguous</th><th>Avg R after costs</th></tr></thead><tbody>${S.rows.map(r => `<tr><td class="l">${esc(r.label)}</td><td>${r.n}</td><td>${r.dirPct == null ? '—' : r.dirPct + '%'} <span class="muted">(${r.dirHit}/${r.dirN})</span></td><td>${r.seenDirPct == null ? '—' : r.seenDirPct + '%'} <span class="muted">(${r.seenHit}/${r.seenN})</span></td><td>${r.bandPct ?? '—'}%</td><td>${r.target}</td><td>${r.stop}</td><td>${r.ambiguous}</td><td>${r.avgR == null ? '—' : nf(r.avgR, 2) + 'R'}</td></tr>`).join('')}</tbody></table></div>
    <div class="note">Range check: ${cv.inside ?? 0} of ${cv.n ?? 0} ended inside their 10–90% range (${cv.pct ?? '—'}%; honest ranges land near ${cv.nominal}%). ${(S.support || []).map(q => `Sources rated ${q.support.replace(/_/g, ' ')}: event showed up ${q.seen} of ${q.checked} checked`).join(' · ')}. Worth trusting only after 20–30 graded per type.</div>`
    : `<div class="note">${S.waiting || it.length} scenario${(S.waiting || it.length) === 1 ? '' : 's'} waiting for their holding period to end. Worth trusting only after 20–30 graded per type.</div>`;
  const rows = it.slice(0, 25).map(x => { const g = x.grade; return `<tr><td class="l">${catT(x.at)}</td><td class="l sy">${esc(x.s)}</td><td class="l">${esc(CAT_KINDS[x.kind] || x.kind)}</td><td>${x.dir === 'up' ? '<span class="up">up</span>' : x.dir === 'down' ? '<span class="down">down</span>' : '—'}</td><td>${x.horizon}d</td><td class="l">${esc((x.status || '').replace('_est', ''))}</td><td>${catP(x.band?.lo)} to ${catP(x.band?.hi)}</td><td>${g ? `${catP(g.movePct)} ${g.dirHit == null ? '' : g.dirHit ? '<span class="up">✓ direction</span>' : '<span class="down">✗ direction</span>'} ${g.inBand ? '· in range' : '· outside range'}${g.swing ? ` · ${g.swing === 'target' ? '<span class="up">target</span>' : g.swing === 'stop' ? '<span class="down">stop</span>' : g.swing === 'ambiguous' ? '<span class="amber">ambiguous</span>' : 'neither'}${g.r != null ? ` ${nf(g.r, 2)}R` : ''}` : ''}${g.eventSeen === true ? ' · event seen' : g.eventSeen === false ? ' · event not seen' : ''}` : '<span class="muted">waiting</span>'}</td><td class="l w muted">${esc(x.text)}</td></tr>`; }).join('');
  return `<details ${LS.get('catLogOpen', false) ? 'open' : ''} data-catlog><summary class="muted" style="font-size:12.5px">Saved scenarios (${it.length}) and how they turned out</summary>${sc}<div class="scroll"><table><thead><tr><th class="l">Ran</th><th class="l">Stock</th><th class="l">Type</th><th>Dir</th><th>Hold</th><th class="l">Evidence</th><th>Expected range</th><th>Result</th><th class="l">Scenario</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}
const catFormNow = () => ({ sym: $('#ca-sym').value.trim().toUpperCase(), text: $('#ca-text').value.trim(), kind: $('#ca-kind').value, dir: $('#ca-dir').value, date: $('#ca-date').value, h: +$('#ca-h').value || 5 });
['input', 'change'].forEach(ev => document.addEventListener(ev, e => { if (e.target.closest?.('#catform')) LS.set('catForm', catFormNow()); })); // a draft survives switching tabs
document.addEventListener('toggle', e => { if (e.target.matches?.('[data-catlog]')) LS.set('catLogOpen', e.target.open); }, true);
document.addEventListener('submit', async e => {
  if (e.target.id !== 'catform') return; e.preventDefault(); if (CA.busy) return;
  const f = catFormNow();
  LS.set('catForm', f); CA.busy = true; CA.err = ''; catPaint();
  const j = await api('catalyst', { symbol: f.sym, text: f.text, kind: f.kind, dir: f.dir, date: f.date, horizon: f.h }).catch(x => ({ error: 'network', message: x.message }));
  CA.busy = false;
  if (j.error) CA.err = j.message || j.error; else { CA.res = j; LS.set('catRes', j); delete lastLoad.catalyst; load('catalyst', true); }
  catPaint();
});
