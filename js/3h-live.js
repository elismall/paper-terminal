// Paper Terminal front end, part 3h (v0.11.0): the open stock/crypto chart updates itself ("live ticking").
// While the chart drawer is open it re-pulls candles with &live=1 (the latest trade is folded into the last candle, 5-second
// server cache): every 5 s for 1m/5m/15m candles, 10 s for 1D/5D, 60 s for longer ranges or a closed stock market.
// The same chart object is reused, so a zoom or pan you made is kept. Classic script; loads after js/2-views.js.
const LIVE = { t: 0, busy: false, reuse: false, at: null };
const _tvChartBase = tvChart;
tvChart = function (box, o = {}) {
  if (box && box.id === 'cvbox' && LIVE.reuse && box.__ch) { const ch = box.__ch; return { set: (bars, opt = {}) => ch.set(bars, { ...opt, keepView: true }), reset: ch.reset, release: ch.release }; }
  const ch = _tvChartBase(box, o); if (box && box.id === 'cvbox') box.__ch = ch; return ch;
};
const liveEvery = (sym, range) => {
  const open = sym.includes('/') || state.quotes?.clock?.open;
  return !open ? 6e4 : /^M(1|5|15)$/.test(range) ? 5e3 : ['1D', '5D', '1H', '1W'].includes(range) ? 1e4 : 6e4;
};
async function liveTick() {
  if (document.hidden || $('#detail').hidden || LIVE.busy || !det.sym || !det.data || det.data.error) return;
  const { sym, range } = det; if (Date.now() - LIVE.t < liveEvery(sym, range)) return;
  LIVE.busy = true; LIVE.t = Date.now();
  const j = await api('bars', { symbol: sym, range, live: '1' }).catch(() => null);
  LIVE.busy = false;
  if (!j || j.error || !j.bars?.length || det.sym !== sym || det.range !== range || $('#detail').hidden) return;
  det.data = j; if (j.stats?.rsi != null) det.stats = j.stats; LIVE.at = j.at;
  const box = $('#cvbox'); if (!box?.__ch || !box.querySelector('canvas')) return;
  LIVE.reuse = true; try { detChart(j, det.plan); } finally { LIVE.reuse = false; }
  const q = j.quote, dh = $('#drawer .dh');
  if (q && dh) { const p = dh.querySelector('.p'); if (p) { p.textContent = fp(q.p); const c = p.nextElementSibling; if (c) { c.className = `num ${cls(q.pct)}`; c.textContent = `${fp(q.chg)} ${fpct(q.pct * 100)}`; } } }
  const st = $('#d-stats'); if (st) st.outerHTML = statRow();
  let b = $('#d-live'); if (!b && dh) { b = document.createElement('span'); b.id = 'd-live'; b.className = 'muted num'; b.style.fontSize = '11.5px'; (dh.querySelector('.p')?.nextElementSibling || dh.querySelector('.p'))?.after(b); }
  if (b) b.textContent = ` · live, every ${Math.round(liveEvery(sym, range) / 1000)} s · ${new Date(j.at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit' })} ET`;
}
setInterval(liveTick, 1000);
