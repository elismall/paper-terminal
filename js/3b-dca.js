// Paper Terminal front end, part 3b: the DCA bot's building blocks (rules card, deal cards with the dip-buy ladder, last run, closed
// deals, training) used by the DCA tab (js/3i-dca.js, v0.12.0), and Swing vs DCA on the Benchmark tab.
// Classic script sharing the global scope; loads after js/3-trade-bot-crypto.js (uses tvChart, pips, BT, CMAX, etTime).
function dcaShell() {
  return `<div class="span12 btsec" id="dcasec"><div class="ph"><span class="fk">D2)</span><h2>DCA bot · 3Commas-style deals</h2><span class="meta" id="dca-meta"></span></div>
    <section class="panel" id="dca-top"></section><div class="btcards" id="dca-cards"></div><section class="panel" id="dca-run" hidden></section></div>`;
}
const dcaMk = m => m === 'crypto' ? 'Crypto' : 'ETFs', dcaOne = m => m === 'crypto' ? 'crypto' : 'ETF';
// Explicit rules: the live trained settings turned into the actual ladder (price step and $ per buy) for one deal.
// v0.13.1: p = first buy as % of the deal (the dip buys share the rest by the size step); no p = the old rule (first buy = deal ÷ ladder factor).
function dcaLadder(S, perDeal, p) {
  let f = 1, sv = 0; for (let j = 0; j < S.n; j++) { f += S.v ** j; sv += S.v ** j; }
  const u = p ? perDeal * p / 100 : perDeal / f, out = []; let dev = 0, step = S.d;
  for (let j = 1; j <= S.n; j++) { dev += step; step *= S.k; out.push({ j, dev, usd: p ? (perDeal - u) * S.v ** (j - 1) / sv : u * S.v ** (j - 1) }); }
  const exit = S.x > 0 ? 100 - (100 - out.at(-1).dev) * (1 - S.x / 100) : null;
  // v0.12.1: the whole deal's loss if every dip buy fills and the hard exit sells exactly at its level (before costs; a fast
  // drop between checks sells lower; training replays hourly checks). Start price = 1, so qty = dollars / price.
  const qty = u + out.reduce((a, x) => a + x.usd / (1 - x.dev / 100), 0), worst = exit != null ? perDeal - qty * (1 - exit / 100) : null;
  return { u, out, exit, worst, worstPct: worst != null ? worst / perDeal * 100 : null };
}
const DCA_START = { a: 'Right away when a slot is free (3Commas "ASAP")', t: 'Only when price is above its 200-day average (uptrend)', d: 'Only in an uptrend (above the 200-day average) and on an hourly dip (RSI under 40)' };
function dcaRules(d) {
  const T = d?.training; if (!T) return '<div class="pb muted" style="font-size:12.5px">Training runs with the next bot run (about a minute on hourly history), then its settings show here.</div>';
  const col = (m) => { const t = T[m], M = d.markets?.[m] || {};
    if (!t || t.error || !t.S) return null;
    const L = dcaLadder(t.S, M.perDeal || (M.budget / M.maxDeals), M.firstPct), S = t.S;
    return { m, t, M, L, S }; };
  const C = ['crypto', 'etf'].map(col), ok = C.filter(Boolean);
  const errs = ['crypto', 'etf'].filter((m, i) => !C[i]).map(m => `<div class="pb" style="font-size:12.5px"><b class="amber">${dcaMk(m)}:</b> <span class="muted">${esc(T[m]?.error || 'not trained yet')}</span></div>`).join('');
  if (!ok.length) return errs;
  const $0 = v => '$' + Math.round(v).toLocaleString('en-US');
  const card = (c) => { const r = (l, x) => `<dt>${l}</dt><dd>${x}</dd>`;
    return `<div class="dcar"><div class="sub">${c.m === 'crypto' ? 'Crypto' : 'ETFs'} · ${Math.round((d.split?.[c.m] || 0) * 100)}% = ${$0(c.M.budget)}</div><dl>
      ${r('Trades', esc((c.M.syms || []).join(' ')))}
      ${c.M.meme?.length ? r('Meme coins', `${esc(c.M.meme.join(' '))} <span class="muted">· their own ${c.M.memeMax} slots, for the volatility data</span>`) : ''}
      ${r('Deals at once', `${c.M.maxDeals}, ${$0(c.M.perDeal)} each${c.M.memeMax ? ` (${c.M.maxDeals - c.M.memeMax} regular + ${c.M.memeMax} meme)` : ''}${c.t.proven ? '' : ' <span class="amber">(not proven: half)</span>'}`)}
      ${r('Starts a deal', esc(DCA_START[c.S.f] || c.S.f))}
      ${r('First buy', `${$0(c.L.u)}${c.M.firstPct ? ` <span class="muted">(${c.M.firstPct}% of the deal)</span>` : ''}`)}
      ${r('Dip buys', c.L.out.map(x => `<span class="nw">−${x.dev.toFixed(1)}% ${$0(x.usd)}</span>`).join(' · ') + ' <span class="muted">(below the start)</span>')}
      ${r('Resting at once', `next ${c.M.resting || '—'} dip buys as limit orders${c.m === 'etf' ? ' (day orders, re-placed each morning)' : ' (good till canceled)'}`)}
      ${r('Take profit', c.S.tr ? `trailing: at +${c.S.tp}% over the average it starts following price up and sells the whole position ${c.S.tr}% under the best price, never under +${c.S.tp / 2}%` : `+${c.S.tp}% over the average price, sells the whole position`)}
      ${c.M.minNetPct ? r('Minimum profit', `every take profit nets at least ${c.M.minNetPct}% after costs <span class="muted">(if price is short of that, the sell waits; hard exits still apply)</span>`) : ''}
      ${r('Hard exit', c.L.exit ? `${c.S.x}% under the last dip buy (≈ −${c.L.exit.toFixed(1)}% from the start)` : 'none')}
      ${r('Worst case per deal', c.L.worst != null ? `<span class="down">−${$0(c.L.worst)} (${c.L.worstPct.toFixed(1)}% of the deal)</span> <span class="muted">if every dip buy fills and the hard exit sells right at its price, before costs; a fast drop between checks sells lower</span>` : '<span class="down">no hard exit: the whole deal can be lost</span>')}
      ${r('Backtest, 1 year', `${c.t.n} deals, ${nf(c.t.win, 1, '%')} win, <span class="${cls(c.t.ret)}">${sgn(c.t.ret, 1, '%')}</span>, worst drop ${nf(c.t.dd, 1, '%')} · walk-forward <span class="${cls(c.t.test)}">${sgn(c.t.test, 1, '%')}</span>`)}</dl></div>`; };
  return `<div class="pb" style="padding-top:4px"><div class="sub amber">DCA rules (live)</div><div class="dcarules">${ok.map(card).join('')}</div><div class="muted" style="font-size:11.5px;margin-top:4px">Settings are re-picked daily (432 crypto and 144 ETF combinations, all with 3 dip buys like the real-money plan; crypto includes trailing take profits and the meme slot cap); this always shows what is live now. Several buy orders on one coin = its resting dip buys; one sell order = its take profit.</div></div>${errs}`;
}
function dcaTop(v) {
  const d = v?.dca; if (!d) return v?.error ? '' : loading;
  const t = (l, val, sub, c = '') => `<div class="stat"><span>${l}</span><b class="${c}">${val}</b>${sub ? `<div class="muted num" style="font-size:11.5px">${sub}</div>` : ''}</div>`;
  const M = d.markets, pl = d.deals.reduce((a, x) => a + (x.pl || 0), 0), inv = d.deals.reduce((a, x) => a + (x.invested || 0), 0);
  return `<div class="stats" style="padding:8px 10px">
      ${['crypto', 'etf'].map(m => t(`${dcaMk(m)} deals`, `${M[m].open} / ${M[m].maxDeals} <span class="pips">${pips(M[m].open, M[m].maxDeals)}</span>`, `${f$(M[m].reserved)} of ${f$(M[m].budget)} reserved${M[m].memeMax ? ` · meme ${M[m].memeOpen || 0}/${M[m].memeMax}` : ''}`)).join('')}
      ${t('DCA open P&L', f$(pl), `${f$(inv)} invested now`, cls(pl))}
      ${t('Deals started today', v.today?.dca ?? '—', `budget ${f$(d.budget)} · ${Math.round(d.split.crypto * 100)}% crypto / ${Math.round(d.split.etf * 100)}% ETFs`)}
    </div>${dcaRules(d)}
    <details class="pb" style="font-size:12.5px"><summary class="muted">How the DCA bot works</summary><div style="color:var(--ink2);margin-top:6px">Each deal buys a starting amount, then rests limit orders to buy more if price keeps falling ("dip buys", each one bigger and further down). The take profit sells everything a small gain above the average price (crypto can instead use a trailing take profit: past the target it follows price up and sells on the first pullback, so a big run is not cut off at the target), then the bot can start a new deal. Crypto runs up to 10 deals at once: 8 regular coins plus 2 slots kept for meme coins (DOGE, SHIB, PEPE, BONK, WIF, TRUMP) to collect data on how DCA handles their swings. Unlike a default 3Commas bot, every deal has a hard exit a set distance below the last dip buy, so no deal can sink forever. The settings are picked every day from hundreds of combinations replayed on a year of hourly prices, under the same run schedule the bot really has. Crypto orders are checked every 5 minutes (weekends too); ETF orders every 15 minutes while the market is open (since v0.14.0). Training still replays hourly crypto checks and three ETF checks a day, so live checks are more frequent than the test (faster trailing and hard exits). Resting dip buys, take profits and trailing floors fill any time. ETF orders are fractional-share day orders, so they are re-placed each morning. The DCA bot never touches coins or ETFs held by the swing bot or by you. ${isLive() ? '<b class="down">Live mode: real money, capped by LIVE_MAX_USD.</b>' : 'Paper money only.'} Compare it with the swing bot on the Benchmark tab.</div></details>`;
}
function dcaCard(d) {
  return `<article class="btc" data-k="${esc(d.key)}"><header><button class="sy" data-sym="${esc(d.s)}">${esc(d.s)}</button><span class="tag t-long">DCA</span><span class="tag t-n">${d.market === 'crypto' ? 'CRYPTO' : 'ETF'}</span>${d.meme ? '<span class="tag t-n" style="background:#4a3500;color:#ffcf66">MEME</span>' : ''}
      <span class="btsetup">dip buys <span class="pips dcapips"></span></span><span class="btpl"></span><button class="xbtn btmax" data-max="${esc(d.key)}" title="Open this chart full screen">&#x2922; Maximize</button></header>
    <div class="btchart"></div><div class="btbody"><dl class="kv btkv"></dl><div class="btwhy"></div></div></article>`;
}
function dcaPaintCard(el, d) {
  el.querySelector('.dcapips').innerHTML = `${pips(d.dips, d.n)} <span class="num">${d.dips}/${d.n}</span>`;
  el.querySelector('.btpl').innerHTML = `<b class="${cls(d.pl)}">${f$(d.pl)}</b> <span class="${cls(d.plpc)}">${fpct(d.plpc)}</span>`;
  const live = (on, what) => on ? '<span class="up">live</span>' : `<span class="amber">${d.sessionOnly ? 'placed at the next run in market hours' : 'placed at the next run'}</span>`;
  el.querySelector('.btkv').innerHTML = `<dt>Average price</dt><dd>${fp(d.avg)} · ${+(+d.qty).toFixed(6)} ${d.market === 'crypto' ? d.s.replace('/USD', '') : 'sh'}</dd><dt>Now</dt><dd class="${cls(d.px - d.avg)}">${fp(d.px)}</dd>
    ${d.trail ? `<dt>Trailing take profit</dt><dd class="up">${d.trail.on ? `active: sells under ${fp(d.trail.floor)} <span class="muted">(${d.trail.tr}% under the best ${fp(d.trail.peak)}, never under ${fp(d.trail.minF)})</span> · ${d.trail.live ? '<span class="up">live</span>' : '<span class="amber">set at the next check (every 5 min)</span>'}` : `starts at ${fp(d.trail.act)} <span class="muted">(+${d.S.tp}%, ${sgn((d.trail.act / d.px - 1) * 100, 2, '%')} away); then follows price up, selling ${d.trail.tr}% under the best price</span>`}</dd>`
      : `<dt>Take profit</dt><dd class="up">${fp(d.tp)} <span class="muted">(${sgn(d.tpAway, 2, '%')} away)</span> · ${live(d.tpLive)}</dd>`}
    <dt>Next dip buy</dt><dd>${d.next ? `#${d.next.j} at ${fp(d.next.px)} for ${f$(d.next.usd)} · ${live(d.next.live)}` : '<span class="muted">all dip buys used</span>'}</dd>
    <dt>Hard exit</dt><dd class="down">${d.exitPx ? fp(d.exitPx) : 'none'}</dd><dt>Invested</dt><dd>${f$(d.invested)} of ${f$(d.reserved)} max</dd>
    <dt>Started</dt><dd>${new Date(d.entryAt).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET at ${fp(d.start)}</dd>`;
  el.querySelector('.btwhy').innerHTML = `<div class="sub">The ladder</div><ul>${d.levels.map(L => `<li class="${L.filled ? 'up' : ''}">#${L.j} · ${fp(L.px)} (−${L.dev}%) · ${f$(L.usd)} · ${L.filled ? 'filled' : L.live ? 'resting' : 'waiting'}</li>`).join('')}<li class="muted">Rule: ${esc(d.filter)}; ${d.S.tr ? `trailing take profit from +${d.S.tp}% (${d.S.tr}% trail)` : `take profit +${d.S.tp}% over the average`}; ${d.S.x ? `hard exit ${d.S.x}% below the last dip buy` : 'no stop'}.</li></ul>`;
  let ch = BT.charts[d.key]; const title = `${d.s} · DCA · ${d.tf || ''}`;
  if (!ch || !el.querySelector('.btchart canvas')) ch = BT.charts[d.key] = tvChart(el.querySelector('.btchart'), { title, pulse: true, lastVsPrev: true });
  const bars = (d.bars || []).map(b => ({ ...b }));
  if (bars.length && d.px) { const L = bars[bars.length - 1]; L.c = d.px; L.h = Math.max(L.h, d.px); L.l = Math.min(L.l, d.px); }
  const et0 = new Date(d.entryAt).getTime(); let bi = bars.findIndex(b => new Date(b.t).getTime() + 1 >= et0); if (bi < 0) bi = bars.length - 1;
  const plines = [d.trail ? (d.trail.on ? { price: d.trail.floor, color: '#26a69a', label: 'TRAIL FLOOR', fit: true, fill: 'rgba(38,166,154,.07)', fillTo: d.avg } : { price: d.trail.act, color: '#26a69a', label: 'TRAIL STARTS', fit: true, dash: [4, 4] })
      : { price: d.tp, color: '#26a69a', label: 'TAKE PROFIT', fit: true, fill: 'rgba(38,166,154,.07)', fillTo: d.avg }, { price: d.avg, color: '#2962ff', label: 'AVG', dash: [3, 3] },
    ...d.levels.filter(L => !L.filled).slice(0, 3).map((L, i) => ({ price: L.px, color: '#ffb300', label: `DIP #${L.j}`, dash: [2, 4], fit: i === 0, tag: i === 0 })),
    d.exitPx && d.dips >= d.n - 1 ? { price: d.exitPx, color: '#ef5350', label: 'HARD EXIT', fit: true } : null].filter(Boolean);
  const opt = { intraday: true, crypto: d.market === 'crypto', plines, marks: [{ key: 'buy', i: bi, text: `START ${fp(d.start)}`, cls: 'buy' }] };
  if (bars.length) { ch.set(bars, { ...opt, keepView: true }); BT.last[d.key] = { title, bars, opt }; if (CMAX.key === d.key && CMAX.ch) CMAX.ch.set(bars, { ...opt, keepView: true }); }
  else el.querySelector('.btchart').innerHTML = '<div class="empty">Chart data is loading…</div>';
}
function dcaRunView(r) {
  if (!r) return '';
  if (r.error) return `<div class="empty err">DCA run failed: ${esc(r.message || r.error)}</div>`;
  const rows = (list, title, cols) => list?.length ? `<div class="pb"><div class="sub">${title}</div></div><div class="scroll"><table><tbody>${list.map(x => `<tr data-sym="${esc(x.s)}"><td class="sy">${esc(x.s)}</td>${cols(x)}</tr>`).join('')}</tbody></table></div>` : '';
  const why = x => `<td class="l ${x.error ? 'down' : ''}">${esc(x.why)}${x.preview ? ' <span class="amber">preview</span>' : ''}</td>`;
  return `<div class="ph"><span class="fk">D2)</span><h2>DCA · last run</h2><span class="meta">${r.started?.some(x => x.preview) || r.actions?.some(x => x.preview) ? 'preview, no orders sent' : ''}</span></div>
    ${rows(r.started, 'Deals started', x => `<td class="l">${esc(dcaMk(x.market))} · ${f$(x.usd)} at ~${fp(x.fill || x.px)} · ${esc(x.why)}</td><td>${x.preview ? '<span class="amber">preview</span>' : esc(x.note || x.status || '')}</td>`)}
    ${rows(r.exits, 'Hard exits', why)}${rows(r.actions, 'Orders', why)}${rows(r.skipped, 'Passed on', why)}
    ${(r.notes || []).map(n => `<div class="pb amber" style="font-size:12.5px">${esc(n)}</div>`).join('')}
    ${!r.started?.length && !r.exits?.length && !r.actions?.length ? '<div class="empty">Nothing to change this run: open deals already had their orders in place and no new deal qualified.</div>' : ''}`;
}
function dcaPaint(v) {
  const top = $('#dca-top'), box = $('#dca-cards'), run = $('#dca-run'); if (!top) return;
  top.innerHTML = dcaTop(v);
  const d = v?.dca, list = d?.deals || [];
  $('#dca-meta').innerHTML = d ? `${list.length} open · ${isLive() ? 'LIVE' : 'paper'}` : '';
  const keys = new Set(list.map(x => x.key));
  box.querySelectorAll('.btc').forEach(el => { if (!keys.has(el.dataset.k)) { delete BT.charts[el.dataset.k]; delete BT.last[el.dataset.k]; el.remove(); } });
  if (d && !list.length) { if (!box.querySelector('.panel')) box.innerHTML = `<section class="panel"><div class="empty"><b>No open DCA deals.</b> The DCA bot starts deals at the scheduled runs when its start rule passes, or press Run DCA now. Each deal shows here with its ladder, average price, take profit and live chart.</div></section>`; }
  else box.querySelector(':scope > .panel')?.remove();
  for (const x of list) {
    let el = box.querySelector(`.btc[data-k="${CSS.escape(x.key)}"]`);
    if (!el) { box.insertAdjacentHTML('beforeend', dcaCard(x)); el = box.lastElementChild; }
    dcaPaintCard(el, x);
  }
  const r = state.botRun?.dca; run.hidden = !r; run.innerHTML = dcaRunView(r);
}

/* ---------- Benchmark tab: Swing vs DCA ---------- */
function dcaCompareView(P) {
  if (!P) return loading; if (P.error) return msg(P);
  const c = P.compare; if (!c?.since) return '<div class="empty">The DCA bot has not opened a deal yet. The comparison starts with its first deal and counts the swing bots\' trades from the same day.</div>';
  const S = c.swing, D = c.dca, row = (l, a, b) => `<tr><td class="l">${l}</td><td>${a}</td><td>${b}</td></tr>`;
  const tot = x => (x.realized || 0) + (x.openPnl || 0);
  const table = `<div class="scroll"><table><thead><tr><th class="l">Since ${esc(new Date(c.since).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}</th><th>Swing bots</th><th>DCA bot</th></tr></thead><tbody>
    ${row('Closed trades / deals', S.n, D.n)}${row('Win rate', nf(S.win, 1, '%'), nf(D.win, 1, '%'))}
    ${row('Realized P&amp;L', `<span class="${cls(S.realized)}">${f$(S.realized)}</span>`, `<span class="${cls(D.realized)}">${f$(D.realized)}</span>`)}
    ${row('Average per trade / deal', `<span class="${cls(S.avg)}">${f$(S.avg)}</span>`, `<span class="${cls(D.avg)}">${f$(D.avg)}</span>`)}
    ${row('Worst trade / deal', `<span class="${cls(S.worst)}">${f$(S.worst)}</span>`, `<span class="${cls(D.worst)}">${f$(D.worst)}</span>`)}
    ${row('Open now', S.open, D.open)}${row('Open P&amp;L', `<span class="${cls(S.openPnl)}">${f$(S.openPnl)}</span>`, `<span class="${cls(D.openPnl)}">${f$(D.openPnl)}</span>`)}
    ${row('<b>Total (realized + open)</b>', `<b class="${cls(tot(S))}">${f$(tot(S))}</b>`, `<b class="${cls(tot(D))}">${f$(tot(D))}</b>`)}
    ${['crypto', 'meme', 'etf'].map(m => row(m === 'meme' ? '…of which meme coins' : `DCA ${dcaOne(m)} deals`, '', `${D.byMarket?.[m]?.n || 0} · <span class="${cls(D.byMarket?.[m]?.realized)}">${f$(D.byMarket?.[m]?.realized || 0)}</span>${D.byMarket?.[m]?.n ? ` · ${nf(D.byMarket[m].win, 1, '%')} win` : ''}`)).join('')}</tbody></table></div>`;
  return table;
}
// Closed DCA deals, newest first (DCA tab).
function dcaClosedView(P) {
  if (!P) return loading; if (P.error) return msg(P);
  const c = P.compare;
  return c?.deals?.length ? `<div class="scroll"><table><thead><tr><th>Closed</th><th class="l">Symbol</th><th>Dip buys</th><th>Hours</th><th>P&amp;L</th><th>On deal budget</th><th class="l">Exit</th></tr></thead><tbody>${c.deals.slice(0, 40).map(x => `<tr data-sym="${esc(x.s)}"><td>${new Date(x.out).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET</td><td class="l sy">${esc(x.s)}</td><td>${x.dips}</td><td>${x.hours ?? '—'}</td><td class="${cls(x.pnl)}">${f$(x.pnl)}</td><td class="${cls(x.pct)}">${sgn(x.pct, 2, '%')}</td><td class="l">${esc(x.why || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No closed DCA deals yet.</div>';
}
// AI filter scorecard (Jev tab): does Jev's entry score actually separate winners from losers? (closed swing trades + DCA deals)
function jevScoreView(J) {
  if (!J) return '';
  const st = J.status || {}, head = `<div class="pb"><div class="sub">AI second opinion (Jev) scorecard</div>`;
  if (!st.key && !J.n) return head + '<div class="muted" style="font-size:12.5px">Off. Once TYPESAFE_API_KEY is set in Vercel, every new bot trade gets a 0–3 score from Jev (shadow mode: recorded, no effect), and this table shows whether high scores really win more.</div></div>';
  if (!J.n) return head + `<div class="muted" style="font-size:12.5px">Mode: ${esc(st.mode)}. No closed trades with a Jev score yet.</div></div>`;
  return head + `<div class="muted" style="font-size:12.5px">${J.n} closed trades/deals with a score. Worth switching to gate mode only if "Weak" clearly loses and "Strong" clearly wins over 30+ trades.</div></div>
    <div class="scroll"><table><thead><tr><th class="l">Jev score at entry</th><th>Closed</th><th>Win</th><th>Avg P&amp;L</th><th>Total</th></tr></thead><tbody>${J.buckets.map(b => `<tr><td class="l">${esc(b.label)}</td><td>${b.n}</td><td>${nf(b.win, 1, '%')}</td><td class="${cls(b.avg)}">${b.n ? f$(b.avg) : '—'}</td><td class="${cls(b.realized)}">${f$(b.realized || 0)}</td></tr>`).join('')}${(J.flags || []).filter(b => b.n).map(b => `<tr><td class="l">${esc(b.label)}</td><td>${b.n}</td><td>${nf(b.win, 1, '%')}</td><td class="${cls(b.avg)}">${f$(b.avg)}</td><td class="${cls(b.realized)}">${f$(b.realized || 0)}</td></tr>`).join('')}</tbody></table></div>`;
}
// v0.12.1: which coins actually had price history (and why any were left out). Shown on the training and lab panels.
function dcaCovLine(cov) {
  if (!cov?.length) return '';
  const used = cov.filter(c => c.used !== false), out = cov.filter(c => c.used === false);
  const part = cov.filter(c => c.complete === false); // v0.12.2: older history still downloading (lib/hist.js)
  return `<div style="font-size:12px;color:var(--ink2);margin-top:3px">Price history: <b class="${out.length ? 'amber' : ''}">${used.length} of ${cov.length}</b> ${cov.length === 1 ? 'symbol' : 'symbols'} usable${out.length ? ` · left out: ${out.map(c => `${esc(c.s.replace('/USD', ''))} (${esc(c.why || 'no data')})`).join(', ')}` : ''}${part.length ? ` · <span class="amber">older history still downloading for ${part.length}</span> <span class="muted">(${part.slice(0, 6).map(c => `${esc(c.s.replace('/USD', ''))} ${c.back ?? 0} of ${c.want ?? '?'} days`).join(', ')}${part.length > 6 ? ', …' : ''}; finishes by itself over a few runs)</span>` : ''}</div>`;
}
function dcaTrainView(B) {
  if (!B) return loading; if (B.error) return msg(B);
  const T = B.dca; if (!T) return '<div class="empty">DCA training has not run yet.</div>'; if (T.error) return `<div class="empty err">${esc(T.message || T.error)}</div>`;
  return ['crypto', 'etf'].map(m => { const t = T[m];
    if (!t || t.error) return `<div class="pb"><div class="sub">${dcaMk(m)}</div><div class="muted">${esc(t?.error || 'not trained')}</div></div>`;
    const c = t.chosen, line = (l, x) => `<tr><td class="l">${l}</td><td>${x.n ?? '—'}</td><td>${nf(x.win, 1, '%')}</td><td class="${cls(x.ret)}">${sgn(x.ret, 2, '%')}</td><td class="${cls(x.annual)}">${sgn(x.annual, 1, '%')}</td><td class="down">${nf(x.dd, 2, '%')}</td><td class="${cls(x.worst)}">${sgn(x.worst, 2, '%')}</td><td>${x.exits ?? '—'}</td><td>${nf(x.avgHours, 1)}</td></tr>`;
    return `<div class="pb"><div class="sub">${dcaMk(m)} · ${t.syms.map(s => s.replace('/USD', '')).join(' ')} · ${f$(t.budget)} budget, up to ${t.maxDeals} deals of ${f$(t.perDeal)}</div>
      <div style="font-size:12.5px;color:var(--ink2)">Bot uses: <b>${esc(c.text)}</b> · ${t.proven ? `<span class="up">proven</span>: ${esc(t.provenWhy || 'made money over 20+ deals')}` : `<span class="amber">not proven, so the bot runs half the deals</span>: ${esc(t.provenWhy || 'no setting made money over 20+ deals')}`}</div>${dcaCovLine(t.coverage)}</div>
      <div class="scroll"><table><thead><tr><th class="l">${esc(t.from.slice(0, 10))} → ${esc(t.to.slice(0, 10))}</th><th>Deals</th><th>Win</th><th>Return</th><th>Per year</th><th>Worst drop</th><th>Worst deal</th><th>Hard exits</th><th>Avg hours</th></tr></thead><tbody>
      ${line('<b>Trained settings (bot)</b> <span class="muted">· picked on this same history</span>', c)}${line(`Walk-forward: picked on ${esc(t.from.slice(0, 10))} → ${esc(t.walk.split.slice(0, 10))}`, t.walk.train)}${line('…then run on the rest (unseen)', t.walk.test)}${line(`Typical 3Commas setup, no stop${t.classic.openAtEnd ? ` (${t.classic.openAtEnd} deal${t.classic.openAtEnd === 1 ? '' : 's'} still stuck at the end)` : ''}`, t.classic)}
      <tr><td class="l">Buy and hold the same ${m === 'crypto' ? 'coins' : 'ETFs'}</td><td colspan="2"></td><td class="${cls(t.hold)}">${sgn(t.hold, 1, '%')}</td><td colspan="5" class="l muted">equal weight, whole period, no stop</td></tr></tbody></table></div>
      <details class="pb" style="font-size:12.5px"><summary class="muted">Top 12 of ${t.tested} settings tested</summary><div class="scroll"><table><thead><tr><th class="l">Settings</th><th>Deals</th><th>Win</th><th>Return</th><th>Worst drop</th><th>Return ÷ drop</th></tr></thead><tbody>${t.top.map(x => `<tr><td class="l" style="white-space:normal">${esc(`${x.S.n} dips from −${x.S.d}% ×${x.S.k}, size ×${x.S.v}, TP +${x.S.tp}%${x.S.tr ? ` trailing ${x.S.tr}%` : ''}, exit −${x.S.x}%, start: ${{ a: 'ASAP', t: 'uptrend', d: 'uptrend dip' }[x.S.f]}`)}</td><td>${x.n}</td><td>${nf(x.win, 1, '%')}</td><td class="${cls(x.ret)}">${sgn(x.ret, 2, '%')}</td><td>${nf(x.dd, 2, '%')}</td><td>${nf(x.calmar, 2)}</td></tr>`).join('')}</tbody></table></div><div class="muted" style="margin-top:6px">${esc(t.assumptions)}</div></details>`; }).join('');
}
