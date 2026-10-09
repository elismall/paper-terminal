// DCA bot: 3Commas-style deals. Paper by default; live mode only through lib/trade.js (guarded, capped). Runs next to the swing bots.
// A deal: buy a base order -> if price falls, buy more at preset steps below the start ("dip buys", each bigger than the
// last) -> sell everything at a small gain above the average price (take profit) -> start again. Unlike a default
// 3Commas bot, every deal has a hard exit a set distance below the last dip buy, and the settings are trained on history.
// Budget: DCA.budget of the paper account (live mode: DCA.liveShare of LIVE_MAX_USD, see dcaBudget), split crypto / ETFs. Deal state lives in the order ids (no database):
//   tbdca-<deal yymmddHHMM>-<SYM>-<b|s1..sN|tp|ts|hx>-u<base $>-b<start price>-n<dips>-d<first gap %>-k<gap scale>-v<size scale>-t<take profit %>-x<hard exit %>-f<start rule>[-r<trail %>][-p<first buy % of the deal, v0.13.1>]-z<unique>
// Trailing take profit (crypto, r > 0): at +t% over the average the deal starts trailing: a stop-limit sell (ts) follows the best
// price since the last buy, r% under it, and never below +t/2%. Raised at every run (crypto runs hourly). Alpaca has no trailing
// orders for crypto, so the ratchet is the bot's own; between runs the resting stop protects the gain.
// v0.11.0 (crypto focus): the coin list comes from the DCA lab (lib/dcalab.js, weekly): every coin Alpaca lists is tested on
// ~4 years of history and coins that lose money with the bot's rules are left out, but only if that rule also worked on data it
// never saw. Bull-run mode (also decided by the lab): while BTC is in an uptrend, part of the crypto budget holds BTC and ETH
// ("core", order ids tbhodl-...) and deals may use a wider trailing take profit so big runs aren't sold at +1%.
import { feeRate } from './fees.js';
import { bars, snapshots, quoteOf, round } from './core.js';
import { histBars, saveHistStatus } from './hist.js';
import { pget, ppost, pdel, realPositions, tradingMode, recentlyOrdered, timedOut, ppostSure } from './trade.js';
import { flat, floorTo, fmt, assetInfo } from './cryptobot.js';
import { blobReadJson, blobWriteJson } from './notify.js';
import { verdict, jevTag, jevOf, jevFlagOf, chartState } from './jev.js';
import { perpStats, perpOf, levBucket, levTag, levOf, levMode, LEV_TXT } from './leverage.js';
import { liquidity, liqTag, liqOf } from './macro.js';

export const DCA = {
  budget: 20000, split: { crypto: 0.70, etf: 0.30 }, // Eli: 70% crypto / 30% ETFs of a $20k paper budget
  // Eli 2026-09-28: 10 crypto deals at once, 2 of them reserved for meme coins (volatility experiment). Coins Alpaca doesn't list are dropped at run time.
  // syms = the hand-picked list, used until the lab has picked coins (or when the lab finds picking doesn't help).
  // candidates = every non-stablecoin Alpaca listed (March 2026 list; coins it doesn't list are dropped at run time). core = bull-run holdings.
  crypto: { syms: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD', 'AVAX/USD', 'LTC/USD', 'BCH/USD', 'ADA/USD', 'DOT/USD', 'AAVE/USD', 'UNI/USD',
    'DOGE/USD', 'SHIB/USD', 'PEPE/USD', 'BONK/USD', 'WIF/USD', 'TRUMP/USD'],
    candidates: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD', 'AVAX/USD', 'LTC/USD', 'BCH/USD', 'ADA/USD', 'DOT/USD', 'AAVE/USD', 'UNI/USD', 'ARB/USD', 'BAT/USD',
      'CRV/USD', 'FIL/USD', 'GRT/USD', 'HYPE/USD', 'LDO/USD', 'ONDO/USD', 'POL/USD', 'RENDER/USD', 'SKY/USD', 'SUSHI/USD', 'XTZ/USD', 'YFI/USD',
      'DOGE/USD', 'SHIB/USD', 'PEPE/USD', 'BONK/USD', 'WIF/USD', 'TRUMP/USD'],
    meme: ['DOGE/USD', 'SHIB/USD', 'PEPE/USD', 'BONK/USD', 'WIF/USD', 'TRUMP/USD'], memeMax: 2, maxDeals: 10, active: 3, fee: 0.0025, core: ['BTC/USD', 'ETH/USD'] },
  etf: { syms: ['SPY', 'QQQ', 'IWM', 'DIA', 'XLK'], maxDeals: 3, active: 2, fee: 0.0005 },
  minDeals: 20, minTest: 6, trainDays: 365, rsiDip: 40, histMs: 90e3, // histMs = time the daily training may spend downloading older crypto history
  // Eli 2026-09-29 (v0.13.1): the first buy is firstPct of the deal's budget (was: whatever the ladder left, as little as $33), the
  // dip buys share the rest, growing by the size step; and no take profit may net under minNetPct % of the deal after costs
  // (a percentage, not dollars, so the rule works the same on the $100 plan as on the paper budget).
  firstPct: 15, minNetPct: 0.5,
  liveShare: 0.5, minDealUsd: 25, // v0.17.1 live mode: the DCA budget is liveShare of LIVE_MAX_USD; a deal is never smaller than minDealUsd (fewer, bigger deals on a small budget)
};
// Deal sizing. S.p = first buy as % of the deal (kept in every order id as -p<pct>). Deals opened before v0.13.1 have no p:
// their dip buys are u × v^(j-1) (old rule), so they keep working exactly as they were opened.
export const withP = (S) => S.p != null ? S : { ...S, p: DCA.firstPct };
export const firstBuy = (S, per) => S.p ? per * S.p / 100 : per / factor(S);
export const dealSize = (S, u) => S.p ? u * 100 / S.p : u * factor(S);
// Lowest sell price that nets pct % over the deal's cost after the sell fee: qty × px × (1 − fee) ≥ cost × (1 + pct/100)
// (cost = everything the buys paid, fees included).
export const minExitPx = (qty, cost, fee, pct = DCA.minNetPct) => qty > 0 ? cost * (1 + pct / 100) / (qty * (1 - fee)) : 0;
export const dcaBudget = () => { const m = tradingMode(); return m.live ? Math.min(DCA.budget, m.cap * DCA.liveShare) : DCA.budget; };
export const budgetOf = (m) => dcaBudget() * DCA.split[m];
// Deals a market can run at once: its maxDeals, or fewer when the budget is small (each deal at least DCA.minDealUsd).
export const dealSlots = (market) => Math.max(1, Math.min(DCA[market].maxDeals, Math.floor(budgetOf(market) / DCA.minDealUsd)));
export const isMeme = (sym) => (DCA.crypto.meme || []).includes(String(sym).includes('/') ? sym : String(sym).replace(/USD$/, '/USD'));
// Deal slots per group: meme coins get their own memeMax slots (only if one is tradable); everything else shares the rest.
export function capsOf(market, syms, proven = true) {
  const C = DCA[market], slots = dealSlots(market), max = proven ? slots : Math.max(1, Math.floor(slots / 2));
  const mm = market === 'crypto' && syms.some(isMeme) ? Math.min(C.memeMax || 0, Math.max(0, max - 1)) : 0;
  const meme = proven ? mm : Math.min(mm, Math.floor(mm / 2)); return { max, meme, reg: max - meme };
}
// Coins Alpaca lists as active + tradable right now (cached an hour per instance), so an unlisted coin never breaks a data request.
let ACT = null;
async function listed() {
  if (!ACT || Date.now() - ACT.at > 36e5) { const a = await pget('/v2/assets?status=active&asset_class=crypto').catch(() => null); if (Array.isArray(a) && a.length) ACT = { at: Date.now(), set: new Set(a.filter(x => x.tradable !== false).map(x => x.symbol)) }; }
  return ACT?.set || null;
}
// The coins the bot trades: the lab's picks when a recent lab run found that picking helps, else the hand-picked list.
export async function tradableSyms(market) {
  const C = DCA[market]; if (market !== 'crypto') return C.syms;
  const L = await labLatest(), list = L?.pick?.use && L.pick.active?.length ? L.pick.active : C.syms, set = await listed();
  return set ? list.filter(s => set.has(s)) : list;
}
export const allCrypto = () => [...new Set([...DCA.crypto.syms, ...DCA.crypto.candidates])];
export async function tradableCandidates() { const set = await listed(); return set ? DCA.crypto.candidates.filter(s => set.has(s)) : DCA.crypto.candidates; }
// ---------------- DCA lab results (written weekly by lib/dcalab.js) ----------------
export const LAB_KEY = 'dca/lab-v1.json';
let LAB = null, LAB_ERR = null;
export const labError = () => LAB_ERR; // v0.12.1: a failed read is "unknown", not "no lab"
// v0.12.2: the bot only uses a lab run made on complete history (v >= 3 since v0.13.1's 3-dip-buy rules, not partial). Older runs (v1 had ~3 weeks per coin, v2 = old sizing) and runs
// made while older history was still downloading are shown on the DCA tab (any: true) but the bot keeps the hand list, bull mode off.
export const labUsable = (j) => !!(j?.at && Date.now() - Date.parse(j.at) < 10 * 864e5 && j.v >= 3 && !j.partial); // older than 10 days: ignored
export async function labLatest({ fresh = false, any = false } = {}) {
  const pick = () => any ? LAB.raw : LAB.v;
  if (!fresh && LAB && Date.now() - LAB.t < 36e5) return pick();
  const j = await blobReadJson(LAB_KEY, fresh ? { fresh: true } : undefined).catch(e => ({ __err: String(e?.message || e).slice(0, 120) }));
  if (j?.__err) { LAB_ERR = j.__err; return LAB ? pick() : null; }
  LAB_ERR = null;
  LAB = { t: Date.now(), raw: j?.at ? j : null, v: labUsable(j) ? j : null };
  return pick();
}
export const resetLab = () => { LAB = null; REG = null; }; // after a lab run (and in tests): re-read the lab and BTC's regime
// Crypto price text for orders: the asset's price increment when Alpaca gives one; otherwise enough decimals for sub-cent meme coins.
const pxText = (v, inc) => inc > 0 ? fmt(v, inc) : (+v).toFixed(v >= 100 ? 2 : v >= 1 ? 4 : v >= 0.01 ? 6 : 10);
export const marketOf = (sym) => String(sym).includes('/') ? 'crypto' : 'etf'; // order symbols: crypto is always BTC/USD style
export const FILTERS = { a: 'starts right away (3Commas "ASAP")', t: 'starts only when price is above its 200-day average', d: 'starts only above the 200-day average on an hourly dip (RSI under 40)' };
// Training grid (v0.13.1, Eli: "train on what we will actually do"): 3 dip buys only, like the real-money plan, with wider gaps and
// bigger take profits so 3 buys can cover a real drop (deepest dip 6% to 19% below the start). 432 crypto settings, 144 ETF; crypto
// trains on all its coins together, meme coins included, with the meme slot cap. n dip buys, d = first gap %, k = gap scale,
// v = size scale, tp = take profit %, x = hard exit %, f = start rule, tr = trailing %
export const GRIDS = {
  crypto: { n: [3], d: [2, 4], k: [1, 1.5], v: [1.5, 2], tp: [1.5, 2.5, 4], x: [8, 15], f: ['a', 't', 'd'], tr: [0, 2, 4] },
  etf: { n: [3], d: [0.75, 1.5], k: [1, 1.5], v: [1.5, 2], tp: [0.75, 1, 1.5], x: [3, 6], f: ['a', 't', 'd'], tr: [0] },
};
// A typical hand-set 3Commas bot, for comparison: start right away, doubling dip buys, no stop.
export const CLASSIC = { crypto: { n: 5, d: 1, k: 1, v: 2, tp: 1.5, x: 0, f: 'a', tr: 0 }, etf: { n: 5, d: 0.5, k: 1, v: 2, tp: 1, x: 0, f: 'a', tr: 0 } };
export const combos = (g) => { let out = [{}]; for (const [k, vals] of Object.entries(g)) out = out.flatMap(o => vals.map(v => ({ ...o, [k]: v }))); return out; };
export const factor = (S) => { let f = 1; for (let j = 0; j < S.n; j++) f += S.v ** j; return f; }; // whole ladder = base order x factor
export function ladder(S, base, u) {
  const out = []; let dev = 0, step = S.d, sv = 0; for (let j = 0; j < S.n; j++) sv += S.v ** j;
  const rest = S.p ? dealSize(S, u) - u : 0; // v0.13.1: the dip buys share what the first buy leaves
  for (let j = 1; j <= S.n; j++) { dev += step; step *= S.k; out.push({ j, px: base * (1 - dev / 100), usd: S.p ? rest * S.v ** (j - 1) / sv : u * S.v ** (j - 1), dev: +dev.toFixed(2) }); }
  return out;
}
export const exitPxOf = (S, lv) => S.x > 0 && lv.length ? lv.at(-1).px * (1 - S.x / 100) : 0;
export const describe = (S) => `${S.p ? `first buy ${S.p}% of the deal · ` : ''}${S.n} dip buys, first at −${S.d}%${S.k !== 1 ? `, gaps ×${S.k}` : ', even gaps'}, each ${S.v}× the last · ${S.tr ? `trailing take profit from +${S.tp}% (sells ${S.tr}% under the best price, never under +${S.tp / 2}%)` : `take profit +${S.tp}%`} · ${S.x ? `hard exit ${S.x}% below the last dip buy` : 'no stop'} · ${FILTERS[S.f]} · every take profit nets at least ${DCA.minNetPct}% after costs`;

// ---------------- training (hourly bars, same run schedule as the live bot) ----------------
const etFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false });
function et(t) { const p = etFmt.formatToParts(new Date(t)); const g = (k) => p.find(x => x.type === k).value; return { day: `${g('year')}-${g('month')}-${g('day')}`, hour: +g('hour') % 24 }; }
// Scheduled runs (UTC): ETFs 14:40, 16:40, 18:30 on weekdays; crypto every hour (main runs + hourly crypto checks, v0.9.0).
function isRun(ms, market) { if (market !== 'etf') return true; const d = new Date(ms), h = d.getUTCHours(), w = d.getUTCDay(); return w > 0 && w < 6 && (h === 14 || h === 16 || h === 18); }
function rsiPrevSeries(c, n = 14) { // out[i] = RSI of closes up to i-1 (what the bot could see before bar i)
  const out = new Float64Array(c.length).fill(50); let ag = 0, al = 0;
  for (let i = 1; i < c.length; i++) {
    const ch = c[i] - c[i - 1], g = Math.max(0, ch), l = Math.max(0, -ch);
    if (i <= n) { ag += g / n; al += l / n; } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; }
    if (i >= n && i + 1 < c.length) out[i + 1] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}
export const rsiLast = (c) => { const r = rsiPrevSeries([...c, c.at(-1) || 0]); return r.at(-1); };
function trendMap(D) { const m = []; let s = 0; for (let j = 0; j < D.length; j++) { s += D[j].c; if (j >= 200) s -= D[j - 200].c; if (j >= 199) m.push([String(D[j].t).slice(0, 10), D[j].c > s / 200]); } return m; }
// Bull regime (v0.11.0): BTC's daily close above its 200-day average AND the 50-day average above the 200-day. Known after the close.
export function bullMap(D) {
  const m = []; let s50 = 0, s200 = 0;
  for (let j = 0; j < D.length; j++) { const c = D[j].c; s50 += c; s200 += c; if (j >= 50) s50 -= D[j - 50].c; if (j >= 200) s200 -= D[j - 200].c;
    if (j >= 199) m.push([String(D[j].t).slice(0, 10), c > s200 / 200 && s50 / 50 > s200 / 200, round(c, 2), round(s50 / 50, 2), round(s200 / 200, 2)]); }
  return m;
}

// o (DCA lab): { syms, days, timeframe, budgetMs } to test other coins, longer history or coarser bars.
// v0.12.2: crypto history comes from the stored history (lib/hist.js: new candles every run, older ones filled in over several runs).
// P.coverage says what came back for every coin and why any was left out; P.histComplete = false while older history is still downloading.
export const MIN_BARS = 200;
async function prep(market, o = {}) {
  const C = DCA[market], crypto = market === 'crypto', syms = o.syms || await tradableSyms(market), days = o.days || DCA.trainDays, tf = o.timeframe || '1Hour';
  const dSyms = crypto && !syms.includes('BTC/USD') ? [...syms, 'BTC/USD'] : syms;
  let H, Dd, cov = null, histComplete = true, hist = null;
  if (crypto) {
    const budgetMs = o.budgetMs ?? DCA.histMs;
    const [h, d] = await Promise.all([histBars(syms, { timeframe: tf, days, budgetMs, writeStatus: false }), histBars(dSyms, { timeframe: '1Day', days: days + 330, budgetMs, writeStatus: false })]);
    await saveHistStatus([h.statusEntry, d.statusEntry]); // one status write for both files (none when nothing changed)
    H = h.data; Dd = d.data; histComplete = h.complete && d.complete;
    cov = h.cov.map(c => { const dc = d.cov.find(z => z.s === c.s); return { ...c, dailyBars: dc?.bars ?? 0, complete: c.complete && !!dc?.complete, dailyBack: dc?.back ?? 0 }; });
    hist = { ms: Math.max(h.ms, d.ms), pages: [...h.cov, ...d.cov].reduce((a, c) => a + c.pages, 0), saved: h.saved && d.saved, readError: h.readError || d.readError || null };
  } else [H, Dd] = await Promise.all([bars(syms, { timeframe: tf, days, limitPages: 80 }), bars(dSyms, { timeframe: '1Day', days: days + 330, limitPages: 10 + Math.ceil(days / 365) * 4 })]);
  cov ||= syms.map(s => ({ s, bars: (H[s] || []).length, from: H[s]?.[0]?.t?.slice(0, 10) || null, to: H[s]?.at(-1)?.t?.slice(0, 10) || null, dailyBars: (Dd[s] || []).length }));
  const x = {}, dayAt = new Map(), times = new Set(); let hold = 0, nh = 0;
  for (const s of syms) {
    let b = H[s] || []; const dk = [], cv = cov.find(c => c.s === s);
    if (!crypto) { const keep = []; for (const k of b) { const e = et(k.t); if (e.hour >= 9 && e.hour <= 15) { keep.push(k); dk.push(e.day); } } b = keep; }
    else for (const k of b) dk.push(String(k.t).slice(0, 10));
    if (b.length < MIN_BARS) { if (cv) cv.used = false, cv.why = cv.error ? `download failed: ${cv.error}` : b.length ? `only ${b.length} bars (needs ${MIN_BARS})` : 'no bars returned'; continue; }
    if (cv) cv.used = true;
    const tm = trendMap(Dd[s] || []), trend = new Uint8Array(b.length); let p = -1;
    for (let i = 0; i < b.length; i++) { while (p + 1 < tm.length && tm[p + 1][0] < dk[i]) p++; trend[i] = p >= 0 && tm[p][1] ? 1 : 0; }
    const c = b.map(k => k.c), t = b.map(k => Date.parse(k.t));
    x[s] = { t, o: b.map(k => k.o), h: b.map(k => k.h), l: b.map(k => k.l), c, rsi: rsiPrevSeries(c), trend };
    t.forEach((ms, i) => { times.add(ms); if (!crypto) dayAt.set(ms, dk[i]); });
    hold += c.at(-1) / b[0].o - 1; nh++;
  }
  const T = [...times].sort((a, z) => a - z), ix = new Map(T.map((t, i) => [t, i])), at = {};
  for (const s in x) { const a = new Int32Array(T.length).fill(-1); x[s].t.forEach((t, i) => { a[ix.get(t)] = i; }); at[s] = a; }
  const bm = crypto ? bullMap(Dd['BTC/USD'] || []) : [], bull = new Uint8Array(T.length);
  for (let i = 0, p = -1; i < T.length; i++) { const dk = new Date(T[i]).toISOString().slice(0, 10); while (p + 1 < bm.length && bm[p + 1][0] < dk) p++; bull[i] = p >= 0 && bm[p][1] ? 1 : 0; }
  return { market, syms: Object.keys(x), x, T, at, run: T.map(t => isRun(t, market)), day: crypto ? null : T.map(t => dayAt.get(t)), fee: C.fee, bull, tf, coverage: cov, histComplete, hist,
    btcDaily: (Dd['BTC/USD'] || []).length,
    first: Object.fromEntries(Object.entries(x).map(([s, X]) => [s, new Date(X.t[0]).toISOString().slice(0, 10)])),
    budget: budgetOf(market), maxDeals: C.maxDeals, caps: capsOf(market, Object.keys(x)), meme: Object.keys(x).map(isMeme), active: C.active, hold: nh ? hold / nh * 100 : null };
}

// Replays deals the way the live bot runs them: orders only change at scheduled runs; between runs the resting dip buys
// and the take profit (sized to the position at the last run) fill when an hourly bar trades through them. ETF orders are
// day orders (fractional shares), so they expire at the close until the next morning run. Costs are charged on every fill.
// v0.11.0: S.tb = trailing % used while BTC is in a bull regime (P.bull); P.coreOn/P.coreSyms = coins held by the bull-run core,
// where no new deal may start (same rule as the live bot).
// v0.13.1: first buy = S.p % of the deal (DCA.firstPct unless the setting says otherwise); every take profit nets >= minNetPct % after costs.
function simulate(P, S0) {
  const S = withP(S0), { x, T, at, run, day, fee, budget: B, maxDeals: m, active: act } = P, etf = P.market === 'etf', minP = P.minNetPct ?? DCA.minNetPct;
  const per = B / m, u = firstBuy(S, per), open = new Map(), deals = [], eqT = [], eqV = []; let realized = 0;
  const memeOf = new Map(P.syms.map((s, i) => [s, !!P.meme?.[i]])), caps = P.caps || { reg: m, meme: 0 }, nOpen = { reg: 0, meme: 0 };
  const grp = (s) => memeOf.get(s) ? 'meme' : 'reg';
  const sell = (D, q, px) => { const avgC = D.cost / D.qty, pnl = q * px * (1 - fee) - q * avgC; D.pnl += pnl; realized += pnl; D.cost -= q * avgC; D.qty -= q; };
  const close = (s, D, ti, why) => { open.delete(s); nOpen[grp(s)]--; deals.push({ s, in: T[D.t0], out: T[ti], pnl: D.pnl, pct: D.pnl / per * 100, k: D.k, why, h: (T[ti] - T[D.t0]) / 36e5 }); };
  const arm = (D, i, ti) => {
    const p = x[D.s].o[i];
    for (const L of D.lv) if (L.j > D.k && p <= L.px) { D.qty += L.usd / p; D.cost += L.usd * (1 + fee); D.k = L.j; D.peak = p; } // price already below a level: that dip buy fills now
    D.rest = D.lv.filter(L => L.j > D.k).slice(0, act).map(L => ({ j: L.j, px: L.px, usd: L.usd, done: false }));
    D.minPx = minExitPx(D.qty, D.cost, fee, minP); // lowest price that nets the minimum profit (0.5% after costs)
    D.tpPx = Math.max(D.cost / D.qty * (1 + S.tp / 100), D.minPx); D.tpQty = D.qty; D.ti = ti; D.day = etf ? day[ti] : null;
    D.tr = S.tb && P.bull?.[ti] ? Math.max(S.tr, S.tb) : S.tr; // bull-run mode: wider trail while BTC is in an uptrend
    if (D.tr > 0) { // trailing take profit (same rule as manage())
      const avg = D.cost / D.qty, minF = Math.max(avg * (1 + S.tp / 200), D.minPx); D.peak = Math.max(D.peak, p); D.sell = null;
      if (D.peak >= D.tpPx) { const floor = Math.max(D.peak * (1 - D.tr / 100), minF);
        if (p > floor) D.sell = { stop: true, px: floor }; else if (p >= minF) { sell(D, D.qty, p); return true; } else D.sell = { stop: false, px: minF }; }
    }
    return false;
  };
  // v0.12.1 chronological order (audit fix): each candle's OPEN comes first, so the run's decisions (hard exit, re-arming orders,
  // trailing floor, new deals) happen at the open; only then can the resting orders fill against that candle's high/low.
  // A deal that takes profit inside a candle can start again at the NEXT candle's open, never at the earlier open of the same candle.
  // When one candle touches both a dip buy and the sell price, the order inside the candle is unknown: counted in `ambiguous`.
  let ambiguous = 0;
  for (let ti = 0; ti < T.length; ti++) {
    if (P.stopAt && T[ti] >= P.stopAt) break; // lab: pick settings on the first part only
    if (run[ti]) {
      for (const [s, D] of open) {
        const i = at[s][ti]; if (i < 0) continue; const p = x[s].o[i];
        if (D.exitPx && p <= D.exitPx) { sell(D, D.qty, p); close(s, D, ti, 'exit'); continue; }
        if (arm(D, i, ti)) close(s, D, ti, 'tp');
      }
      if (open.size < m) {
        const c = [];
        for (const s of P.syms) {
          if (open.has(s)) continue; const i = at[s][ti]; if (i < 30) continue; const X = x[s];
          if (nOpen[grp(s)] >= caps[grp(s)]) continue; if (P.coreOn?.[ti] && P.coreSyms?.has(s)) continue;
          if (S.f !== 'a' && !X.trend[i]) continue; if (S.f === 'd' && !(X.rsi[i] < DCA.rsiDip)) continue;
          c.push([s, i, X.rsi[i]]);
        }
        c.sort((a, z) => a[2] - z[2]); // deepest dip first
        for (const [s, i] of c) {
          if (open.size >= m) break; const g = grp(s); if (nOpen[g] >= caps[g]) continue; const p = x[s].o[i], lv = ladder(S, p, u);
          const D = { s, t0: ti, qty: u / p, cost: u * (1 + fee), k: 0, pnl: 0, lv, exitPx: exitPxOf(S, lv), last: p, peak: p, sell: null };
          open.set(s, D); nOpen[g]++; if (arm(D, i, ti)) close(s, D, ti, 'tp');
        }
      }
    }
    // the rest of the candle: resting dip buys and the take profit / trailing stop fill if the high/low trade through them
    for (const [s, D] of open) {
      const i = at[s][ti]; if (i < 0 || (etf && D.day !== day[ti])) continue;
      const X = x[s];
      let dip = false;
      for (const L of D.rest) if (!L.done && X.l[i] <= L.px) { L.done = true; dip = true; D.qty += L.usd / L.px; D.cost += L.usd * (1 + fee); if (L.j > D.k) D.k = L.j; D.peak = L.px; D.sell = null; }
      if (D.tr > 0) {
        if (dip && D.sell && !D.sell.stop && X.h[i] >= D.sell.px) ambiguous++;
        if (!dip && D.sell && (D.sell.stop ? X.l[i] <= D.sell.px : X.h[i] >= D.sell.px)) { sell(D, D.qty, D.sell.stop ? Math.max(D.sell.px * 0.998, D.minPx) : D.sell.px); close(s, D, ti, 'tp'); continue; } // the live stop's limit price never goes under the minimum-profit price
        if (!dip) D.peak = Math.max(D.peak, X.h[i]);
      } else if (D.tpQty > 0 && X.h[i] >= D.tpPx) { if (dip) ambiguous++; sell(D, Math.min(D.tpQty, D.qty), D.tpPx); D.tpQty = 0; if (D.qty * D.tpPx < 1) { close(s, D, ti, 'tp'); continue; } }
      D.last = X.c[i];
    }
    let mtm = 0; for (const [s, D] of open) mtm += D.qty * D.last * (1 - fee) - D.cost;
    eqT.push(T[ti]); eqV.push(B + realized + mtm);
  }
  return { deals, eqT, eqV, openAtEnd: open.size, ambiguous };
}
function metrics(r, B, from, to) {
  const i0 = r.eqT.findIndex(t => t >= from); if (i0 < 0) return { n: 0, ret: 0, dd: 0, calmar: 0 };
  let i1 = i0; while (i1 + 1 < r.eqT.length && r.eqT[i1 + 1] < to) i1++;
  const start = i0 > 0 ? r.eqV[i0 - 1] : B; let peak = start, dd = 0;
  for (let i = i0; i <= i1; i++) { peak = Math.max(peak, r.eqV[i]); dd = Math.max(dd, (peak - r.eqV[i]) / B); }
  const ret = (r.eqV[i1] - start) / B * 100, days = Math.max(1, (r.eqT[i1] - r.eqT[Math.max(0, i0 - 1)]) / 864e5);
  const ds = r.deals.filter(d => d.out >= from && d.out < to), n = ds.length, sum = (f) => ds.reduce((a, d) => a + f(d), 0);
  return { n, win: n ? round(ds.filter(d => d.pnl > 0).length / n * 100, 1) : null, ret: round(ret, 2), annual: round(ret * 365 / days, 1), dd: round(dd * 100, 2),
    calmar: round(ret / Math.max(dd * 100, 0.5), 2), avgPct: n ? round(sum(d => d.pct) / n, 3) : null, worst: n ? round(Math.min(...ds.map(d => d.pct)), 2) : null,
    exits: ds.filter(d => d.why === 'exit').length, avgHours: n ? round(sum(d => d.h) / n, 1) : null, avgDips: n ? round(sum(d => d.k) / n, 2) : null, days: Math.round(days) };
}
const iso = (ms) => new Date(ms).toISOString();
export async function trainMarket(market) {
  const P = await prep(market);
  if (!P.syms.length || P.T.length < 400) throw new Error(`not enough hourly history for ${market}`);
  const t0 = P.T[0], t1 = P.T.at(-1) + 1, split = t0 + (t1 - t0) * 2 / 3;
  const rows = combos(GRIDS[market]).map(S => { const r = simulate(P, S); return { S, r, all: metrics(r, P.budget, t0, t1), a: metrics(r, P.budget, t0, split), b: metrics(r, P.budget, split, t1) }; });
  const better = (key) => (best, v) => !best || v[key].calmar > best[key].calmar || (v[key].calmar === best[key].calmar && (v[key].win || 0) > (best[key].win || 0)) ? v : best;
  const okAll = rows.filter(v => v.all.n >= DCA.minDeals && v.all.ret > 0);
  const best = (okAll.length ? okAll : rows).reduce(better('all'), null);
  const okA = rows.filter(v => v.a.n >= DCA.minDeals * 2 / 3 && v.a.ret > 0);
  const wf = (okA.length ? okA : rows).reduce(better('a'), null); // walk-forward: picked on the first 2/3, judged on the last 1/3
  const cl = simulate(P, CLASSIC[market]);
  const B = P.budget, step = Math.max(1, Math.ceil(best.r.eqT.length / 250));
  return {
    market, from: iso(t0), to: iso(t1), syms: P.syms, meme: P.syms.filter(isMeme), caps: P.caps, budget: B, maxDeals: P.maxDeals, perDeal: B / P.maxDeals, tested: rows.length,
    // v0.12.1 (audit fix): "proven" needs the honest check too. The same picking rule, applied to the first 2/3 only, must have made money
    // on the last 1/3 it never saw (with DCA.minTest+ closed deals there). Otherwise the bot runs half the deals.
    // v0.12.2: never "proven" while older price history is still downloading (the test would be on a shorter period than it says).
    proven: P.histComplete && okAll.length > 0 && wf.b.ret > 0 && wf.b.n >= DCA.minTest, provenWhy: !P.histComplete ? `older price history is still downloading (${P.coverage.filter(c => c.complete).length} of ${P.coverage.length} coins have the full ${DCA.trainDays} days; a few daily runs)` : !okAll.length ? `no setting made money over ${DCA.minDeals}+ deals` : wf.b.n < DCA.minTest ? `only ${wf.b.n} deals in the unseen third (needs ${DCA.minTest})` : wf.b.ret > 0 ? 'the setting picked on the first 2/3 also made money on the unseen last 1/3' : `the setting picked on the first 2/3 lost ${Math.abs(wf.b.ret)}% on the unseen last 1/3`,
    coverage: P.coverage, histComplete: P.histComplete, hist: P.hist, ambiguous: best.r.ambiguous,
    chosen: { S: best.S, text: describe(best.S), ...best.all, openAtEnd: best.r.openAtEnd },
    walk: { S: wf.S, text: describe(wf.S), split: iso(split), train: wf.a, test: wf.b },
    classic: { S: CLASSIC[market], text: describe(CLASSIC[market]), ...metrics(cl, B, t0, t1), openAtEnd: cl.openAtEnd },
    hold: P.hold == null ? null : round(P.hold, 1),
    top: [...rows].sort((a, z) => z.all.calmar - a.all.calmar).slice(0, 12).map(v => ({ S: v.S, ...v.all })),
    curve: best.r.eqT.filter((_, i) => i % step === 0).map((t, j) => [iso(t).slice(0, 10), round((best.r.eqV[j * step] - B) / B * 100, 2)]),
    recent: best.r.deals.slice(-15).reverse().map(d => ({ s: d.s, in: iso(d.in), out: iso(d.out), pct: round(d.pct, 2), pnl: round(d.pnl, 2), dips: d.k, why: d.why, hours: round(d.h, 1) })),
    assumptions: `Hourly bars, ${DCA.trainDays} days. Orders change only at the bot's scheduled runs; resting dip buys and the take profit fill when a bar trades through them; ${(DCA[market].fee * 100).toFixed(2)}% cost per fill. ${market === 'etf' ? 'ETF orders are day orders (fractional shares), so nothing rests overnight. ' : ''}Up to ${P.maxDeals} deals at once${P.caps?.meme ? ` (at most ${P.caps.meme} in meme coins, which get their own slots)` : ''}, $${Math.round(B / P.maxDeals).toLocaleString('en-US')} per deal. Settings are picked on this same history, so the walk-forward row is the honest check.`,
  };
}
const KEY = 'dca/train-v6.json'; let mem = null, inflight = null; // v6 (v0.13.1) = 3 dip buys, 15% first buy, 0.5% net minimum (v5: 4-6 dip buys; v4 had ~3 weeks of crypto history)
const fresh = (j) => j?.at && Date.now() - Date.parse(j.at) < 20 * 36e5;
// Training is cached for ~20 hours (Vercel Blob) so bot runs and page views stay fast.
export async function dcaTraining({ cacheOnly = false, force = false } = {}) {
  if (!force && fresh(mem)) return mem;
  if (!force) { const c = await blobReadJson(KEY).catch(() => null); if (fresh(c) || (cacheOnly && c)) return (mem = c); if (cacheOnly) return null; }
  inflight ||= (async () => { // one training at a time per instance
    const [crypto, etf] = await Promise.all(['crypto', 'etf'].map(m => trainMarket(m).catch(e => ({ market: m, error: e.message }))));
    const out = { at: new Date().toISOString(), budget: dcaBudget(), split: DCA.split, crypto, etf };
    if (!crypto.error || !etf.error) await blobWriteJson(KEY, out, 3600).catch(() => null);
    return (mem = out);
  })().finally(() => { inflight = null; });
  return inflight;
}
export const trainingSummary = (T) => T ? Object.fromEntries(['crypto', 'etf'].map(m => { const t = T[m]; return [m, !t || t.error ? { error: t?.error || 'not trained yet' } :
  { S: t.chosen.S, text: t.chosen.text, proven: t.proven, ret: t.chosen.ret, annual: t.chosen.annual, dd: t.chosen.dd, win: t.chosen.win, n: t.chosen.n, test: t.walk.test?.ret ?? null, days: t.chosen.days }]; }).concat([['at', T.at]])) : null;

// ---------------- live deals (rebuilt from positions + order ids every run) ----------------
const RE = /^tbdca-(\d{10})-([A-Z0-9]+)-(b|s\d+|tp|ts|hx)-u([\d.]+)-b([\d.e-]+)-n(\d+)-d([\d.]+)-k([\d.]+)-v([\d.]+)-t([\d.]+)-x([\d.]+)-f([atd])(?:-r([\d.]+))?(?:-p([\d.]+))?/;
export function parseDca(coid) { const m = RE.exec(coid || ''); return m ? { deal: m[1], f: m[2], kind: m[3], u: +m[4], b: +m[5], S: { n: +m[6], d: +m[7], k: +m[8], v: +m[9], tp: +m[10], x: +m[11], f: m[12], tr: +(m[13] || 0), ...(m[14] ? { p: +m[14] } : {}) } } : null; }
let seq = 0;
const makeId = (deal, sym, kind, u, b, S, jt = '') => `tbdca-${deal}-${flat(sym)}-${kind}-u${(+u).toFixed(2)}-b${+(+b).toPrecision(8)}-n${S.n}-d${S.d}-k${S.k}-v${S.v}-t${S.tp}-x${S.x}-f${S.f}${S.tr ? `-r${S.tr}` : ''}${S.p ? `-p${S.p}` : ''}${jt}-z${(Date.now() % 1e8).toString(36)}${(seq++ % 36).toString(36)}`;
const isDca = (o) => (o?.client_order_id || '').startsWith('tbdca-');
// Which bot owns a symbol: the one whose order bought it most recently (orders newest first). null = nobody in the window.
export const lastBuyOf = (orders, sym) => orders.find(o => o.side === 'buy' && +o.filled_qty > 0 && flat(o.symbol) === flat(sym)) || null;

export function dcaDeals({ positions, openAll, recent }) {
  const deals = [], busy = new Set(), leftovers = [];
  for (const market of ['crypto', 'etf']) for (const sym of market === 'crypto' ? allCrypto() : DCA[market].syms) { // every coin a deal could be in, so a coin the lab drops is still managed
    const f = flat(sym), pos = realPositions(positions).find(p => flat(p.symbol) === f && +p.qty > 0); // dust under $1 = closed deal
    const mineOpen = openAll.filter(o => flat(o.symbol) === f && isDca(o)), other = openAll.filter(o => flat(o.symbol) === f && !isDca(o));
    const lb = lastBuyOf(recent, sym), owned = lb ? isDca(lb) : mineOpen.length > 0;
    if (other.length) busy.add(f); // another bot (or you) has orders on it
    if (pos && !owned) { busy.add(f); continue; } // held by the swing bot or by you: never touched
    if (!pos) { if (mineOpen.length) leftovers.push({ market, sym, orders: mineOpen }); continue; }
    const mine = [...mineOpen, ...recent.filter(o => flat(o.symbol) === f && isDca(o))];
    const ref = mine.map(o => parseDca(o.client_order_id)).find(Boolean); if (!ref) { busy.add(f); continue; }
    const seen = new Set(), dealOrders = mine.filter(o => (o.client_order_id || '').startsWith(`tbdca-${ref.deal}-`) && !seen.has(o.id) && seen.add(o.id));
    const filled = new Set(dealOrders.filter(o => o.side === 'buy' && +o.filled_qty > 0).map(o => parseDca(o.client_order_id)?.kind).filter(k => /^s\d+$/.test(k || '')).map(k => +k.slice(1)));
    const k = filled.size ? Math.max(...filled) : 0, lv = ladder(ref.S, ref.b, ref.u);
    const openBuy = (j) => mineOpen.find(o => o.side === 'buy' && parseDca(o.client_order_id)?.kind === 's' + j) || null;
    const qty = +pos.qty, avg = +pos.avg_entry_price, px = +pos.current_price;
    const base = dealOrders.filter(o => parseDca(o.client_order_id)?.kind === 'b').at(-1);
    deals.push({ market, sym, f, P: ref, deal: ref.deal, pos, qty, avg, px, k, lv: lv.map(L => ({ ...L, filled: filled.has(L.j), order: openBuy(L.j) })),
      tpOrder: mineOpen.find(o => o.side === 'sell' && o.type === 'limit') || null, tsOrder: mineOpen.find(o => o.side === 'sell' && (o.type === 'stop_limit' || o.type === 'stop')) || null, mineOpen, dealOrders, exitPx: exitPxOf(ref.S, lv),
      lastFill: dealOrders.filter(o => o.side === 'buy' && +o.filled_qty > 0 && o.filled_at).map(o => o.filled_at).sort().at(-1) || null,
      invested: qty * avg, reserved: dealSize(ref.S, ref.u), pl: +pos.unrealized_pl, started: base?.filled_at || base?.submitted_at || null });
  }
  return { deals, busy, leftovers };
}
// Part of the DCA budget not yet in use; the swing bots leave it free so the DCA bot can always open its deals.
export function dcaSpare(ctx) {
  const { deals } = dcaDeals(ctx);
  const used = deals.reduce((a, d) => a + d.invested, 0) + ctx.openAll.filter(o => isDca(o) && o.side === 'buy').reduce((a, o) => a + (+o.qty || 0) * (+o.limit_price || 0) + (+o.notional || 0), 0);
  return Math.max(0, dcaBudget() - used);
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const px2 = (v) => (+v).toFixed(v >= 1 ? 2 : 4);
// gate (v0.20.0, audit #6): { allowNew, paused } from the safety ladder. New dip buys are buys: they wait while new trades are
// blocked, and a pause (level 4) also cancels the dip buys already resting, so only take profits and exits keep working.
async function manage(D, out, dry, gate = { allowNew: true, paused: false }) {
  const { P, sym, market } = D, crypto = market === 'crypto', S = P.S, tag = crypto ? 'gtc' : 'day';
  const ai = crypto ? await assetInfo(sym) : null;
  const pxF = (v) => crypto ? pxText(v, ai.pxInc) : px2(v), qF = (v) => crypto ? fmt(v, ai.qtyInc) : (Math.floor(v * 1e4) / 1e4).toFixed(4);
  // v0.13.1: lowest sell price that nets DCA.minNetPct % after costs (buy cost counted with the fee on top, to be safe)
  const fee = DCA[market].fee; D.minPx = minExitPx(D.qty, D.qty * D.avg * (1 + fee), fee);
  // 1) hard exit (a stop: it can close at a loss, the minimum profit does not apply)
  if (D.exitPx && D.px <= D.exitPx) {
    const why = `hard exit: price ${pxF(D.px)} fell ${S.x}% below the last dip buy (${pxF(D.lv.at(-1).px)})`;
    if (dry) { out.exits.push({ s: sym, why, preview: true, pnl: round(D.pl) }); return; }
    try {
      for (const o of D.mineOpen) await pdel('/v2/orders/' + o.id).catch(() => null);
      if (D.mineOpen.length) await wait(900);
      const fr = await pget('/v2/positions/' + flat(sym)).catch(() => D.pos);
      await ppostSure('/v2/orders', { symbol: sym, side: 'sell', type: 'market', qty: String(+fr.qty_available || +fr.qty), time_in_force: tag, client_order_id: makeId(D.deal, sym, 'hx', P.u, P.b, S) })
        .catch((e) => timedOut(e) ? null : pdel('/v2/positions/' + flat(sym))); // v0.20.0: a timed-out sell may have gone through
      out.exits.push({ s: sym, why, pnl: round(D.pl) });
    } catch (e) { out.exits.push({ s: sym, why: 'hard exit failed: ' + e.message, error: true }); }
    return;
  }
  // 2) dip buys: keep the next few levels resting
  const next = D.lv.filter(L => L.j > D.k && !L.filled).slice(0, DCA[market].active);
  const resting = D.lv.filter(L => L.order);
  if (gate.paused && resting.length) {
    if (dry) out.actions.push({ s: sym, why: `would cancel ${resting.length} resting dip buy(s): bots are paused`, preview: true });
    else { for (const L of resting) await pdel('/v2/orders/' + L.order.id).catch(() => null); out.actions.push({ s: sym, why: `canceled ${resting.length} resting dip buy(s): bots are paused (they go back in after you resume)` }); }
  }
  if (gate.allowNew === false) { if (next.some(L => !L.order)) out.actions.push({ s: sym, why: 'no new dip buys while new trades are blocked; take profit and exits still run' }); }
  else for (const L of next) {
    if (L.order) continue;
    const q = crypto ? floorTo(L.usd / L.px, ai.qtyInc) : L.usd / L.px;
    if (crypto && (q < ai.minQty || q * L.px < 1)) { out.actions.push({ s: sym, why: `dip buy #${L.j} is below the coin's minimum order size` }); continue; }
    const text = `dip buy #${L.j}: ${qF(q)} @ ${pxF(L.px)} (−${L.dev}% from the start, $${Math.round(L.usd)})`;
    if (dry) { out.actions.push({ s: sym, why: 'would rest ' + text, preview: true }); continue; }
    if (await recentlyOrdered(sym, `tbdca-${D.deal}-${flat(sym)}-s${L.j}-`, 30).catch(() => true)) { out.actions.push({ s: sym, why: `dip buy #${L.j}: another bot run just placed it (or Alpaca did not answer the check), left as is` }); continue; } // v0.20.0 (audit #4)
    await ppost('/v2/orders', { symbol: sym, side: 'buy', type: 'limit', qty: qF(q), limit_price: pxF(L.px), time_in_force: tag, client_order_id: makeId(D.deal, sym, 's' + L.j, P.u, P.b, S) })
      .then(() => out.actions.push({ s: sym, why: 'resting ' + text })).catch(e => out.actions.push({ s: sym, why: `dip buy #${L.j} failed: ${e.message}`, error: true }));
  }
  // 3a) trailing take profit (crypto deals trained with r > 0, or any crypto deal while bull-run mode widens the trail: D.tb)
  const trE = crypto ? Math.max(S.tr, D.tb || 0) : 0;
  if (trE > 0) return trail(D, out, dry, { ai, pxF, tag, S: { ...S, tr: trE } });
  // 3) take profit on the whole position at +tp% over the average price
  const tpPct = D.avg * (1 + S.tp / 100), tp = Math.max(tpPct, D.minPx), o = D.tpOrder;
  if (!(tp > 0)) { out.actions.push({ s: sym, why: 'take profit skipped: no average price yet (next run retries)', error: true }); return; }
  if (o && Math.abs(+o.limit_price / tp - 1) < 0.0015 && Math.abs(+o.qty - D.qty) <= D.qty * 0.001) return;
  const text = `take profit ${pxF(tp)} (${tp > tpPct ? `raised from +${S.tp}% so the sale nets at least ${DCA.minNetPct}% after costs` : `+${S.tp}%`} over avg ${pxF(D.avg)})`;
  if (dry) { out.actions.push({ s: sym, why: (o ? 'would move ' : 'would place ') + text, preview: true }); return; }
  try {
    if (o) { await pdel('/v2/orders/' + o.id).catch(() => null); await wait(900); }
    const fr = await pget('/v2/positions/' + flat(sym)).catch(() => D.pos);
    const q = +fr.qty_available || +fr.qty, whole = !crypto && Number.isInteger(q);
    await ppost('/v2/orders', { symbol: sym, side: 'sell', type: 'limit', qty: crypto ? fmt(q, ai.qtyInc) : String(q), limit_price: pxF(tp), time_in_force: whole ? 'gtc' : tag, client_order_id: makeId(D.deal, sym, 'tp', P.u, P.b, S) });
    out.actions.push({ s: sym, why: (o ? 'moved ' : 'placed ') + text });
  } catch (e) { out.actions.push({ s: sym, why: 'take profit failed: ' + e.message, error: true }); }
}

// Trailing take profit: nothing rests until price has reached +tp% over the average (since the last buy). Then a stop-limit
// sell sits tr% under the best price seen, raised each run, never below +tp/2%. If price already fell back under that level
// at run time: sell at market while still >= +tp/2%, otherwise rest a plain limit sell at +tp/2% and wait for a bounce.
export function trailPlan(avg, S, peak, px, minPx = 0) { // minPx (v0.13.1): nothing is sold under the minimum-profit price
  const act = Math.max(avg * (1 + S.tp / 100), minPx), minF = Math.max(avg * (1 + S.tp / 200), minPx), top = Math.max(peak || 0, px), on = top >= act;
  const floor = on ? Math.max(top * (1 - S.tr / 100), minF) : null;
  const want = !on ? null : px > floor ? { type: 'stop', px: floor } : px >= minF ? { type: 'market' } : { type: 'limit', px: minF };
  return { act, minF, peak: top, on, floor, want };
}
async function trail(D, out, dry, { ai, pxF, tag, S = D.P.S }) {
  const { P, sym } = D, T = trailPlan(D.avg, S, D.peak, D.px, D.minPx || 0), ts = D.tsOrder, lo = D.tpOrder, q0 = D.qty;
  const same = (o) => o && Math.abs(+o.qty - q0) <= q0 * 0.001;
  if (!T.want) {
    if (!ts && !lo) return; // waiting for +tp%: nothing to rest
  } else if (T.want.type === 'stop' && same(ts) && !lo && +ts.stop_price >= T.floor * 0.9985) return; // floor only moves up
  else if (T.want.type === 'limit' && same(lo) && !ts && Math.abs(+lo.limit_price / T.minF - 1) < 0.0015) return;
  const text = !T.want ? `trailing take profit waits for ${pxF(T.act)} (+${S.tp}% over avg ${pxF(D.avg)})`
    : T.want.type === 'stop' ? `trailing take profit: sell stop ${pxF(T.floor)} (${S.tr}% under the best price ${pxF(T.peak)}, never under ${pxF(T.minF)})`
    : T.want.type === 'market' ? `trailing take profit hit: price ${pxF(D.px)} fell under the trail ${pxF(T.floor)}, still ≥ ${pxF(T.minF)}: selling at market`
    : `price fell back under ${pxF(T.minF)} after reaching ${pxF(T.act)}: limit sell rests at ${pxF(T.minF)} for a bounce`;
  if (dry) { out.actions.push({ s: sym, why: 'would set ' + text, preview: true }); return; }
  try {
    for (const o of [ts, lo].filter(Boolean)) await pdel('/v2/orders/' + o.id).catch(() => null);
    if (ts || lo) await wait(900);
    if (!T.want) { out.actions.push({ s: sym, why: text }); return; }
    const fr = await pget('/v2/positions/' + flat(sym)).catch(() => D.pos), q = fmt(+fr.qty_available || +fr.qty, ai.qtyInc);
    const id = (k) => makeId(D.deal, sym, k, P.u, P.b, P.S); // ids keep the deal's own settings (bull mode is not stored in them)
    if (T.want.type === 'stop') await ppost('/v2/orders', { symbol: sym, side: 'sell', type: 'stop_limit', qty: q, stop_price: pxF(T.floor), limit_price: pxF(Math.max(T.floor * 0.99, T.minF)), time_in_force: 'gtc', client_order_id: id('ts') });
    else if (T.want.type === 'market') await ppost('/v2/orders', { symbol: sym, side: 'sell', type: 'market', qty: q, time_in_force: 'gtc', client_order_id: id('tp') });
    else await ppost('/v2/orders', { symbol: sym, side: 'sell', type: 'limit', qty: q, limit_price: pxF(T.minF), time_in_force: 'gtc', client_order_id: id('tp') });
    out.actions.push({ s: sym, why: text });
  } catch (e) { out.actions.push({ s: sym, why: 'trailing take profit failed: ' + e.message, error: true }); }
}
// Best price since each trailing deal's last buy (hourly bars after the fill + the live price).
async function peaksOf(deals) {
  const tr = deals.filter(d => d.market === 'crypto' && Math.max(d.P.S.tr, d.tb || 0) > 0 && d.lastFill); if (!tr.length) return;
  const start = tr.map(d => d.lastFill).sort()[0];
  const b = await bars([...new Set(tr.map(d => d.sym))], { timeframe: '1Hour', start }).catch(() => ({}));
  for (const d of tr) { const t0 = Date.parse(d.lastFill); d.peak = Math.max(d.px, ...(b[d.sym] || []).filter(x => Date.parse(x.t) >= t0).map(x => x.h)); }
}

async function startData(market, syms) {
  const crypto = market === 'crypto', [d, h] = await Promise.all([bars(syms, { timeframe: '1Day', days: 330 }), bars(syms, { timeframe: '1Hour', days: crypto ? 4 : 8 })]);
  const today = crypto ? new Date().toISOString().slice(0, 10) : et(Date.now()).day, out = {};
  for (const s of syms) {
    const D = (d[s] || []).filter(x => String(x.t).slice(0, 10) < today), c = D.map(x => x.c);
    const trend = c.length >= 200 ? c.at(-1) > c.slice(-200).reduce((a, v) => a + v, 0) / 200 : false;
    let hb = h[s] || []; if (!crypto) hb = hb.filter(x => { const e = et(x.t); return e.hour >= 9 && e.hour <= 15; });
    hb = hb.filter(x => Date.parse(x.t) + 36e5 <= Date.now()); // completed hours only
    out[s] = { chart: chartState(D), trend, rsi: hb.length > 15 ? round(rsiLast(hb.map(x => x.c)), 1) : null, sma200: c.length >= 200 ? round(c.slice(-200).reduce((a, v) => a + v, 0) / 200, 4) : null };
  }
  return out;
}

// ---------------- bull-run mode (v0.11.0) ----------------
let REG = null;
export async function btcRegime() {
  if (REG && Date.now() - REG.t < 36e5) return REG.v;
  const d = await bars(['BTC/USD'], { timeframe: '1Day', days: 330 }).catch(() => ({})), today = new Date().toISOString().slice(0, 10);
  const L = bullMap((d['BTC/USD'] || []).filter(x => String(x.t).slice(0, 10) < today)).at(-1); // completed days only
  const v = L ? { on: L[1], day: L[0], px: L[2], sma50: L[3], sma200: L[4] } : { on: false, error: 'no BTC daily history' };
  REG = { t: Date.now(), v }; return v;
}
// Bull-run mode right now: the lab's settings (only when they beat normal deals on data the lab never tuned on) + today's BTC regime.
export async function bullState() {
  const L = await labLatest(), cfg = L?.bull?.use ? L.bull.chosen : null, regime = await btcRegime();
  // v0.12.1 (audit fix): missing data is "unknown", never "BTC left its uptrend": the core is kept as is and nothing new is bought.
  const unknown = regime.error ? regime.error : !L && labError() ? `the lab result could not be read (${labError()})` : null;
  if (unknown) return { use: !!cfg, on: false, unknown, share: 0, tb: 0, cfg, regime, why: `bull-run state unknown (${unknown}): core holdings kept, no new core buys, normal deals` };
  const on = !!cfg && !!regime.on;
  const why = !L ? 'no recent DCA lab run (it runs weekly): bull-run mode off' : !cfg ? 'the DCA lab found bull-run mode did not beat normal deals on data it never saw: off'
    : regime.on ? `BTC is in an uptrend (close ${regime.px} over its 200-day ${regime.sma200}, 50-day over 200-day)` : `BTC is not in an uptrend (close ${regime.px}, 200-day ${regime.sma200}): normal deals only`;
  return { use: !!cfg, on, share: on ? cfg.share || 0 : 0, tb: on ? cfg.tb || 0 : 0, cfg, regime, why };
}
const isCore = (o) => (o?.client_order_id || '').startsWith('tbhodl-');
let hseq = 0;
const coreId = (sym, k) => `tbhodl-${new Date().toISOString().replace(/\D/g, '').slice(2, 12)}-${flat(sym)}-${k}-z${(Date.now() % 1e8).toString(36)}${(hseq++ % 36).toString(36)}`;
// Core holdings: BTC/ETH positions whose most recent buy was a core order (looked up per coin, so a months-old hold is still found).
// Bull on: top each core coin up to its share, never touching a coin a deal or another bot holds, never using money open deals set
// aside. Bull off (or bull mode switched off by the lab): sell them. Returns the coins new DCA deals must leave alone.
async function runCore(ctx, B, dcaReserved, out, dry) {
  const coins = DCA.crypto.core, budget = budgetOf('crypto'), target = B.on ? budget * B.share / coins.length : 0;
  const hist = await pget('/v2/orders?' + new URLSearchParams({ status: 'all', limit: '200', direction: 'desc', symbols: coins.join(',') })).catch(() => []);
  const last = (s) => lastBuyOf([...(Array.isArray(hist) ? hist : []), ...ctx.recent].sort((a, z) => String(z.filled_at || z.submitted_at).localeCompare(String(a.filled_at || a.submitted_at))), s);
  const pos = (s) => realPositions(ctx.positions).find(p => flat(p.symbol) === flat(s) && +p.qty > 0);
  const held = coins.map(s => ({ s, p: pos(s) })).filter(h => h.p && isCore(last(h.s)));
  const heldUsd = held.reduce((a, h) => a + (+h.p.market_value || +h.p.qty * +h.p.current_price || 0), 0);
  const C = out.core = { use: B.use, on: B.on, share: B.share, tb: B.tb, why: B.why, regime: B.regime, target: round(target),
    holdings: held.map(h => ({ s: h.s, qty: +h.p.qty, usd: round(+h.p.market_value), pl: round(+h.p.unrealized_pl) })), actions: [] };
  if (B.unknown) { if (held.length) C.actions.push({ why: `kept ${held.map(h => h.s).join(', ')}: ${B.why}` }); return new Set(held.map(h => flat(h.s))); } // no new deals in coins the core holds
  if (!B.on) {
    for (const h of held) {
      const why = `bull-run core: ${B.use ? 'BTC left its uptrend' : 'bull-run mode is off'}, selling ${h.s} ($${Math.round(+h.p.market_value)}, P&L $${round(+h.p.unrealized_pl)})`;
      if (dry) { C.actions.push({ s: h.s, why: 'would sell: ' + why, preview: true }); continue; }
      for (const o of ctx.openAll.filter(o => flat(o.symbol) === flat(h.s) && isCore(o))) await pdel('/v2/orders/' + o.id).catch(() => null);
      const ai = await assetInfo(h.s);
      await ppost('/v2/orders', { symbol: h.s, side: 'sell', type: 'market', qty: fmt(+h.p.qty_available || +h.p.qty, ai.qtyInc), time_in_force: 'gtc', client_order_id: coreId(h.s, 'x') })
        .then(() => C.actions.push({ s: h.s, why })).catch(e => C.actions.push({ s: h.s, why: 'core sell failed: ' + e.message, error: true }));
    }
    return new Set(held.map(h => flat(h.s))); // being sold this run: no new deal there yet
  }
  const busyCoins = new Set(coins.map(flat));
  if (ctx.allowNew === false) { C.actions.push({ s: '', why: 'core buys paused: ' + (ctx.blockReason || 'new trades are blocked') }); return busyCoins; }
  let room = Math.max(0, budget - dcaReserved - heldUsd); const sn = await snapshots(coins).catch(() => ({}));
  for (const s of coins) {
    const p = pos(s), mine = p && isCore(last(s));
    if (p && !mine) { C.actions.push({ s, why: `core waits: ${s} is in a DCA deal (or held by another bot) until that closes` }); continue; }
    if (ctx.openAll.some(o => flat(o.symbol) === flat(s) && !isCore(o))) { C.actions.push({ s, why: `core waits: another bot has open orders on ${s}` }); continue; }
    const have = p ? +p.market_value || +p.qty * +p.current_price || 0 : 0, gap = target - have;
    if (gap < Math.max(25, target * 0.1)) continue; // within 10% of its share: hold
    const want = Math.min(gap, room);
    if (want < 25) { C.actions.push({ s, why: `core buy of ${s} waits: open DCA deals have the budget set aside ($${Math.round(room)} free)` }); continue; }
    const q = quoteOf(s, sn[s]), px = q?.ask || q?.p; if (!px) { C.actions.push({ s, why: 'core: no live quote', error: true }); continue; }
    const ai = await assetInfo(s), qty = floorTo(want / px, ai.qtyInc);
    if (!(qty > 0) || qty < ai.minQty) continue;
    const why = `bull-run core: buying $${Math.round(want)} of ${s} (${Math.round(B.share * 100)}% of the crypto budget over ${coins.length} coins, held until BTC leaves its uptrend)`;
    if (dry) { C.actions.push({ s, why: 'would start ' + why, preview: true }); room -= want; continue; }
    if (await recentlyOrdered(s, new RegExp(`^tbhodl-\\d+-${flat(s)}-b-`)).catch(() => true)) { C.actions.push({ s, why: 'core buy: another bot run just placed one (or Alpaca did not answer the check), so this run stood down' }); continue; } // v0.20.0 (audit #4)
    await ppost('/v2/orders', { symbol: s, side: 'buy', type: 'market', qty: fmt(qty, ai.qtyInc), time_in_force: 'gtc', client_order_id: coreId(s, 'b') })
      .then(() => { C.actions.push({ s, why }); room -= want; }).catch(e => C.actions.push({ s, why: 'core buy failed: ' + e.message, error: true }));
  }
  return busyCoins;
}
// What the AI filter sees for a new DCA deal (numbers only). In gate mode it can only skip a deal, never resize the ladder.
const dcaState = (market, c, px, S) => ({ asset: market === 'crypto' ? 'crypto' : 'etf', strategy: 'dca_ladder', hourly_rsi14: c.rsi, above_200d: !!c.trend,
  pct_from_200d: c.sma200 ? round((px / c.sma200 - 1) * 100, 2) : null, take_profit_pct: S.tp, dip_buys: S.n, deepest_dip_pct: ladder(S, 100, 1).at(-1).dev, hard_exit_below_last_dip_pct: S.x, chart: c.chart || {},
  ...(market === 'crypto' ? { perp_funding_pct_per_year: c.fund ?? null, money_conditions: c.liq ?? null } : {}) });
// ctx: { dry, positions, openAll, recent, clock, taken (coins the swing bot bought this run), allowNew, paused (level 4: also cancel resting dip buys), blockReason, judge }
export async function runDca(ctx) {
  const { dry, clock } = ctx;
  const out = { budget: dcaBudget(), split: DCA.split, training: null, started: [], actions: [], exits: [], skipped: [], deals: [], notes: [] };
  const T = await dcaTraining().catch(e => ({ error: e.message }));
  out.training = T.error ? { error: T.error } : trainingSummary(T);
  const { deals, busy, leftovers } = dcaDeals(ctx);
  const B = (ctx.markets || ['crypto', 'etf']).includes('crypto') ? await bullState().catch(e => ({ use: false, on: false, unknown: 'check failed: ' + e.message, share: 0, tb: 0, why: 'bull-run check failed (' + e.message + '): core holdings kept, no new core buys' })) : null;
  for (const d of deals) if (d.market === 'crypto') d.tb = B?.tb || 0; // bull-run mode: wider trailing take profit on crypto deals
  await peaksOf(deals).catch(() => null);
  for (const market of ctx.markets || ['crypto', 'etf']) {
    const live = market === 'crypto' || clock?.is_open;
    const mine = deals.filter(d => d.market === market);
    if (!live) { if (mine.length) out.notes.push(`ETF deals wait for the market to open (${mine.length} open).`); continue; }
    for (const D of mine) await manage(D, out, dry, { allowNew: ctx.allowNew !== false, paused: !!ctx.paused }).catch(e => out.actions.push({ s: D.sym, why: 'manage failed: ' + e.message, error: true }));
    for (const L of leftovers.filter(x => x.market === market)) { // deal closed (take profit filled): cancel its leftover dip buys
      if (dry) { out.actions.push({ s: L.sym, why: `would cancel ${L.orders.length} leftover order(s) from a closed deal`, preview: true }); continue; }
      for (const o of L.orders) await pdel('/v2/orders/' + o.id).catch(() => null);
      out.actions.push({ s: L.sym, why: `deal closed: canceled ${L.orders.length} leftover order(s)` });
    }
    let coreTaken = new Set();
    if (market === 'crypto' && B) coreTaken = await runCore(ctx, B, mine.reduce((a, d) => a + d.reserved, 0), out, dry).catch(e => { out.core = { error: e.message }; return new Set(B.on ? DCA.crypto.core.map(flat) : []); });
    if (market === 'crypto' && B) { out.notes.push(`Bull-run mode: ${B.why}.`); out.actions.push(...(out.core?.actions || []).filter(a => a.s)); }
    // ---- new deals ----
    if (ctx.allowNew === false) { out.notes.push(`${market === 'crypto' ? 'Crypto' : 'ETF'}: no new deals. ${ctx.blockReason || 'Paused.'}`); continue; }
    const tr = T?.[market];
    if (!tr || tr.error) { out.notes.push(`${market === 'crypto' ? 'Crypto' : 'ETF'} DCA training failed this run, so no new deals: ${tr?.error || T?.error}`); continue; }
    const S = withP(tr.chosen.S), C = DCA[market], avail = await tradableSyms(market), cap = capsOf(market, avail, tr.proven), maxDeals = cap.max;
    if (!tr.proven) out.notes.push(`${market === 'crypto' ? 'Crypto' : 'ETF'}: settings not proven (${tr.provenWhy || `no setting was profitable over ${DCA.minDeals}+ historical deals`}), so the bot runs at most ${maxDeals} deal${maxDeals === 1 ? '' : 's'} at a time until they are.`);
    const left = { reg: cap.reg - mine.filter(d => !isMeme(d.sym)).length, meme: cap.meme - mine.filter(d => isMeme(d.sym)).length };
    let slots = Math.min(maxDeals - mine.length, Math.max(0, left.reg) + Math.max(0, left.meme)); if (slots <= 0) continue;
    const dealBudget = budgetOf(market) * (market === 'crypto' && B?.on ? 1 - B.share : 1); // bull-run core takes its share first
    const reserved = mine.reduce((a, d) => a + d.reserved, 0), per = dealBudget / dealSlots(market), u = firstBuy(S, per); // v0.13.1: first buy = DCA.firstPct of the deal
    if (reserved + per > dealBudget + 1) { out.notes.push(`${market}: budget fully reserved by open deals.`); continue; }
    const gOf = (s) => isMeme(s) ? 'meme' : 'reg';
    const free = avail.filter(s => left[gOf(s)] > 0 && !busy.has(flat(s)) && !deals.some(d => d.f === flat(s)) && !leftovers.some(l => flat(l.sym) === flat(s)) && !ctx.positions.some(p => flat(p.symbol) === flat(s)) && !ctx.taken?.has(flat(s)) && !coreTaken.has(flat(s)));
    if (!free.length) continue;
    const sd = await startData(market, free).catch(() => ({}));
    const cands = free.map(s => ({ s, ...(sd[s] || {}) })).filter(c => {
      if (S.f !== 'a' && !c.trend) { out.skipped.push({ s: c.s, why: `below its 200-day average${c.sma200 ? ` (${c.sma200})` : ''}` }); return false; }
      if (S.f === 'd' && !(c.rsi != null && c.rsi < DCA.rsiDip)) { out.skipped.push({ s: c.s, why: `no dip yet (hourly RSI ${c.rsi ?? '—'}, needs under ${DCA.rsiDip})` }); return false; }
      return true;
    }).sort((a, z) => (a.rsi ?? 50) - (z.rsi ?? 50));
    if (!cands.length) continue;
    // v0.11.0 signals, shadow by default: perp funding per coin (Hyperliquid, no key) + money conditions (FRED); both go in the deal's order id
    const lm = market === 'crypto' ? levMode() : 'off';
    const [PS, LQ] = lm === 'off' ? [null, null] : await Promise.all([perpStats().catch(e => ({ __error: e.message })), liquidity().catch(e => ({ error: e.message }))]);
    if (lm !== 'off') { out.signals = { mode: lm, funding: PS?.__error ? { error: PS.__error } : { BTC: perpOf(PS, 'BTC/USD')?.apr ?? null, ETH: perpOf(PS, 'ETH/USD')?.apr ?? null }, liquidity: LQ };
      for (const c of cands) { c.fund = PS?.__error ? null : perpOf(PS, c.s)?.apr ?? null; c.liq = LQ?.state || null; } }
    const look = ['reg', 'meme'].flatMap(g => cands.filter(c => gOf(c.s) === g).slice(0, Math.max(0, left[g]) + 2)).sort((a, z) => (a.rsi ?? 50) - (z.rsi ?? 50)), sn = await snapshots(look.map(c => c.s));
    const pxOf = (s) => { const q = quoteOf(s, sn[s]); return q?.ask || q?.p || null; };
    const J = ctx.judge ? await ctx.judge(look.filter(c => pxOf(c.s)).map(c => ({ s: c.s, state: dcaState(market, c, pxOf(c.s), S) }))) : { mode: 'off', results: {}, failed: 0 };
    const jt = out.jev || { mode: J.mode, asked: 0, failed: 0 }; jt.asked += Object.keys(J.results).length; jt.failed += J.failed; out.jev = jt;
    for (const c of look) {
      if (slots <= 0) break; if (left[gOf(c.s)] <= 0) continue;
      const px = pxOf(c.s); if (!px) { out.skipped.push({ s: c.s, why: 'no live quote' }); continue; }
      const jr = J.results[c.s], v = verdict(jr, J.mode);
      if (v.act === 'skip') { out.skipped.push({ s: c.s, why: v.why }); continue; }
      const lb = levBucket(c.fund);
      if (lm === 'gate' && lb === '2') { out.skipped.push({ s: c.s, why: `perp funding ${c.fund}%/yr: longs very crowded (LEVERAGE_MODE=gate)` }); continue; }
      const deal = new Date().toISOString().replace(/\D/g, '').slice(2, 12), P = { deal, u, b: px, S }, sigTag = lm === 'off' ? '' : levTag(c.fund) + liqTag(LQ);
      const plan = { s: c.s, market, meme: isMeme(c.s), usd: round(u), px: round(px, px < 0.01 ? 10 : px < 1 ? 6 : 2), tp: S.tp, n: S.n, reserved: round(per), rsi: c.rsi, why: `${FILTERS[S.f]}${c.rsi != null ? ` · hourly RSI ${c.rsi}` : ''}${v.why ? ` · ${v.why}` : ''}${lb != null ? ` · perp funding ${c.fund}%/yr, ${LEV_TXT[lb]}` : ''}${c.liq ? ` · money conditions ${c.liq}` : ''}`,
        jev: jr && !jr.error ? jr : null, funding: c.fund ?? null, liquidity: c.liq ?? null };
      if (dry) { out.started.push({ ...plan, preview: true }); slots--; left[gOf(c.s)]--; continue; }
      try {
        if (await recentlyOrdered(c.s, new RegExp(`^tbdca-\\d{10}-${flat(c.s)}-b-`)).catch(() => true)) { out.skipped.push({ s: c.s, why: 'another bot run just started a deal here (or Alpaca did not answer the check)' }); continue; } // v0.20.0 (audit #4)
        const crypto = market === 'crypto', ai = crypto ? await assetInfo(c.s) : null;
        if (crypto && !ai.tradable) { out.skipped.push({ s: c.s, why: 'not tradable on Alpaca right now' }); continue; }
        const body = crypto ? { symbol: c.s, side: 'buy', type: 'market', qty: fmt(floorTo(u / px, ai.qtyInc), ai.qtyInc), time_in_force: 'gtc' } : { symbol: c.s, side: 'buy', type: 'market', notional: u.toFixed(2), time_in_force: 'day' };
        const o = await ppost('/v2/orders', { ...body, client_order_id: makeId(deal, c.s, 'b', u, px, S, jevTag(jr) + sigTag) }); slots--; left[gOf(c.s)]--;
        let f = o.status === 'filled' ? o : null;
        for (let i = 0; i < 6 && !f; i++) { await wait(600); const x = await pget('/v2/orders/' + o.id).catch(() => null); if (x?.status === 'filled') f = x; }
        let note = 'dip buys and take profit go in on the next run';
        if (f) {
          const pos = await pget('/v2/positions/' + flat(c.s)).catch(() => null);
          if (pos) {
            const lv = ladder(S, px, u), D = { market, sym: c.s, f: flat(c.s), P: { ...P, kind: 'b' }, deal, pos, qty: +pos.qty, avg: +pos.avg_entry_price || +f.filled_avg_price || px, px: +pos.current_price || px, k: 0,
              lv: lv.map(L => ({ ...L, filled: false, order: null })), tpOrder: null, tsOrder: null, mineOpen: [], exitPx: exitPxOf(S, lv), peak: +pos.current_price || px };
            const sub = { actions: [], exits: [] }; await manage(D, sub, false); out.actions.push(...sub.actions); note = 'dip buys and take profit placed';
          }
        }
        out.started.push({ ...plan, status: f ? 'filled' : o.status, fill: f ? +f.filled_avg_price : null, note });
      } catch (e) { out.skipped.push({ s: c.s, why: 'rejected: ' + e.message }); }
    }
  }
  out.deals = dcaDeals(ctx).deals.map(d => ({ s: d.sym, market: d.market, dips: d.k, n: d.P.S.n, avg: round(d.avg, Math.abs(d.avg) < 0.01 ? 12 : 6), px: d.px, pl: round(d.pl) })); // as of the start of this run
  return out;
}

// ---------------- live results by deal (Benchmark tab: swing vs DCA) ----------------
// v0.16.0: deals are scored after estimated costs (lib/fees.js); pnlGross keeps the raw fill result.
export function dcaLive(orders, positions, { charged = false } = {}) {
  const by = new Map();
  for (const o of orders) {
    const p = parseDca(o.client_order_id), q = +o.filled_qty || 0; if (!p || !q) continue;
    const key = p.deal + p.f, g = by.get(key) || { deal: p.deal, sym: o.symbol, f: p.f, market: marketOf(o.symbol), reserved: dealSize(p.S, p.u), S: p.S, bq: 0, bu: 0, sq: 0, su: 0, fee: 0, dips: new Set(), t0: null, t1: null, why: null, jev: null };
    if (p.kind === 'b' && g.jev == null) { g.jev = jevOf(o.client_order_id); g.jevFlag = jevFlagOf(o.client_order_id); g.lev = levOf(o.client_order_id); g.liq = liqOf(o.client_order_id); }
    const usd = q * +o.filled_avg_price; g.fee += usd * feeRate({ crypto: g.market === 'crypto', type: o.type, charged });
    if (o.side === 'buy') { g.bq += q; g.bu += usd; if (/^s\d+$/.test(p.kind)) g.dips.add(p.kind); if (!g.t0 || o.filled_at < g.t0) g.t0 = o.filled_at; }
    else { g.sq += q; g.su += usd; if (!g.t1 || o.filled_at > g.t1) { g.t1 = o.filled_at; g.why = p.kind === 'hx' ? 'hard exit' : p.kind === 'ts' || p.S.tr > 0 ? 'trailing take profit' : 'take profit'; } }
    by.set(key, g);
  }
  const all = [...by.values()], closed = [], open = [];
  for (const g of all) {
    const pos = positions.find(p => flat(p.symbol) === g.f);
    const done = g.sq >= g.bq * 0.999 || (!pos && g.sq > 0);
    if (done) closed.push({ s: g.sym, market: g.market, in: g.t0, out: g.t1, pnl: round(g.su - g.bu - g.fee), pnlGross: round(g.su - g.bu), fee: round(g.fee, 2), pct: round((g.su - g.bu - g.fee) / g.reserved * 100, 2), dips: g.dips.size, why: g.why, jev: g.jev, jevFlag: g.jevFlag ?? null, lev: g.lev ?? null, liq: g.liq ?? null, hours: g.t0 && g.t1 ? round((Date.parse(g.t1) - Date.parse(g.t0)) / 36e5, 1) : null });
    else open.push({ s: g.sym, market: g.market, in: g.t0, cost: round(g.bu - g.su), fee: round(g.fee, 2), pl: pos ? round(+pos.unrealized_pl - g.fee) : null });
  }
  closed.sort((a, z) => String(z.out).localeCompare(String(a.out)));
  const first = all.reduce((a, g) => !a || (g.t0 && g.t0 < a) ? g.t0 : a, null);
  return { first, closed, open, stats: statsOf(closed.map(d => ({ pnl: d.pnl, pct: d.pct }))), openPnl: round(open.reduce((a, d) => a + (d.pl || 0), 0)),
    byMarket: { ...Object.fromEntries(['crypto', 'etf'].map(m => [m, statsOf(closed.filter(d => d.market === m))])), meme: statsOf(closed.filter(d => isMeme(d.s))) } };
}
export function statsOf(list) {
  const n = list.length; if (!n) return { n: 0, realized: 0 };
  const pnl = list.reduce((a, t) => a + (t.pnl || 0), 0);
  return { n, win: round(list.filter(t => t.pnl > 0).length / n * 100, 1), realized: round(pnl), avg: round(pnl / n), avgPct: round(list.reduce((a, t) => a + (t.pct || 0), 0) / n, 2), worst: round(Math.min(...list.map(t => t.pnl || 0))), best: round(Math.max(...list.map(t => t.pnl || 0))) };
}
export const _sim = { prep, simulate, metrics }; // DCA lab + tests
