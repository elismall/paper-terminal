/* ---------- Jev tab: what the AI second opinion sees, what it answers, and what the bot did with it (routes/jev.js) ---------- */
// v0.15.0: Ask Jev shows the Trade fit card (lib/tradefit.js) above the detailed answers for stocks, plus a research log (J3b).
const JV = { ask: LS.get('jevask', 'AAPL'), res: null, busy: false, open: null, fitlog: null, fitBusy: false };
(() => { const st = document.createElement('style'); st.textContent = `
.tfit{border:1px solid var(--line2);border-left:4px solid var(--orange);background:var(--panel);margin:4px 0 12px;min-width:0;box-shadow:0 0 0 1px #000,0 6px 18px rgba(251,139,30,.08)}
.tfit h3{margin:0;padding:6px 10px;background:var(--orange);color:#000;font:700 12px var(--mono);letter-spacing:.05em;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center}.tfit h3 .ro{font-weight:500;opacity:.8}
.tfit dl{margin:0;font-size:13px}.tfit dl>div{display:grid;grid-template-columns:minmax(92px,max-content) 1fr;gap:4px 12px;padding:6px 10px;align-items:baseline;border-bottom:1px solid #151515}
.tfit dl>div:nth-child(odd){background:var(--row)}.tfit dl>div:nth-child(even){background:var(--panel2)}.tfit dl>div.key{background:#1f1606;border-left:2px solid var(--amber);padding-left:8px}
.tfit dt{color:var(--amber);font:600 11.5px var(--mono);text-transform:uppercase;letter-spacing:.04em}.tfit dd{margin:0;min-width:0;overflow-wrap:anywhere;color:var(--ink)}
.tfit .pill{display:inline-block;padding:1px 8px;border-radius:10px;font:700 12px var(--mono);border:1px solid currentColor;white-space:normal;max-width:100%;overflow-wrap:anywhere}
.tfit .pill.g{color:var(--up);background:var(--up-soft)}.tfit .pill.a{color:var(--amber);background:#2a1d00}.tfit .pill.r{color:var(--down);background:var(--down-soft)}.tfit .pill.n{color:var(--muted);background:transparent;border-style:dashed;font-weight:500}
.tfit .na{color:var(--muted)}.tfit .pl{display:flex;flex-wrap:wrap;gap:6px 14px}.tfit .pl>span{display:inline-flex;gap:6px;align-items:center}
.tfit .miss{margin:0;padding:6px 10px 6px 28px;font-size:12.5px;background:#140a0a;border-top:1px solid #2a1414;color:var(--ink2)}.tfit .miss b{color:var(--down)}
.tfit .note{margin:0;padding:6px 10px 8px;font-size:12px;color:var(--muted)}.tfit details{padding:6px 10px;font-size:12.5px;border-top:1px solid var(--line)}.tfit details summary{cursor:pointer;color:var(--amber)}
.tfit details table{font:12px var(--mono);width:100%}.tfit .kvt tr:nth-child(odd) td{background:var(--row)}.tfit .kvt td{white-space:normal;vertical-align:top;padding:4px 6px;text-align:left}
.tfit .kvt td:first-child{color:var(--amber);white-space:nowrap}`; document.head.appendChild(st); })();
const fbig = (v) => v == null || !isFinite(v) ? '—' : (v < 0 ? '−$' : '$') + (Math.abs(v) >= 1e12 ? (Math.abs(v) / 1e12).toFixed(2) + 'T' : Math.abs(v) >= 1e9 ? (Math.abs(v) / 1e9).toFixed(1) + 'B' : Math.abs(v) >= 1e6 ? (Math.abs(v) / 1e6).toFixed(1) + 'M' : Math.abs(v).toFixed(0));
const TF_PLAN = { swing: 'Swing', position: 'Position', invest: 'Long-term', options: 'Options' };
const tfTone = (v) => v == null ? 'n' : v >= 2 ? 'g' : v >= 1 ? 'a' : 'r';
const tfScoreTxt = (p) => p?.status !== 'assessed' ? '<span class="pill n">Not assessed</span>' : p.score != null ? `<span class="pill ${tfTone(p.score)}">${nf(p.score, 1)}/3</span>` : p.answer ? `<span class="pill ${p.answer === 'reasonable' ? 'g' : p.answer === 'insufficient' ? 'n' : 'a'}">${esc(p.answer.replace(/_/g, ' '))}</span>` : '<span class="pill n">assessed, no answer</span>';
const tfHist = (h, name) => h ? `${esc(name)}: ${h.n} trades · ${h.win ?? '—'}% wins · ${sgn(h.expR, 2, 'R')}${h.band != null ? ` ±${nf(h.band, 2)}` : ''}` : null;
function jvFitView(f) {
  if (!f) return '';
  if (f.error) return `<div class="tfit"><h3>TRADE FIT</h3><div class="note">${esc(f.message || f.error)}</div></div>`;
  const c = f.card, ev = f.ev || {}, key = { swing_2_10d: 'swing', position_1_3m: 'position', invest_1_3y: 'invest' }[c.approach], sc = key ? c.plans[key] : null;
  const S = ev.swing || {}, P = ev.position || {}, I = ev.invest || {}, O = ev.options || {};
  const hist = S.hist ? [tfHist(S.hist.inSample, `${S.setup} in-sample`), tfHist(S.hist.heldOut, `held-out (${S.hist.heldOutRange || 'last third'})`) || 'held-out: not available yet'].filter(Boolean).join(' · ') : null;
  const miss = Object.entries(c.plans).filter(([, p]) => p.status !== 'assessed').map(([k, p]) => `<li><b>${TF_PLAN[k]}</b>: Not assessed — missing ${esc((p.missing || []).join('; ') || 'evidence')}</li>`).join('');
  const price = ev.priceAt ? `price ${new Date(ev.priceAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET${ev.priceAgeMin != null ? ` (${ev.priceAgeMin} min old)` : ''}` : 'price from the last candle';
  const pay = (o) => o && Object.keys(o).length ? ['bear', 'base', 'bull'].map(k => `${k} <span class="${cls(o[k])}">${f$(o[k])}</span>`).join(' · ') : '—';
  const evid = `<details><summary>Evidence and plans behind the card</summary><table class="kvt"><tbody>
    <tr><td>Swing plan</td><td>${S.plan ? `${esc(S.plan.dir)} ${esc(S.setup)} · entry ${fp(S.plan.entry)} · stop ${fp(S.plan.stop)} · target ${fp(S.plan.target)} · hold ${S.plan.hold} days · reward/risk after costs ${nf(S.plan.rr, 2)}× · costs ${S.plan.costR}R${S.trained ? '' : ' · <span class="amber">untrained exits</span>'}` : '<span class="na">none</span>'}</td></tr>
    <tr><td>Position plan</td><td>${P.plan ? `${esc(P.plan.dir)} · entry ${fp(P.plan.entry)} · stop ${fp(P.plan.stop)} (${esc(P.plan.stopBasis)}) · target ref. ${fp(P.plan.targetRef)} (${esc(P.plan.targetBasis)})` : '<span class="na">none</span>'}${P.weekly ? `<div class="muted">weekly: vs 10w ${sgn(P.weekly.close_vs_10w_pct, 1, '%')} · vs 40w ${sgn(P.weekly.close_vs_40w_pct, 1, '%')} · higher highs ${P.weekly.higher_highs_8w}/8 · vs SPY 3/6/12 mo ${[P.rs?.m3, P.rs?.m6, P.rs?.m12].map(v => sgn(v, 1, '%')).join(' / ')}</div>` : ''}${P.base?.d63?.n ? `<div class="muted">base rate, ${esc(P.regime)} regime: 63 sessions median ${sgn(P.base.d63.median, 1, '%')}, ${P.base.d63.up}% up (${P.base.d63.n} days, ~${P.base.d63.effN} independent)</div>` : ''}</td></tr>
    <tr><td>Long-term</td><td>${I.fin ? `revenue TTM ${fbig(I.fin.revenueTTM)} (${sgn(I.fin.revGrowthFY, 1, '%')} last FY) · net income ${fbig(I.fin.netIncomeTTM)} · free cash flow ${fbig(I.fin.fcfTTM)} · debt ${fbig(I.fin.debt)} · cash ${fbig(I.fin.cash)} · shares ${sgn(I.fin.dilution1y, 1, '%')} in 1y${I.val ? ` · market value ${fbig(I.val.marketCap)} · P/E ${I.val.pe ?? '—'} · P/S ${I.val.ps ?? '—'} · FCF yield ${I.val.fcfYieldPct ?? '—'}%` : ''} <span class="muted">(SEC filings to ${esc(I.fin.asOf || '?')}, filed ${esc(I.fin.filed || '?')}; business risks not read)</span>` : '<span class="na">no financials</span>'}</td></tr>
    <tr><td>Options</td><td>${O.contract ? `${esc(O.exp)} ${fp(O.contract.k)} ${O.dir === 'long' ? 'call' : 'put'} · ask ${fp(O.contract.ask)} · spread ${O.contract.spread ?? '—'}% · IV ${O.contract.iv ?? '—'}% · open interest ${O.contract.oi ?? '—'} · breakeven ${fp(O.contract.breakeven)} · at expiry: ${pay(O.pay)}${O.spread ? `<div class="muted">debit spread ${fp(O.spread.buy.k)}/${fp(O.spread.sell.k)} for ${fp(O.spread.debit)} · at expiry: ${pay(O.paySp)}</div>` : ''}${O.scenBasis ? `<div class="muted">bear/base/bull = 10th / median / 90th pct of ${esc(O.scenBasis)} · ${esc(O.feed)}</div>` : ''}${(O.flags || []).length ? `<div class="amber">${esc(O.flags.join(' · '))}</div>` : ''}` : '<span class="na">none</span>'}</td></tr></tbody></table></details>`;
  const ins = /insufficient/i.test(c.timingText || ''), apTone = key ? tfTone(sc?.score ?? 2) : c.approach === 'wait' ? 'a' : 'n';
  const row = (dt, dd, k) => `<div${k ? ' class="key"' : ''}><dt>${dt}</dt><dd>${dd}</dd></div>`;
  return `<div class="tfit"><h3><span>TRADE FIT · ${esc(f.s)}</span><span class="ro">RESEARCH ONLY · NEVER PLACES ORDERS</span></h3><dl>
    ${row('Approach', `<span class="pill ${apTone}">${esc(c.approachLabel)}</span>${sc?.score != null ? ` <span class="muted">suitability</span> <b>${nf(sc.score, 1)}/3</b>` : ''}`, 1)}
    ${row('Instrument', `<span class="pill ${/insufficient/i.test(c.instrumentLabel || '') ? 'n' : 'g'}">${esc(c.instrumentLabel)}</span>${c.instrWhy ? ` <span class="muted">· ${esc(c.instrWhy)}</span>` : ''}`, 1)}
    ${row('Entry', ins ? `<span class="pill n">${esc(c.timingText)}</span>` : `<b>${esc(c.timingText || '—')}</b>`)}
    ${row('Concern', c.concern ? `<span class="amber">${esc(c.concern)}</span>` : '—')}
    ${row('Watch', c.watch ? `${esc(c.watch)} <span class="muted">(${c.watchSource === 'jev' ? 'Jev picked it from conditions code built' : 'the plan\'s stop, set by code'})</span>` : '—')}
    <div><dt>Plans</dt><dd class="pl">${Object.keys(TF_PLAN).map(k => `<span>${TF_PLAN[k]} ${tfScoreTxt(c.plans[k])}</span>`).join('')}</dd></div>
    ${row('Evidence', `<span class="muted">candles to ${esc(String(ev.asOf || '').slice(0, 10))} · ${price} · Jev answer confidence ${c.confidence == null ? '—' : Math.round(c.confidence * 100) + '%'}</span>${f.jev?.error ? ` · <span class="down">Jev: ${esc(f.jev.error)}</span>` : ''}`)}
    ${hist ? row('History', hist) : ''}</dl>
    ${miss ? `<ul class="miss">${miss}</ul>` : ''}${evid}
    <div class="note">Scores are suitability assessments of the supplied evidence, not chances of profit. Answer confidence is Jev's certainty about its own answer; history is measured separately (held-out = results the bot's settings were not picked on). Saved and graded later (J3b).</div></div>`;
}
function jvFitLogView() {
  const L = JV.fitlog; if (!L) return JV.fitBusy ? loading : '<div class="empty">Loading…</div>'; if (L.error) return msg(L);
  if (!L.items?.length) return '<div class="empty">Each Ask Jev for a stock is saved here and graded on its own clock: swing after its hold, position at 21 and 63 sessions, options at expiry, long-term stays pending for years.</div>';
  const S = L.score || {}, g = (x) => { const G = x.grade || {}; return [G.swing ? `swing ${esc(G.swing.why)}${G.swing.r != null ? ' ' + nf(G.swing.r, 2) + 'R' : ''}` : null, G.d63 ? `63d vs SPY ${sgn(G.d63.vsSpy, 1, '%')}` : G.d21 ? `21d vs SPY ${sgn(G.d21.vsSpy, 1, '%')}` : null, G.option ? `option ${nf(G.option.multiple, 2)}×` : null, G.m3 ? '3-mo checkpoint (immature)' : null].filter(Boolean).join(' · ') || '<span class="muted">waiting</span>'; };
  return `${S.rows?.length ? `<div class="scroll"><table><thead><tr><th class="l">Group</th><th class="l">Measured</th><th>Graded</th><th>Average</th></tr></thead><tbody>${S.rows.map(r => `<tr><td class="l">${esc(r.group)}</td><td class="l">${esc(r.metric)}</td><td>${r.n}${r.n < S.minN ? ' <span class="muted">(too few)</span>' : ''}</td><td>${nf(r.avg, 2)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="note">${S.asked} asks saved · ${S.swingGraded} swing plans graded (${S.ambiguous} ambiguous) · ${S.longTermPending} long-term assessments pending (1–3 year windows). Needs ${S.minN}+ graded per group before it says anything.</div>
    <div class="scroll"><table><thead><tr><th class="l">Asked (ET)</th><th class="l">Stock</th><th class="l">Card said</th><th class="l">Instrument</th><th>Swing fit</th><th class="l">Outcome so far</th></tr></thead><tbody>${L.items.slice(0, 30).map(x => `<tr><td class="l">${new Date(x.at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td><td class="l sy">${esc(x.s)}</td><td class="l">${esc((x.approach || '').replace(/_/g, ' '))}</td><td class="l">${esc((x.instrument || '').replace(/_/g, ' '))}</td><td>${x.fit?.swing == null ? '—' : nf(x.fit.swing, 1)}</td><td class="l">${g(x)}</td></tr>`).join('')}</tbody></table></div>`;
}
async function jvFitLogLoad(force) { if (JV.fitBusy || (JV.fitlog && !force)) return; JV.fitBusy = true; JV.fitlog = await api('jev', { fit: 'log' }).catch(x => ({ error: 'network', message: x.message })); JV.fitBusy = false; const el = $('#jv-fitlog'); if (el) el.innerHTML = jvFitLogView(); }
const JQ_LABEL = { quality: 'Setup quality (0–3)', trend: 'Uptrend strength (0–3)', regime: 'Market regime', extended: 'Stretched too far?', reversal: 'Selling pressure?', volume_ok: 'Volume supports it?', downside: 'Sharp-drop risk', hold: 'Keep holding (0–3)', continues: 'Move keeps going?', fading: 'Momentum fading?' };
const JS_LABEL = { asset: 'Asset type', setup: 'Rule setup', rules_score: 'Rules score', rsi14: 'RSI (14 days)', volume_vs_20d: 'Volume vs 20-day avg (×)', rel_strength_3m_pct: 'Strength vs market, 3 mo (%)', atr_pct: 'Daily range, ATR (% of price)',
  pct_from_20d: 'From 20-day avg (%)', pct_from_50d: 'From 50-day avg (%)', pct_from_200d: 'From 200-day avg (%)', trend_up: 'Uptrend (price > 50d > 200d)', market_3m_pct: 'Market, 3 mo (%)',
  ret_1d_pct: 'Last day (%)', ret_5d_pct: 'Last 5 days (%)', ret_20d_pct: 'Last 20 days (%)', last10_closes_vs_now_pct: 'Last 10 closes vs now (%)', pct_vs_20d_high: 'From 20-day high (%)', pct_vs_20d_low: 'From 20-day low (%)',
  pct_vs_52w_high: 'From 52-week high (%)', streak_days: 'Up(+)/down(−) day streak', last_candle: 'Last candle', volume_5d_vs_20d: 'Volume 5d vs 20d (×)', atr14_vs_atr50: 'Volatility now vs 50 days (×)',
  strategy: 'Strategy', hourly_rsi14: 'Hourly RSI (14)', above_200d: 'Above 200-day avg', take_profit_pct: 'Take profit (%)', dip_buys: 'Dip buys', deepest_dip_pct: 'Deepest dip buy (%)', hard_exit_below_last_dip_pct: 'Hard exit under last dip (%)',
  position: 'Open position', pnl_pct: 'P&L (%)', pct_to_stop: 'To stop (%)', pct_to_target: 'To target (%)', days_held: 'Days held', price_now_vs_last_close_pct: 'Now vs last close (%)',
  green: 'Green (closed up)', body_pct_of_range: 'Body (% of range)', upper_wick_pct: 'Upper wick (%)', lower_wick_pct: 'Lower wick (%)', close_in_range_pct: 'Close position in range (%)' };
function jevShell() {
  return `<div class="grid" id="jevroot">
    <section class="panel span12"><div class="ph"><span class="fk">J1)</span><h2>What is Jev?</h2><span class="meta" id="jv-status"></span></div><div class="pb jvtxt">
      <p><b>Jev</b> is an AI from TypeSafe that answers short, typed questions (yes/no, pick one, or a 0–3 score) about a set of numbers, in well under a second, with a probability for each answer. It does not look at pictures and it does not chat.</p>
      <p>The bot turns each price chart into about 30 numbers (how far price moved, where it sits in its recent range, the shape of the last candle, volume and volatility trends) and asks Jev 7 narrow questions about them. For trades already open it asks 4 more: keep holding, is the move continuing, is momentum fading, how big is the drop risk.</p>
      <p><b>Right now Jev is in shadow mode:</b> every answer is recorded next to the trade, but the bot's own rules still make every decision, and the stop-losses and risk limits can never be overridden. Once enough trades have closed, the scorecard below shows whether Jev's opinions actually picked winners. Only then would it be allowed to skip or shrink trades. ${isLive() ? 'Live mode is on: the bots trade real money (Jev still only records).' : 'Paper money only, no real dollars.'}</p></div></section>
    <section class="panel span12"><div class="ph"><span class="fk">J2)</span><h2>How one decision is made</h2></div><div class="pb"><ol class="jvflow">
      <li><b>Code reads the chart</b><span>Daily candles → ~30 numbers (completed days only, nothing from the future).</span></li>
      <li><b>Rules pick candidates</b><span>Breakout / pullback / oversold setups, score, trained exits (same as before Jev).</span></li>
      <li><b>Jev answers 7 questions</b><span>All at once, in parallel, each with a probability. Cost is tiny per call.</span></li>
      <li><b>Code applies the policy</b><span id="jv-mode">Shadow: record only. Gate: skip weak or risky setups, halve doubtful ones.</span></li>
      <li><b>Hard limits always win</b><span>Stops, 0.5% risk per trade, daily −2% hold, 8% drawdown pause, kill switch.</span></li></ol></div></section>
    <section class="panel span12"><div class="ph"><span class="fk">J3)</span><h2>Ask Jev about any symbol</h2><span class="meta">builds the exact snapshot the bot would send · never places an order</span></div>
      <form class="inline" id="jv-form"><label>Symbol<input class="in" id="jv-sym" value="${esc(JV.ask)}" placeholder="AAPL or BTC/USD" style="text-transform:uppercase;width:130px"></label><button class="btn primary" id="jv-go">Ask Jev</button></form><div id="jv-res"></div></section>
    <section class="panel span12"><div class="ph"><span class="fk">J3b)</span><h2>Trade fit log · research</h2><span class="meta">every stock ask, graded on its own clock</span></div><div id="jv-fitlog"></div></section>
    <section class="panel span12"><div class="ph"><span class="fk">J4)</span><h2>Latest calls by the bots</h2><span class="meta" id="jv-logmeta"></span></div><div id="jv-log"></div></section>
    <section class="panel span6"><div class="ph"><span class="fk">J5)</span><h2>Open trades · hold review</h2><span class="meta" id="jv-revmeta"></span></div><div id="jv-rev"></div></section>
    <section class="panel span6"><div class="ph"><span class="fk">J6)</span><h2>Scorecard · does Jev pick winners?</h2></div><div id="jv-score"></div></section>
    <section class="panel span12"><div class="ph"><span class="fk">J7)</span><h2>Behind the scenes · exact questions and policy</h2></div><div id="jv-q"></div></section></div>`;
}
const jvPct = v => v == null ? '—' : Math.round(v * 100) + '%';
const jvBar = (v, max = 1, bad = false) => v == null ? '<span class="muted">—</span>' : `<span class="nw"><span class="jvbar"><i style="width:${Math.max(2, Math.min(100, v / max * 100)).toFixed(0)}%;background:${bad ? (v / max >= 0.7 ? 'var(--down)' : 'var(--amber)') : (v / max >= 0.66 ? 'var(--up)' : v / max >= 0.33 ? 'var(--amber)' : 'var(--down)')}"></i></span><b>${max === 1 ? jvPct(v) : v}</b></span>`;
function jvAnswers(a, review) {
  if (!a) return '<span class="muted">—</span>';
  if (a.error) return `<span class="down">${esc(a.error)}</span>`;
  const rows = review ? [['hold', a.hold, 3], ['continues', a.cont, 1], ['fading', a.fade, 1, 1], ['downside', a.down, 1, 1]]
    : [['quality', a.q, 3], ['trend', a.trend, 3], ['extended', a.ext, 1, 1], ['reversal', a.rev, 1, 1], ['volume_ok', a.vol, 1], ['downside', a.down, 1, 1]];
  return `<div class="jvans">${rows.map(([k, v, m, bad]) => `<div><span>${JQ_LABEL[k]}</span>${jvBar(v, m, !!bad)}</div>`).join('')}${!review ? `<div><span>${JQ_LABEL.regime}</span><b>${esc(a.regime || '—')}</b></div>` : ''}<div><span>Confidence</span><b>${jvPct(a.conf)}</b></div></div>`;
}
function jvState(st, depth = 0) {
  if (!st || typeof st !== 'object') return '';
  return `<dl class="jvstate${depth ? ' sub' : ''}">${Object.entries(st).map(([k, v]) => `<dt>${esc(JS_LABEL[k] || k)}</dt><dd>${v && typeof v === 'object' && !Array.isArray(v) ? jvState(v, 1) : Array.isArray(v) ? esc(v.join(', ')) : typeof v === 'boolean' ? (v ? 'yes' : 'no') : esc(v ?? '—')}</dd>`).join('')}</dl>`;
}
function jvAskView() {
  const r = JV.res; if (JV.busy) return `<div class="btbusy"><div class="bar"><i></i></div><span>Building the chart snapshot, the Trade fit evidence (plans, SEC financials, option quotes) and asking Jev…</span></div>`;
  if (!r) return '<div class="empty">Type a stock or coin and press Ask Jev to see the exact numbers it gets and every answer it gives back.</div>';
  if (r.error) return msg(r);
  const g = r.gate, nm = symName(r.s), age = r.asOf ? (Date.now() - Date.parse(r.asOf)) / 864e5 : 0, crypto = String(r.s).includes('/');
  // v0.13.2: company name next to the ticker, and a warning when the newest candle is old (symbol halted, delisted or mistyped)
  const head = `<div class="jvhead"><b class="sy">${esc(String(r.s).replace('/USD', ''))}</b>${nm ? ` <span>${esc(nm)}</span>` : ''} <span class="muted">· ${crypto ? 'crypto' : 'stock'}</span></div>${age > (crypto ? 2 : 5) ? `<div class="errmsg" style="margin:4px 0 8px">The newest candle is from ${esc(String(r.asOf).slice(0, 10))} (${Math.round(age)} days ago): this symbol may not be trading any more, or it may not be the one you meant. Jev's answer below is based on that old data.</div>` : ''}`;
  return `${head}${jvFitView(r.fit)}<div class="jvask"><div><div class="sub">1 · What the rules see</div><div class="pb" style="padding:0 0 8px;font-size:13px;color:var(--ink2)">${r.rules ? `<b class="amber">${esc(r.rules.setup)}</b> (${esc(r.rules.dir)}), score ${r.rules.score} · ${esc((r.rules.why || []).join(' · '))}` : 'No rule setup today: the bot would not consider it. Jev still reads the chart below.'}</div>
      <div class="sub">2 · Exact numbers sent to Jev <span class="muted">(${r.stateChars} characters, candles up to ${esc(String(r.asOf).slice(0, 10))})</span></div>${jvState(r.state)}</div>
    <div><div class="sub">3 · Jev's answers</div>${jvAnswers(r.answers)}
      <div class="sub" style="margin-top:12px">4 · What the policy would do</div><div style="font-size:13px;color:var(--ink2)">${r.mode === 'gate' ? 'Gate mode is on: ' : 'In shadow mode (now): nothing, the answer is only recorded. If gate mode were on: '}<b class="${g?.act === 'skip' ? 'down' : g?.act === 'half' ? 'amber' : 'up'}">${g ? (g.act === 'skip' ? 'skip this trade' : g.act === 'half' ? 'take it at half size' : 'take it at normal size') : '—'}</b>${g?.why ? ` · ${esc(g.why)}` : ''}${r.rules ? '' : ' (only matters if the rules pick it)'}.</div></div></div>`;
}
function jvLogView(v) {
  const L = v?.log || []; if (!L.length) return `<div class="empty">No bot calls saved yet. They appear after the next scheduled run (or Run buttons on the Bot tab) now that the key is set.</div>`;
  return `<div class="scroll"><table><thead><tr><th class="l">When (ET)</th><th class="l">Symbol</th><th class="l">Kind</th><th>Quality / Hold</th><th>Trend</th><th>Stretched</th><th>Selling</th><th>Drop risk</th><th class="l">What the bot did</th></tr></thead><tbody>${L.map((x, i) => { const a = x.a || {}, rv = x.kind === 'review';
    return `<tr data-jvrow="${i}"><td class="l">${new Date(x.t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td><td class="l sy">${esc(x.s)}</td><td class="l">${rv ? 'hold review' : 'new trade'}</td>
      <td>${a.error ? '<span class="down">error</span>' : rv ? (a.hold ?? '—') + '/3' : (a.q ?? '—') + '/3'}</td><td>${rv ? '—' : a.trend ?? '—'}</td><td>${rv ? '—' : jvPct(a.ext)}</td><td>${rv ? jvPct(a.fade) : jvPct(a.rev)}</td><td>${jvPct(a.down)}</td><td class="l" style="white-space:normal;min-width:180px">${esc(x.did || '')}</td></tr>
      ${JV.open === i ? `<tr class="jvopen"><td colspan="9"><div class="jvask"><div><div class="sub">Exact numbers sent</div>${jvState(x.state)}</div><div><div class="sub">Answers</div>${jvAnswers(a, rv)}</div></div></td></tr>` : ''}`; }).join('')}</tbody></table></div><div class="note">Tap a row to see the exact numbers sent and every answer. Stretched / selling / drop risk are probabilities (70%+ counts as a risk flag).</div>`;
}
function jvReviewView(v) {
  const R = v?.review, items = Object.values(R?.items || {}); if (!items.length) return '<div class="empty">No open swing trades reviewed yet. Reviews run after each bot run while the bots hold positions.</div>';
  return `<div class="scroll"><table><thead><tr><th class="l">Symbol</th><th>Hold</th><th>Keeps going</th><th>Fading</th><th>Drop risk</th></tr></thead><tbody>${items.map(x => `<tr data-sym="${esc(x.s)}"><td class="l sy">${esc(x.s)}</td><td class="${x.hold >= 2 ? 'up' : x.hold < 1 ? 'down' : ''}">${x.hold ?? '—'}/3</td><td>${jvPct(x.cont)}</td><td>${jvPct(x.fade)}</td><td>${jvPct(x.down)}</td></tr>`).join('')}</tbody></table></div><div class="note">Shadow only: the bot never sells or moves a stop because of this. It is shown on each Bot tab card as "AI view".</div>`;
}
function jvQuestionsView(v) {
  if (!v?.questions) return loading;
  const q = (set) => Object.entries(set).map(([k, x]) => `<li><b>${esc(JQ_LABEL[k] || k)}</b> <span class="muted">(${x.type})</span>: ${esc(x.instructions)} <span class="muted">${Array.isArray(x.criteria) ? 'Scale: ' + esc(x.criteria.map((c, i) => `${i} ${c}`).join(' · ')) : 'Answers: ' + esc(Object.keys(x.criteria).join(' / '))}</span></li>`).join('');
  const G = v.gate || {};
  return `<div class="jvask"><div><div class="sub">New trade: 7 questions</div><ol class="jvq">${q(v.questions.entry)}</ol><div class="sub">Open trade: 4 questions</div><ol class="jvq">${q(v.questions.review)}</ol></div>
    <div><div class="sub">Policy (lives in the bot's code, not in the AI)</div><ul class="jvq">
      <li>Shadow (now): record every answer in the order id (<code>-j24e3r1d2</code> = quality 2.4, stretched 30%+, selling 10%+, drop risk 20%+); change nothing.</li>
      <li>Gate, skip: drop risk ≥ ${jvPct(G.downsideSkip)}, or quality under ${G.skipBelow} with confidence ≥ ${jvPct(G.skipConf)}.</li>
      <li>Gate, half size: quality under ${G.halfBelow}, confidence under ${jvPct(G.halfConf)}, or stretched / selling pressure ≥ ${jvPct(G.flag)}.</li>
      <li>DCA deals: Jev can only skip a new deal, never resize the ladder.</li>
      <li>Jev down or slow (4 s timeout, one retry): the bot trades on its rules alone and the Safety panel shows level 2.</li>
      <li>Switching to gate is a setting (<code>JEV_MODE=gate</code> in Vercel), only worth it if the scorecard shows Weak scores losing and Strong scores winning over 30+ closed trades.</li></ul>
      <div class="sub">Model</div><div style="font-size:13px;color:var(--ink2)">${esc(v.status?.model || '')} · mode <b class="amber">${esc(v.status?.mode || 'off')}</b> · key ${v.status?.key ? '<span class="up">set</span>' : '<span class="down">missing</span>'}</div></div></div>`;
}
function jevPaint() {
  const v = state.jev; if (!$('#jevroot')) return;
  const st = v?.status; $('#jv-status').innerHTML = st ? `${esc(st.model)} · <b class="${st.mode === 'off' ? 'down' : 'amber'}">${esc(st.mode)}</b>` : '';
  if (st) $('#jv-mode').textContent = st.mode === 'gate' ? 'Gate (on): skip weak or risky setups, halve doubtful ones. Shadow would only record.' : st.mode === 'shadow' ? 'Shadow (on now): record every answer, change nothing. Gate would skip weak or risky setups and halve doubtful ones.' : 'Off: no key or JEV_MODE=off.';
  $('#jv-res').innerHTML = jvAskView();
  $('#jv-log').innerHTML = v ? (v.error ? msg(v) : jvLogView(v)) : loading;
  $('#jv-logmeta').textContent = v?.log?.length ? `${v.log.length} most recent · saved ${new Date(v.logAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET` : '';
  $('#jv-rev').innerHTML = v && !v.error ? jvReviewView(v) : '';
  $('#jv-revmeta').textContent = v?.review?.at ? 'as of ' + new Date(v.review.at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : '';
  $('#jv-score').innerHTML = state.performance ? (state.performance.error ? msg(state.performance) : jevScoreView(state.performance.jev) || '<div class="empty">No data yet.</div>') : loading;
  $('#jv-q').innerHTML = v && !v.error ? jvQuestionsView(v) : '';
  $('#jv-fitlog').innerHTML = jvFitLogView(); if (!JV.fitlog && v && !v.error) jvFitLogLoad();
}
document.addEventListener('submit', async e => {
  if (e.target.id !== 'jv-form') return; e.preventDefault();
  let s = $('#jv-sym').value.trim().toUpperCase().replace(/^([A-Z]{2,5})USD$/, '$1/USD'); if (!s) return; if (COIN[s]) s += '/USD';
  JV.ask = s; LS.set('jevask', s); JV.busy = true; $('#jv-res').innerHTML = jvAskView();
  JV.res = await api('jev', { symbol: s }).catch(x => ({ error: 'network', message: x.message })); JV.busy = false; $('#jv-res').innerHTML = jvAskView();
  if (JV.res?.fit && !JV.res.fit.error) jvFitLogLoad(true);
});
document.addEventListener('click', e => { const r = e.target.closest('[data-jvrow]'); if (!r) return; const i = +r.dataset.jvrow; JV.open = JV.open === i ? null : i; $('#jv-log').innerHTML = jvLogView(state.jev); });
