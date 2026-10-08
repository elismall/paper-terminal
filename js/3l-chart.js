// Paper Terminal front end, part 3l: "Plays from the chart" on the Options tab (v0.18.0; routes/options.js strategy=chart, lib/patterns.js).
// Reads the daily chart of up to 10 stocks (the one you type, your watchlist, the top swing picks), names the pattern, counts what
// it did before on that stock and shows one options play. Ideas only: no order buttons here. Classic script.
const CH = { busy: false, cache: LS.get('chartCache', {}), sym: LS.get('chartSym', '') };
const CH_TTL = 3e5, CH_MAX = 10;
(() => { const st = document.createElement('style'); st.textContent = `
.chp .card{display:grid;gap:6px;align-content:start}.chp .pat{font:700 13px var(--mono);color:var(--amber)}.chp .txt{font:13px var(--sans);color:var(--ink2)}
.chp .hist{font:12.5px var(--sans);color:var(--ink2);background:var(--panel2);border:1px solid var(--line);padding:6px 8px}
.chp .lv{font:12.5px var(--sans)}.chp .lv b{font-weight:700}`; document.head.appendChild(st); })();
const CH_NOTE = 'Reads each stock\'s daily chart (today counts as it trades) for five patterns: a tight range all day, several days of coiling, a breakout on heavy volume, a pullback in an uptrend and a failed breakout. "What happened before" counts every past time the same pattern showed up on that stock in about the last 2 years. Those are past counts, not a forecast. The play is a long call or put when options are cheap compared with how much the stock has been moving, a debit spread when they are not, and a straddle or strangle when the chart could break either way. The most you can lose on every play is what you pay. These are ideas only: nothing here places a trade, and option quotes on the free plan are indicative, so check live prices with your broker.';
function chartList() {
  const sw = state.swing?.plays || [], out = [];
  for (const s of [CH.sym, ...cfg.watch, ...sw.map(p => p.s)]) if (s && !s.includes('/') && !out.includes(s)) out.push(s);
  return out.slice(0, CH_MAX);
}
function chartShell() {
  return panel('ch', '39)', 'Plays from the chart', 'daily chart · patterns · options only', `<div class="chp"><form class="inline" id="chartform"><label>Add a stock<input class="in" id="c-sym" autocomplete="off" spellcheck="false" style="width:100px;text-transform:uppercase" value="${esc(CH.sym)}" placeholder="TSLA"></label><button class="btn primary">Read the chart</button></form><div id="chart-cards"></div></div>`, 'span12', CH_NOTE);
}
// Range patterns (tight, coil) count which side of the range it closed beyond first; the others count where it was N days later.
const chHist = (h, key) => {
  if (!h?.n) return 'This pattern has not shown up on this stock in about the last 2 years, so there is nothing to compare.';
  const range = key === 'tight' || key === 'coil';
  const avg = (v) => v == null ? '' : ` (average ${sgn(v, 1, '%')})`;
  return `<b>What happened before:</b> ${h.n} time${h.n > 1 ? 's' : ''} in about 2 years. ${range ? `Within ${h.days} trading days it broke out up ${h.up}${avg(h.upAvg)}, broke down ${h.down}${avg(h.downAvg)}, and stayed in the range ${h.flat}.` : `${h.days} trading days later it was up ${h.up}${avg(h.upAvg)}, down ${h.down}${avg(h.downAvg)}, and about flat ${h.flat}.`} Past counts, not a forecast.`;
};
function chPlay(i) {
  if (i.call && i.put) return `<dl class="kv"><dt>Expiry</dt><dd>${esc(i.exp)} (${i.dte}d)</dd><dt>Buy call</dt><dd>${fp(i.call.k)} @ ${fp(i.call.ask)}</dd><dt>Buy put</dt><dd>${fp(i.put.k)} @ ${fp(i.put.ask)}</dd><dt>Cost (natural / mid)</dt><dd>${fp(i.cost)} / ${fp(i.costMid)}</dd><dt>Max loss</dt><dd class="down">${f$(i.maxLoss)}</dd><dt>Pays above</dt><dd>${fp(i.beUp)} (${sgn(i.moveUp, 1, '%')})</dd><dt>Pays below</dt><dd>${fp(i.beDown)} (${sgn(-i.moveDown, 1, '%')})</dd></dl>`;
  if (i.strikes) { const k = i.strikes.find(x => x.label === 'At the money') || i.strikes[0];
    return `<dl class="kv"><dt>Expiry</dt><dd>${esc(i.exp)} (${i.dte}d)</dd><dt>Buy ${i.strategy === 'Long put' ? 'put' : 'call'}</dt><dd>${fp(k.k)} @ ${fp(k.ask)}</dd><dt>Max loss</dt><dd class="down">${f$(k.cost)}</dd><dt>Breakeven</dt><dd>${fp(k.breakeven)} (${sgn(k.bePct, 1, '%')})</dd><dt>Decay per day</dt><dd>${k.thetaDay == null ? '—' : f$(k.thetaDay)}</dd>${i.target ? `<dt>Worth at ${fp(i.target)}</dt><dd class="${cls(k.atTarget)}">${f$(k.atTarget)}</dd>` : ''}</dl>`; }
  return `<dl class="kv"><dt>Expiry</dt><dd>${esc(i.exp)} (${i.dte}d)</dd><dt>Buy</dt><dd>${fp(i.buy.k)} @ ${fp(i.buy.ask)}</dd><dt>Sell</dt><dd>${fp(i.sell.k)} @ ${fp(i.sell.bid)}</dd><dt>Cost (natural / mid)</dt><dd>${fp(i.debit)} / ${fp(i.debitMid)}</dd><dt>Max loss</dt><dd class="down">${f$(i.maxLoss)}</dd><dt>Max gain</dt><dd class="up">${f$(i.maxProfit)}</dd><dt>Breakeven</dt><dd>${fp(i.breakeven)}</dd></dl>`;
}
function chartCard(s, j) {
  const head = `<h3><button class="btn" data-sym="${esc(s)}" style="padding:2px 8px"><span class="sy">${esc(s)}</span></button>${j?.px ? `<span class="muted" style="font-size:12px">stock ${fp(j.px)}</span>` : ''}</h3>`;
  if (!j) return `<div class="card">${head}<div class="muted">Reading the chart…</div></div>`;
  if (j.error) return `<div class="card">${head}${msg(j)}</div>`;
  const p = j.pattern; if (!p) return `<div class="card">${head}<div class="muted">${esc(j.message || 'No clear pattern on the chart right now.')}</div></div>`;
  const i = j.idea, v = j.vol;
  const lean = p.dir === 'up' ? 'Leans up' : p.dir === 'down' ? 'Leans down' : 'Could break either way';
  return `<div class="card">${head}<div class="pat">${esc(p.name)}${j.partial ? ' (so far today)' : ''} · ${lean}</div><div class="txt">${esc(p.text)}${p.also.length ? ` Also showing: ${esc(p.also.join(', ').toLowerCase())}.` : ''}</div>
    <div class="hist">${chHist(j.history, p.key)}</div>
    ${i ? `<div class="pat" style="color:var(--ink)">Play: ${esc(i.strategy)}</div>${earnLine(i)}${chPlay(i)}<div class="plan">${esc(i.plan)}</div>` : `<div class="muted">${esc(j.message || 'No option play could be built from the quoted chain.')}</div>`}
    <div class="lv">${p.trigger ? `<b>Only if:</b> ${esc(p.trigger)}. ` : ''}<b>Idea is off if:</b> ${esc(p.off)}.</div>
    ${v?.label ? `<div class="muted" style="font-size:12px">Options are ${esc(v.label)} right now: implied volatility ${v.iv}% vs ${v.rv}% actual movement over 20 days.</div>` : ''}</div>`;
}
function chartPaint() {
  const c = $('#chart-cards'); if (!c) return;
  const list = chartList();
  c.innerHTML = list.length ? `<div class="cards">${list.map(s => chartCard(s, CH.cache[s]?.j)).join('')}</div>` : '<div class="empty">Type a stock above, or add stocks to your watchlist.</div>';
  chartScan();
}
// One stock at a time (the free data plan allows 200 requests a minute, shared with the bots). A failed read is retried after a minute.
async function chartScan() {
  if (CH.busy) return; CH.busy = true;
  try {
    for (const s of chartList()) {
      const c = CH.cache[s]; if (c && Date.now() - c.ts < (c.j?.error ? 6e4 : CH_TTL)) continue;
      const j = await api('options', { symbol: s, strategy: 'chart' }).catch(e => ({ error: 'network', message: e.message }));
      CH.cache[s] = { ts: Date.now(), j };
      const c2 = $('#chart-cards'); if (c2) c2.innerHTML = `<div class="cards">${chartList().map(x => chartCard(x, CH.cache[x]?.j)).join('')}</div>`;
    }
    for (const k of Object.keys(CH.cache)) if (Date.now() - CH.cache[k].ts > 864e5) delete CH.cache[k];
    LS.set('chartCache', CH.cache);
  } finally { CH.busy = false; }
}
document.addEventListener('submit', e => {
  if (e.target.id !== 'chartform') return; e.preventDefault();
  CH.sym = $('#c-sym').value.trim().toUpperCase().replace(/[^A-Z.]/g, ''); LS.set('chartSym', CH.sym);
  if (CH.sym) delete CH.cache[CH.sym];
  chartPaint();
});
