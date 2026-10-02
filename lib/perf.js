// Performance engine: (1) a historical benchmark of the swing rules, (2) live trade journal from the paper account,
// (3) comparisons against SPY buy-and-hold. Shared by /api/benchmark, /api/performance and the bot.
import { bars, swingEval, round, SWING_UNIVERSE, ETFS, CRYPTO_UNIVERSE } from './core.js';
import { jevOf, jevFlagOf } from './jev.js';
import { pget, ordersSince } from './trade.js';
import { blobGet, blobPut } from './notify.js';
import { inSeason } from './season.js';
import { feeRate, feeMode, isCryptoSym } from './fees.js';

export const BUCKETS = [[50, 59], [60, 69], [70, 79], [80, 100]];
// Wider pool for the bot and benchmark: the core swing list plus ~110 more of the most-traded US large caps.
const EXTRA = ('ACN ADI ADP AIG AMGN AMT APD APH AZO BK BKNG BLK BMY BSX BX C CB CDNS CEG CHTR CI CL CMG COF CRH CSX CTAS CVS DASH DHR DUK ECL ELV EMR EOG EQIX ETN FCX FDX FI FTNT GD GILD GM HCA HLT ICE INTU IBM ITW KKR KMB LIN LULU MAR MCK MCO MDLZ MDT MET MMC MMM MO MPC MRVL MSI NEE NOC NSC NXPI ORLY PCAR PGR PH PLD PM PNC PSX REGN ROP RSG SCHW SHW SNPS SO SPG SPGI SYK TDG TJX TMUS TRV TT TTD UNP URI USB VLO WDAY WELL WM ZTS F RIVN SOFI HOOD RBLX DKNG NET DDOG ZS TEAM ON MRNA').split(' ');
export const BOT_UNIVERSE = [...new Set([...SWING_UNIVERSE, ...EXTRA])];
export const COST = 0.0005;                       // stocks: 0.05% per side for slippage/fees (paper doesn't simulate them)
// Breakeven rule (training and both bots): once price has gone half way to the target, the stop moves up to the
// entry price plus a small cushion that covers trading costs, so a trade that was working cannot turn into a real loss.
export const BE = { on: true, at: 0.5, cushionR: 0.05 };
export function beLevels(entry, stop, target, crypto) {
  const R = Math.abs(entry - stop), dir = target >= entry ? 1 : -1, cost = crypto ? 0.0025 : 0.0005;
  return { trigger: entry + dir * BE.at * Math.abs(target - entry), stop: entry + dir * Math.max(BE.cushionR * R, entry * 2 * cost) };
}
// Highest price since each entry (intraday bars), used by the breakeven rule. { SYM: high }
export async function peaksSince(list) {
  if (!list.length) return {};
  const start = new Date(Math.min(...list.map(x => new Date(x.t).getTime()))).toISOString();
  const b = await bars([...new Set(list.map(x => x.s))], { timeframe: '15Min', start }).catch(() => ({}));
  const out = {}; for (const { s, t } of list) out[s] = Math.max(0, ...(b[s] || []).filter(x => new Date(x.t).getTime() + 15 * 6e4 > new Date(t).getTime()).map(x => x.h));
  return out;
}
export const CRYPTO_COST = 0.0025;         // crypto: 0.25% per side (Alpaca crypto taker fee + spread)
// Crypto pool for the bot: liquid coins only (SHIB's tiny price makes stop orders impractical).
export const CRYPTO_BOT = CRYPTO_UNIVERSE.filter(s => s !== 'SHIB/USD');
const HOLD = 20;                           // max trading days in a trade
const day = (t) => String(t).slice(0, 10);
const nyDay = (ms = Date.now()) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const nyMin = (ms = Date.now()) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms)); return (+p.find(x => x.type === 'hour').value % 24) * 60 + +p.find(x => x.type === 'minute').value; };
const sessionDone = (ms = Date.now()) => nyMin(ms) >= 16 * 60 + 15; // today's daily candle counts as finished from 4:15 PM ET

function stats(trades) {
  const n = trades.length; if (!n) return { n: 0 };
  const rs = trades.map(t => t.r).filter(v => v != null && isFinite(v));
  const wins = trades.filter(t => (t.pnl ?? t.r ?? t.pct) > 0);
  const val = t => t.pnl ?? t.r ?? t.pct;
  const gw = trades.reduce((a, t) => a + Math.max(0, val(t)), 0), gl = trades.reduce((a, t) => a + Math.max(0, -val(t)), 0);
  const avgR = rs.length ? rs.reduce((a, v) => a + v, 0) / rs.length : null;
  const avgPct = trades.reduce((a, t) => a + (t.pct || 0), 0) / n;
  const alpha = trades.filter(t => t.spy != null); 
  return { n, win: round(wins.length / n * 100, 1), avgR: round(avgR, 2), expR: round(avgR, 2), avgPct: round(avgPct, 2),
    pf: gl ? round(gw / gl, 2) : null, alpha: alpha.length ? round(alpha.reduce((a, t) => a + (t.pct - t.spy), 0) / alpha.length, 2) : null,
    avgHold: round(trades.reduce((a, t) => a + (t.hold || 0), 0) / n, 1),
    // rough 95% band on expectancy so small samples are not over-read
    band: rs.length > 1 ? round(1.96 * Math.sqrt(rs.reduce((a, v) => a + (v - avgR) ** 2, 0) / (rs.length - 1)) / Math.sqrt(rs.length), 2) : null };
}
const group = (arr, key) => { const g = {}; for (const t of arr) (g[key(t)] ||= []).push(t); return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, stats(v)])); };

// ---- Training / benchmark ----
// 1) collect every swing signal the rules produced over roughly the last 16 months (walk-forward, no look-ahead);
// 2) replay them under a grid of exit settings; 3) pick the setting with the steadiest per-trade profit
//    (highest mean R ÷ spread of R, needs 60+ trades and positive expectancy). That becomes the bot's rulebook.
export const GRID = (() => { const g = []; for (const stop of [1.0, 1.5]) for (const target of [1.0, 1.5, 2.0, 3.0]) for (const hold of [5, 10]) g.push({ stop, target, hold }); return g; })();
async function signals({ days = 800, testBars = 340, crypto = false } = {}) {
  const bench = crypto ? 'BTC/USD' : 'SPY';
  const uni = crypto ? CRYPTO_BOT : BOT_UNIVERSE.filter(s => !ETFS.has(s) || s === 'SPY');
  const b = await bars(uni, { timeframe: '1Day', days, limitPages: 25 });
  if (crypto) { const today = day(new Date().toISOString()); for (const k of Object.keys(b)) if (b[k].length && day(b[k].at(-1).t) === today) b[k] = b[k].slice(0, -1); }   // completed UTC days only
  else if (!sessionDone()) { const today = nyDay(); for (const k of Object.keys(b)) if (b[k].length && nyDay(Date.parse(b[k].at(-1).t)) === today) b[k] = b[k].slice(0, -1); } // v0.14.0: stocks too, until 4:15 PM ET
  const spy = b[bench] || []; const spyIdx = new Map(spy.map((x, i) => [day(x.t), i]));
  const sig = [];
  for (const s of uni) {
    if (s === bench && !crypto) continue; const x = b[s]; if (!x || x.length < 280) continue;
    for (let i = Math.max(260, x.length - testBars); i < x.length - 2; i++) {
      const si = spyIdx.get(day(x[i].t)); const bench = si != null && si >= 63 ? spy[si].c / spy[si - 63].c - 1 : 0;
      const r = swingEval(s, x.slice(i - 259, i + 1), bench); if (r) sig.push({ s, x, i, r });
    }
  }
  return { sig, spy, spyIdx, uni, testBars, crypto, lastBar: spy.length ? day(spy.at(-1).t) : null };
}
function simulate({ sig, spy, spyIdx, crypto }, P) {
  const COST_ = crypto ? CRYPTO_COST : COST;
  const trades = [], busy = {};
  for (const { s, x, i, r } of sig) {
    if (busy[s] != null && i <= busy[s]) continue;                        // one position per symbol at a time
    const long = r.dir === 'long'; const e = x[i + 1].o * (long ? 1 + COST_ : 1 - COST_); const risk = P.stop * r.atr;
    if (!(risk > 0)) continue;                                               // bad ATR: skip rather than poison the stats
    const stop = long ? e - risk : e + risk, target = long ? e + P.target * r.atr : e - P.target * r.atr;
    const be = BE.on ? beLevels(e, stop, target, crypto) : null;
    let exit = null, j = i + 1, why = 'time', st = stop, armed = false;
    for (; j < Math.min(x.length, i + 1 + P.hold); j++) {
      const k = x[j];
      if (long ? k.l <= st : k.h >= st) { exit = st; why = armed ? 'breakeven' : 'stop'; break; }   // stop first when a bar touches both
      if (long ? k.h >= target : k.l <= target) { exit = target; why = 'target'; break; }
      if (be && !armed && (long ? k.h >= be.trigger : k.l <= be.trigger)) { armed = true; st = be.stop; }   // takes effect from the next bar (the bot checks on its runs)
    }
    if (exit == null) { j = Math.min(x.length - 1, i + P.hold); exit = x[j].c; }
    exit = exit * (long ? 1 - COST_ : 1 + COST_); busy[s] = j;
    const pnl = long ? exit - e : e - exit; const s0 = spyIdx.get(day(x[i + 1].t)), s1 = spyIdx.get(day(x[j].t));
    trades.push({ s, setup: r.setup, dir: r.dir, score: r.score, in: day(x[i + 1].t), out: day(x[j].t), r: pnl / risk, pct: pnl / e * 100,
      spy: s0 != null && s1 != null ? (spy[s1].c / spy[s0].o - 1) * 100 * (long ? 1 : -1) : null, hold: j - i, why });
  }
  return trades.sort((a, z) => a.out.localeCompare(z.out));
}
const consistency = (tr) => { const r = tr.map(t => t.r); if (r.length < 2) return -9; const m = r.reduce((a, v) => a + v, 0) / r.length; const sd = Math.sqrt(r.reduce((a, v) => a + (v - m) ** 2, 0) / (r.length - 1)); return sd ? m / sd : -9; };
const bucketOf = t => { const b2 = BUCKETS.find(([lo, hi]) => t.score >= lo && t.score <= hi); return b2 ? `${b2[0]}–${b2[1]}` : '<50'; };
function recScore(byScore) { let rec = 80; for (const [lo, hi] of [...BUCKETS].reverse()) { const st = byScore[`${lo}–${hi}`]; if (st && st.n >= 30 && st.expR > 0) rec = lo; else if (st && st.n >= 30) break; } return Math.max(55, rec); }

// v0.15.0 honest held-out check (a REPORT only: the bot keeps the settings picked on the full period below). Signals up to two
// thirds of the way through are used to pick the exit setting the same way; that setting is then replayed, untouched, on the
// last third. Results there were not used to choose anything. Trades entered before the cut may exit after it.
export function holdout(S, minN) {
  const ds = [...new Set(S.sig.map(z => day(z.x[z.i].t)))].sort(); if (ds.length < 30) return null;
  const cut = ds[Math.floor(ds.length * 2 / 3)];
  const A = { ...S, sig: S.sig.filter(z => day(z.x[z.i].t) < cut) }, T = { ...S, sig: S.sig.filter(z => day(z.x[z.i].t) >= cut) };
  const v = GRID.map(P => { const tr = simulate(A, P).filter(t => t.dir === 'long'); return { ...P, ...stats(tr), cons: round(consistency(tr), 3) }; });
  const ok = v.filter(x => x.n >= Math.round(minN * 2 / 3) && x.expR > 0);
  const pick = (ok.length ? ok : v).reduce((a, x) => (x.cons > a.cons || (x.cons === a.cons && x.win > a.win)) ? x : a);
  const test = simulate(T, pick).filter(t => t.dir === 'long');
  return { cut, pickedOn: `${ds[0]} to ${ds[ds.findIndex(d => d >= cut) - 1] || ds[0]}`, testedOn: `${cut} to ${ds.at(-1)}`, chosen: { stop: pick.stop, target: pick.target, hold: pick.hold }, proven: ok.length > 0,
    overallLong: stats(test), bySetup: group(test, t => t.setup) };
}
export async function backtest(opts = {}) {
  const S = await signals(opts);
  const minN = opts.crypto ? 40 : 60;
  // training grid (long trades, which is what the bot takes)
  const variants = GRID.map(P => { const tr = simulate(S, P).filter(t => t.dir === 'long'); const st = stats(tr); return { ...P, ...st, cons: round(consistency(tr), 3), tr }; });
  const ok = variants.filter(v => v.n >= minN && v.expR > 0);
  const best = (ok.length ? ok : variants).reduce((a, v) => (v.cons > a.cons || (v.cons === a.cons && v.win > a.win)) ? v : a);
  const trades = simulate(S, best);                                        // all trades (long + short) under the chosen rules
  const longs = trades.filter(t => t.dir === 'long');
  const byScore = group(longs, bucketOf);
  let cum = 0; const curve = longs.map(t => (cum += t.r, round(cum, 2)));
  const spy = S.spy, tb = S.testBars;
  return {
    from: trades[0]?.in, to: trades.at(-1)?.out, lastBar: S.lastBar || null,
    chosen: { stop: best.stop, target: best.target, hold: best.hold, cons: best.cons }, proven: ok.length > 0, market: S.crypto ? 'crypto' : 'stocks',
    training: variants.map(({ tr, ...v }) => v).sort((a, z) => z.cons - a.cons),
    overall: stats(trades), overallLong: stats(longs), bySetup: group(longs, t => t.setup), byScore, recMinScore: recScore(byScore), holdout: holdout(S, minN),
    curve: curve.filter((_, i) => i % Math.max(1, Math.ceil(curve.length / 300)) === 0),
    spyBuyHold: spy.length > tb ? round((spy.at(-1).c / spy[spy.length - tb].c - 1) * 100, 1) : null,
    signalsPerDay: round(S.sig.filter(z => z.r.dir === 'long').length / Math.max(1, tb), 1),
    assumptions: { entry: 'next day open', stop: best.stop + ' ATR', target: best.target + ' ATR', maxHold: best.hold + (S.crypto ? ' calendar days' : ' days'), costs: S.crypto ? '0.25% per side' : '0.05% per side', universe: S.crypto ? S.uni.length + ' coins' : S.uni.length - 1 + ' stocks/ETFs',
      note: 'One position per symbol at a time. Stop assumed first when a bar touches both. Breakeven rule: once a day trades half way to the target, the stop moves to entry (+ a cost cushion) from the next day. The exit settings were picked on this same period, so treat results as an optimistic baseline and judge the bot on live paper results. A held-out check (holdout) picks the setting on the first two thirds and reports the untouched last third.' },
    recent: longs.slice(-25).reverse(),
  };
}

// v0.14.0: the stock bot's training, cached in Blob once per finished session (the bot now checks every 15 minutes, and a full
// replay of ~200 stocks is too heavy to repeat each time). The 4:20 PM ET wrap-up run retrains on the day's finished candle;
// any run whose newest finished candle is newer than the cache (e.g. the first run after a deploy) retrains and saves.
export const TRAIN_STOCKS_KEY = 'train/stocks-v1.json';
export const trainSlim = (bm) => ({ chosen: bm.chosen, proven: bm.proven, recMinScore: bm.recMinScore, bySetup: bm.bySetup, byScore: bm.byScore, overallLong: bm.overallLong, holdout: bm.holdout || null, lastBar: bm.lastBar, error: bm.error });
export async function stockTraining({ fresh = false, lastDone = null, cacheOnly = false } = {}) {
  const c = fresh ? null : await blobGet(TRAIN_STOCKS_KEY, { fresh: true }).catch(() => null);
  if (cacheOnly) return c?.bm ? { ...c.bm, cachedAt: c.at, cached: true } : null;
  if (c?.bm && (!lastDone || (c.bm.lastBar && c.bm.lastBar >= lastDone))) return { ...c.bm, cachedAt: c.at, cached: true };
  const bm = await backtest().catch(e => ({ error: e.message }));
  if (bm.error) return c?.bm ? { ...c.bm, cachedAt: c.at, cached: true, stale: bm.error } : bm;
  const slim = trainSlim(bm); await blobPut(TRAIN_STOCKS_KEY, JSON.stringify({ at: new Date().toISOString(), bm: slim }), { maxAge: 60 }).catch(() => null);
  return { ...slim, cachedAt: new Date().toISOString(), cached: false };
}

// Round-trip trades from paper fills (FIFO per symbol), tagged with the setup from the bot's order id.
// v0.16.0: every trade is scored after estimated costs (lib/fees.js): pnl, pct and r are net; pnlGross/rGross keep the raw fill numbers.
export async function liveTrades({ all = false } = {}) {
  const fm = await feeMode().catch(() => ({ charged: false }));
  const fills = []; let token = '';
  for (let p = 0; p < 40; p++) {
    const a = await pget(`/v2/account/activities?activity_types=FILL&direction=asc&page_size=100${token ? '&page_token=' + token : ''}`);
    if (!a.length) break; fills.push(...a); token = a.at(-1).id; if (a.length < 100) break;
  }
  const orders = await ordersSince(365, 10);
  const info = new Map();
  for (const o of orders) {
    const stopLeg = (o.legs || []).find(l => l.stop_price); const tag = o.client_order_id || '';
    const cs = /-s(\d+(?:\.\d+)?)(?:-|$)/.exec(tag);   // bot orders carry their original stop in the order id (it may later move to breakeven)
    const meta = { coid: tag, stop: cs ? +cs[1] : o.stop_loss?.stop_price ? +o.stop_loss.stop_price : stopLeg ? +stopLeg.stop_price : null, type: o.type, cls: o.asset_class };
    info.set(o.id, meta);
    for (const l of o.legs || []) info.set(l.id, { coid: tag, stop: meta.stop, type: l.type, leg: true, cls: o.asset_class });
  }
  const NAMES = { breakout: 'Breakout', pullback: 'Pullback', oversoldinuptrend: 'Oversold in uptrend', breakdown: 'Breakdown' };
  // v0.14.0: which run bought it: -om = the 9:45 AM morning run (yesterday's finished candle), -oi = an intraday scan (today's candle so far)
  const whenOf = (coid) => /^tbbot-.*-om(?:-|$)/.test(coid) ? 'morning' : /^tbbot-.*-oi(?:-|$)/.test(coid) ? 'intraday' : null;
  const setupOf = (coid) => coid.startsWith('tbbot') ? (NAMES[coid.split('-')[3]] || 'Bot') : coid.startsWith('tbcry') ? 'Crypto · ' + (NAMES[coid.split('-')[3]] || 'Bot') : coid.startsWith('tbdca') ? 'DCA' : 'Manual';   // DCA deals are scored per deal in lib/dca.js
  const whyOf = (m, long, px, inPx) => { const c = m.coid || '';
    const w = m.type === 'stop' || m.type === 'stop_limit' ? 'stop' : (m.leg || c.startsWith('tbprot')) && m.type === 'limit' ? 'target' : /^tbcx-.*-tgt/.test(c) ? 'target' : /^tb(exit|cx)-.*-be/.test(c) ? 'breakeven' : /^tb(exit|cx)/.test(c) ? 'time' : 'manual';
    return w === 'stop' && (long ? px >= inPx * 0.999 : px <= inPx * 1.001) ? 'breakeven' : w; };   // a stop filled at or above entry = the breakeven stop
  const open = {}; const trades = [];
  for (const f of fills) {
    const sym = f.symbol, px = +f.price, mult = /\d{6}[CP]\d{8}$/.test(sym) ? 100 : 1;
    let q = +f.qty * (f.side === 'buy' ? 1 : -1);
    const lots = (open[sym] ||= []); const m = info.get(f.order_id) || {};
    while (q !== 0 && lots.length && Math.sign(lots[0].q) !== Math.sign(q)) {
      const lot = lots[0]; const take = Math.min(Math.abs(q), Math.abs(lot.q)); const long = lot.q > 0;
      const pnl = (long ? px - lot.px : lot.px - px) * take * mult;
      const riskPS = lot.stop ? Math.abs(lot.px - lot.stop) : null, crypto = isCryptoSym(sym, m.cls || lot.cls);
      const fps = lot.px * feeRate({ crypto, type: lot.type, charged: fm.charged }) + px * feeRate({ crypto, type: m.type, charged: fm.charged }); // costs per share/coin, both sides
      const fee = fps * take * mult, gross = long ? px - lot.px : lot.px - px;
      trades.push({ s: sym, setup: lot.setup, dir: long ? 'long' : 'short', qty: take, in: lot.t, out: f.transaction_time, entry: round(lot.px, 4), exit: round(px, 4),
        pnl: round(pnl - fee, 2), pnlGross: round(pnl, 2), fee: round(fee, 2), pct: round((gross - fps) / lot.px * 100, 2), r: riskPS ? round((gross - fps) / riskPS, 2) : null, rGross: riskPS ? round(gross / riskPS, 2) : null,
        why: whyOf(m, long, px, lot.px), ...(lot.jev != null ? { jev: lot.jev, jevFlag: lot.jevFlag } : {}), ...(lot.when ? { when: lot.when } : {}), hold: Math.max(1, Math.round((new Date(f.transaction_time) - new Date(lot.t)) / 864e5)) });
      lot.q -= Math.sign(lot.q) * take; q -= Math.sign(q) * take; if (Math.abs(lot.q) < 1e-9) lots.shift();
    }
    if (Math.abs(q) > 1e-9) lots.push({ q, px, t: f.transaction_time, setup: setupOf(m.coid || ''), stop: m.stop, type: m.type, cls: m.cls, jev: jevOf(m.coid), jevFlag: jevFlagOf(m.coid || ''), when: whenOf(m.coid || '') });
  }
  return trades.filter(t => inSeason(t.in, { all })); // v0.14.0: this season's entries only (lib/season.js)
}

export async function spyOverlay(trades, history) {
  const since = trades.length ? trades[0].in : null;
  const hStart = history?.t?.length ? new Date(history.t[0] * 1000).toISOString() : null;
  const start = [since, hStart].filter(Boolean).sort()[0]; if (!start) return { trades, curve: null };
  const spy = (await bars(['SPY'], { timeframe: '1Day', start: new Date(new Date(start) - 5 * 864e5).toISOString() })).SPY || [];
  const closeOn = (t) => { const d = day(t); let v = null; for (const x of spy) { if (day(x.t) <= d) v = x.c; else break; } return v; };
  for (const t of trades) { const a = closeOn(t.in), z = closeOn(t.out); t.spy = a && z ? round((z / a - 1) * 100 * (t.dir === 'long' ? 1 : -1), 2) : null; t.alpha = t.spy != null ? round(t.pct - t.spy, 2) : null; }
  let curve = null;
  if (history?.t?.length) {
    const eq = history.equity || history.eq; const pts = history.t.map((ts, i) => ({ d: new Date(ts * 1000).toISOString(), e: eq[i] })).filter(p => p.e);
    if (pts.length > 1) { const e0 = pts[0].e, s0 = closeOn(pts[0].d); curve = pts.map(p => ({ d: day(p.d), acct: round((p.e / e0 - 1) * 100, 2), spy: s0 ? round((closeOn(p.d) / s0 - 1) * 100, 2) : null })); }
  }
  return { trades, curve };
}

export function summarize(trades) {
  const byExit = [...trades].sort((a, z) => String(a.out).localeCompare(String(z.out)));
  let cum = 0, cumA = 0;
  const roll = byExit.map((t, i) => {
    cum += t.pct; cumA += t.alpha ?? 0;
    const w = byExit.slice(Math.max(0, i - 9), i + 1);
    return { i: i + 1, s: t.s, cum: round(cum, 2), cumAlpha: round(cumA, 2), roll10: round(w.reduce((a, x) => a + x.pct, 0) / w.length, 2) };
  });
  const bySetup = group(byExit, t => t.setup), byWhen = group(byExit.filter(t => t.when), t => t.when);
  const all = stats(byExit);
  const notes = [];
  if (all.n < 20) notes.push(`${all.n} closed trade${all.n === 1 ? '' : 's'} so far. Live numbers are noise until there are at least 20–30 trades; lean on the benchmark until then.`);
  for (const [k, st] of Object.entries(bySetup)) if (st.n >= 20 && st.expR != null && st.expR < 0) notes.push(`${k} is negative after ${st.n} live trades (${st.expR}R). The bot skips it until it recovers.`);
  const manual = byExit.filter(t => t.setup === 'Manual'), bot = byExit.filter(t => t.setup !== 'Manual');
  if (manual.length >= 10 && bot.length >= 10) notes.push(`Your manual trades average ${stats(manual).avgPct}% per trade vs ${stats(bot).avgPct}% for the bot.`);
  return { overall: all, bySetup, byWhen, roll, notes, bot: stats(bot), manual: stats(manual) };
}
