// Paper Terminal front end, part 3g (v0.11.0): the crypto DCA lab (which coins the DCA bot trades, how it does in bull runs next
// to holding BTC/ETH, bull-run mode, the shadow leverage/money signals and their scorecard) and the bull-run line in the DCA
// rules. Shown on the DCA tab since v0.12.0 (js/3i-dca.js). Classic script; loads after 3f.
SCHED.dcalab = 18e5; NEED.dca.push('dcalab');
const LB = { busy: false, note: '', coins: false };
(() => { const st = document.createElement('style'); st.textContent = `
.lab{padding:8px 10px;display:grid;gap:10px;min-width:0}.lab>*{min-width:0}.lab .row{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center}
.lab .verd{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:8px}
.lab .vbox{background:var(--panel2);border:1px solid var(--line);padding:8px 10px;font:13px var(--sans);color:var(--ink2);min-width:0}
.lab .vbox b.h{display:block;font:700 12px var(--mono);letter-spacing:.04em;color:var(--amber);margin-bottom:4px}
.lab .on{color:var(--up);font-weight:700}.lab .off{color:var(--muted);font-weight:700}
.lab table{width:100%;border-collapse:collapse;font:12.5px var(--mono)}.lab td,.lab th{padding:3px 6px;text-align:right;border-bottom:1px solid #151515;white-space:nowrap}
.lab td.l,.lab th.l{text-align:left}.lab tr.pick td{background:#15130a}.lab .note{font:11.5px var(--mono);color:var(--muted)}`; document.head.appendChild(st); })();
const labT = (t) => t ? new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : '—';
const labP = (v, d = 1) => v == null ? '—' : `<span class="${cls(v)}">${sgn(v, d, '%')}</span>`;
const labCoin = (s) => String(s).replace('/USD', '');
function bullLine(B) {
  if (!B) return '';
  if (B.error) return `<span class="muted">Bull-run check failed: ${esc(B.error)}</span>`;
  return `<b class="${B.on ? 'on' : 'off'}">Bull-run mode ${B.on ? 'ON' : 'off'}</b> <span>${esc(B.why || '')}${B.on ? ` · ${Math.round((B.share || 0) * 100)}% of the crypto budget held in BTC + ETH${B.tb ? ` · deals trail ${B.tb}% under the best price` : ''}` : ''}</span>`;
}
const aprBucket = (a) => a == null ? '' : a < 0 ? 'down' : a < 20 ? '' : a < 50 ? 'amber' : 'down';
function signalsView(J) {
  const G = J.signals; if (!G) return '';
  const F = G.funding, Lq = G.liquidity, SC = state.performance?.dcaSignals;
  const fund = F?.error ? `<span class="muted">funding feed unavailable: ${esc(F.error)}</span>` : (F?.coins || []).map(c => `<span class="nw"><b>${esc(labCoin(c.s))}</b> <span class="${aprBucket(c.apr)}">${c.apr == null ? '—' : c.apr + '%/yr'}</span></span>`).join(' · ') || '<span class="muted">no coins yet</span>';
  const rows = SC?.rows ? `<div class="scroll"><table><thead><tr><th class="l">At the deal's start</th><th>Closed deals</th><th>Win</th><th>Avg</th><th>Total</th></tr></thead><tbody>${SC.rows.map(r => `<tr><td class="l">${esc(r.label)}</td><td>${r.n}</td><td>${nf(r.win, 0, '%')}</td><td class="${cls(r.avg)}">${r.n ? f$(r.avg) : '—'}</td><td class="${cls(r.realized)}">${f$(r.realized || 0)}</td></tr>`).join('')}</tbody></table></div>` : '';
  return `<div class="vbox"><b class="h">4 · LEVERAGE AND MONEY SIGNALS (${esc((G.mode || 'shadow').toUpperCase())})</b>Perp funding now (Hyperliquid; normal is about 10%/yr, over 50%/yr = longs very crowded): ${fund}
    <div style="margin-top:4px">Money conditions: <b>${esc(Lq?.state || '—')}</b> <span class="muted">${esc(Lq?.error || (Lq?.text || '').replace(/^money conditions \w+ /, ''))}</span></div>
    <div class="muted" style="margin:4px 0">Every new crypto deal records both in its order id. Nothing changes trades${G.mode === 'gate' ? ' except: very hot funding skips new deals (LEVERAGE_MODE=gate)' : ''}; this table shows whether they matter (worth acting on after 30+ closed deals per row${SC ? `; ${SC.n} tagged so far` : ''}).</div>${rows}</div>`;
}
function labView(J) {
  if (!J) return `<div class="lab">${loading}</div>`; if (J.error) return `<div class="lab">${msg(J)}</div>`;
  const L = J.lab, run = `<button class="btn" data-lab="run" ${LB.busy ? 'disabled' : ''}>${LB.busy ? 'Running the lab… (2–4 min)' : 'Run the lab now'}</button>`;
  const head = `<div class="row">${run}<span class="note">${esc(LB.note)}</span></div><div class="row" style="font-size:12.5px">${bullLine(J.bull)}</div>`;
  if (!L) return `<div class="lab">${head}<div class="empty">No lab run yet. It runs every Sunday about 5:10 AM ET, or press Run. Until then the bot trades the hand-picked coins with bull-run mode off.</div></div>`;
  const P = L.pick, T = P.test, Bu = L.bull, R = L.regime.base, H = L.holds, btc = H['BTC/USD'], eth = H['ETH/USD'];
  // v0.12.2: the bot only uses a lab run made on complete history (see lib/dca.js labUsable)
  const warn = !L.v || L.v < 2 ? '<div class="errmsg" style="margin:0">This run is from before the price-history fix (about 3 weeks of data per coin). The bot ignores it and keeps the hand-picked coins with bull-run mode off until a new run.</div>'
    : L.v < 3 ? '<div class="errmsg" style="margin:0">This run tested the old deal rules (4–6 dip buys, small first buy). The bot ignores it and keeps the hand-picked coins with bull-run mode off until a run on the new rules (3 dip buys, 15% first buy).</div>'
    : L.partial ? '<div class="errmsg" style="margin:0">Made while older price history was still downloading, so it covers less time than it says. Preview only: the bot keeps the hand-picked coins with bull-run mode off until a run on complete history (the download finishes by itself over a few days; pressing Run also adds to it).</div>' : '';
  const cmp = (x) => x ? `${labP(x.b.ret)} <span class="muted">(worst drop ${nf(x.b.dd, 1, '%')})</span>` : '—';
  const v1 = `<div class="vbox"><b class="h">1 · WHICH COINS</b>${P.use ? `Leaving out losing coins <b class="up">helped</b> on data it never saw` : `Leaving out losing coins <b>did not help</b> on data it never saw, so the bot keeps the hand-picked list`}: last third (${esc(L.split)} on) picked coins ${cmp(T.picked)} vs every coin ${cmp(T.every)} vs hand list ${cmp(T.hand)}.
    <div style="margin-top:4px"><b>Trading now:</b> ${esc(P.active.map(labCoin).join(', '))}${P.blocked?.length ? `<br><span class="muted">Left out: ${esc(P.blocked.map(b => labCoin(b.s)).join(', '))}</span>` : ''}</div></div>`;
  const v2 = `<div class="vbox"><b class="h">2 · BULL RUNS VS THE REST</b>BTC was in an uptrend ${nf(R.bullTime, 0, '%')} of the time. During uptrends the bot made ${labP(R.bullPct)} of its budget while holding BTC made ${labP(R.btcBullPct)}. The rest of the time: bot ${labP(R.restPct)}, BTC ${labP(R.btcRestPct)}.
    <div style="margin-top:4px">Whole test (${esc(L.from)} → ${esc(L.to)}): bot ${labP(Bu.base.all.ret)} (worst drop ${nf(Bu.base.all.dd, 1, '%')}) · hold BTC ${labP(btc?.all)} · hold ETH ${labP(eth?.all)} · hold the bot's coins ${labP(H.activeEqual?.all)}</div></div>`;
  const ch = Bu.chosen, bb = Bu.combos.find(c => c.share === Bu.best.share && c.tb === Bu.best.tb);
  const v3 = `<div class="vbox"><b class="h">3 · BULL-RUN MODE</b>${Bu.use ? `<b class="up">On when BTC is in an uptrend:</b> ${Math.round(ch.share * 100)}% of the crypto budget holds BTC + ETH${ch.tb ? `, deals trail ${ch.tb}% under the best price` : ''}. It beat normal deals on the last third: ${labP(bb.b.ret)} vs ${labP(Bu.base.b.ret)}.`
    : `<b>Off.</b> The best mix on the first two thirds (${Math.round(Bu.best.share * 100)}% core, trail ${Bu.best.tb || 'normal'}) ${bb.b.ret > Bu.base.b.ret ? 'beat' : 'did not beat'} normal deals on the last third (${labP(bb.b.ret)} vs ${labP(Bu.base.b.ret)})${bb.b.ret > Bu.base.b.ret && !(bb.b.ret > 0) ? ' but did not make money there' : ''}, so the bot keeps normal deals.`}
    <div class="muted" style="margin-top:4px">${esc(Bu.rule)}</div></div>`;
  const crow = (c) => `<tr class="${c.share === Bu.best.share && c.tb === Bu.best.tb ? 'pick' : ''}"><td class="l">${Math.round(c.share * 100)}%</td><td>${c.tb ? c.tb + '%' : 'normal'}</td><td>${labP(c.all.ret)}</td><td>${nf(c.all.dd, 1, '%')}</td><td>${labP(c.a.ret)}</td><td>${labP(c.b.ret)}</td><td>${labP(c.regime.bullPct)}</td><td>${labP(c.regime.restPct)}</td></tr>`;
  const combos = `<details><summary class="muted" style="font-size:12.5px">All 12 bull-run mixes tested</summary><div class="scroll"><table><thead><tr><th class="l">Core share</th><th>Trail in uptrends</th><th>Whole test</th><th>Worst drop</th><th>First 2/3</th><th>Last 1/3</th><th>In uptrends</th><th>Rest</th></tr></thead><tbody>${Bu.combos.map(crow).join('')}</tbody></table></div></details>`;
  const krow = (c) => `<tr><td class="l sy">${esc(labCoin(c.s))}${c.meme ? ' <span class="tag t-n">MEME</span>' : ''}</td><td>${esc(c.since)}</td><td>${c.all.n}</td><td>${nf(c.all.win, 0, '%')}</td><td class="${cls(c.all.pnl)}">${f$(c.all.pnl)}</td><td>${labP(c.all.ret)}</td><td>${labP(c.b.ret)}</td><td>${c.all.worst == null ? '—' : sgn(c.all.worst, 1, '%')}</td><td>${c.all.exits}</td><td>${labP(c.hold, 0)}</td><td class="l ${P.active.includes(c.s) ? 'up' : 'muted'}">${P.active.includes(c.s) ? 'trading' : esc(P.blocked?.find(b => b.s === c.s)?.why || 'not picked')}</td></tr>`;
  const coins = `<details ${LB.coins ? 'open' : ''} data-labcoins><summary class="muted" style="font-size:12.5px">Every coin tested alone (${L.coins.length}), best first</summary><div class="scroll"><table><thead><tr><th class="l">Coin</th><th>Data since</th><th>Deals</th><th>Win</th><th>Profit on ${f$(L.perDeal)}</th><th>Return</th><th>Last 1/3</th><th>Worst deal</th><th>Hard exits</th><th>Hold</th><th class="l">Bot</th></tr></thead><tbody>${L.coins.map(krow).join('')}</tbody></table></div></details>`;
  return `<div class="lab">${head}${warn}<div class="note">Last run ${labT(L.at)} · ${L.coins.length} coins · ${esc(L.from)} → ${esc(L.to)} · deal rules: ${esc(L.settings.text)} (${esc(L.settings.source)})${dcaCovLine(L.coverage)}</div>
    <div class="verd">${v1}${v2}${v3}${signalsView(J)}</div>${combos}${coins}<div class="note">${esc(L.assumptions)}</div></div>`;
}
const _dcaRulesBase = dcaRules;
dcaRules = function (d) { const B = state.dcalab?.bull || d?.bull; return _dcaRulesBase(d) + (B ? `<div class="pb" style="font-size:12.5px;padding-top:0">${bullLine(B)} <span class="muted">· details in the DCA lab below</span></div>` : ''); };
document.addEventListener('toggle', e => { if (e.target.matches?.('[data-labcoins]')) LB.coins = e.target.open; }, true);
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-lab]'); if (!b || LB.busy) return;
  LB.busy = true; LB.note = ''; render();
  const j = await api('dcalab', { run: '1' }).catch(x => ({ error: 'network', message: x.message }));
  LB.busy = false; if (!j.error) state.dcalab = j; LB.note = j.error ? (j.message || j.error) : `Done ${labT(j.at)}.`; render();
});
