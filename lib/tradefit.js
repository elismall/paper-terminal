// v0.15.0 Trade fit card (Jev tab → Ask Jev about any symbol, stocks only). A RESEARCH feature: it never places orders and the bots
// never read it. It compares which approach the evidence supports for one stock, keeping holding period and instrument apart:
//   approach    swing (2–10 trading days) / position trade (1–3 months) / long-term hold (1–3 years) / wait / insufficient evidence
//   instrument  shares / long call / long put / defined-risk spread / insufficient evidence
//   timing      current plan / wait for pullback / wait for breakout / wait until after the event / insufficient evidence
// Code gathers the evidence, builds every plan and price level, computes costs, option payoffs and risk, and decides which windows
// are even offered: a window whose evidence is incomplete is shown as "Not assessed — missing: …" and Jev is never asked about it.
// Jev (question set tf-1, lib/jev.js tradeFitQ) judges the supplied evidence: it picks among the offered choices and rates each
// complete plan 0–3 for SUITABILITY (not a chance of profit). Its answer confidence is shown apart from measured history.
//   swing       the bot's swing rules (swingEval) + its trained exits, chart, news, costs, the setup's history: in-sample AND held-out
//   position    weekly structure, 50/200-day trend, relative strength vs SPY (3/6/12 months), this stock's own 1–3 month returns in
//               the same trend regime (base rate), estimated next earnings
//   long-term   SEC XBRL financials (revenue, earnings, cash flow, debt, dilution) and valuation at the live price. Business risks
//               (10-K Item 1A) are NOT read: the card says so, and Jev is told to treat them as unknown.
//   options     real quotes (indicative feed): the at-the-money long call/put and a debit spread, quote time, bid/ask spread, volume,
//               open interest, IV and Greeks, expiry vs the hold, estimated earnings inside the expiry, payoffs in code.
// Every ask is frozen in Blob (research/tradefit/<id>.json) and indexed (research/tradefit/index.json); gradeTradeFit() scores
// each plan on its own clock (swing after its hold, position at 21 and 63 sessions, options at expiry, long-term stays pending
// with 3/6/12-month checkpoints marked immature).
import { bars, snapshots, quoteOf, swingEval, round, sma, regularSession } from './core.js';
import { chartState, makeJudge, tradeFitQ, TF_QSET, jevStatus } from './jev.js';
import { earningsInfo, newsFeatures, newsState, alpacaNews } from './news.js';
import { stockTraining, COST } from './perf.js';
import { fundamentals, valuation } from './fundamentals.js';
import { longIdeas, debitSpread, impliedMove, payoff, openInterest } from './options.js';
import { walk, firstTouch } from './catalyst.js';
import { blobReadJson, blobWriteJson } from './notify.js';
import { VERSION } from './version.js';

export const TF = { qset: TF_QSET, recKey: (id) => `research/tradefit/${id}.json`, indexKey: 'research/tradefit/index.json', indexMax: 500, histDays: 1900,
  priceStaleMin: 20, quoteStaleMin: 20, maxSpreadPct: 15, minOI: 100, minBase: 100, cost: COST, horizons: { swing: 'swing_2_10d', position: 'position_1_3m', invest: 'invest_1_3y' } };
const DAY = 864e5, nyDay = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const pctOf = (a, b) => a != null && b ? round((a / b - 1) * 100, 2) : null;
const $ = (v) => v == null ? '—' : '$' + (+v).toFixed(2);
const q = (a, p) => { const v = a.filter(Number.isFinite).sort((x, z) => x - z), n = v.length; if (!n) return null; const i = (n - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return v[lo] + (v[hi] - v[lo]) * (i - lo); };
const dist = (a) => { const v = a.filter(Number.isFinite); return v.length ? { n: v.length, median: round(q(v, 0.5) * 100, 2), p10: round(q(v, 0.1) * 100, 2), p25: round(q(v, 0.25) * 100, 2), p75: round(q(v, 0.75) * 100, 2), p90: round(q(v, 0.9) * 100, 2), up: round(v.filter(x => x > 0).length / v.length * 100, 0) } : { n: 0 }; };
const atr14 = (b, i) => { if (i < 15) return null; let s = 0; for (let k = i - 13; k <= i; k++) s += Math.max(b[k].h - b[k].l, Math.abs(b[k].h - b[k - 1].c), Math.abs(b[k].l - b[k - 1].c)); return s / 14; };

// Weekly bars from finished daily bars (weeks start Monday, New York dates).
export function weekly(d) {
  const W = [];
  for (const b of d) { const dt = new Date(nyDay(b.t) + 'T12:00:00Z'), wk = new Date(dt - ((dt.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10), w = W.at(-1);
    if (!w || w.wk !== wk) W.push({ wk, o: b.o, h: b.h, l: b.l, c: b.c }); else { w.h = Math.max(w.h, b.h); w.l = Math.min(w.l, b.l); w.c = b.c; } }
  return W;
}
// Trend regime on day i: up (close > 200d and 50d > 200d), down (both below), or mixed.
const regimeAt = (c, i) => { if (i < 200) return null; const s50 = c.slice(i - 49, i + 1).reduce((a, x) => a + x, 0) / 50, s200 = c.slice(i - 199, i + 1).reduce((a, x) => a + x, 0) / 200; return c[i] > s200 && s50 > s200 ? 'up' : c[i] < s200 && s50 < s200 ? 'down' : 'mixed'; };
// This stock's forward returns over h sessions on every past day in the same regime (overlapping windows, so the effective sample
// is about n ÷ h). A base rate, not a forecast.
export function baseRate(d, h, regime) {
  const c = d.map(b => b.c), out = []; for (let i = 200; i + h < c.length; i++) if (regimeAt(c, i) === regime) out.push(c[i + h] / c[i] - 1);
  return { ...dist(out), h, regime, effN: Math.floor(out.length / h) };
}

// Evidence for one stock. d / bench: finished daily bars (oldest first). Returns everything the card and Jev need.
export async function tradeFitEvidence(sym, { d, bench, now = Date.now() } = {}) {
  const c = d.map(b => b.c), last = d.at(-1), n = d.length, rsOf = (k) => n > k && bench?.length > k ? round(((c[n - 1] / c[n - 1 - k]) - (bench.at(-1).c / bench.at(-1 - k).c)) * 100, 1) : null;
  const [sn, E, NF, heads, T, F] = await Promise.all([snapshots([sym]).catch(() => ({})), earningsInfo(sym, { now }).catch(() => ({ status: 'failed', next: null })), newsFeatures([sym], { now }).catch(() => ({})),
    alpacaNews({ symbols: sym, since: now - 10 * DAY, pages: 1 }).catch(() => null), stockTraining({ cacheOnly: true }).catch(() => null), fundamentals(sym, { now }).catch(() => ({ status: 'failed' }))]);
  const qt = quoteOf(sym, sn[sym]), px = qt?.p || last.c, qAt = qt?.t || null, open = regularSession(now);
  const priceAgeMin = qAt ? round((now - Date.parse(qAt)) / 6e4, 0) : null, priceStale = open && (priceAgeMin == null || priceAgeMin > TF.priceStaleMin);
  const bret = bench?.length > 64 ? bench.at(-1).c / bench.at(-64).c - 1 : 0, r = swingEval(sym, d, bret);
  const atr = atrAt(d), s20 = sma(c, 20), s50 = sma(c, 50), s200 = sma(c, 200), hi20 = Math.max(...d.slice(-21, -1).map(b => b.h)), lo20 = Math.min(...d.slice(-21, -1).map(b => b.l));
  const regime = regimeAt(c, n - 1), earn = E.next || null, ev = {};
  // ---- swing ----
  const setupHist = (bm, s) => bm?.bySetup?.[s] ? { n: bm.bySetup[s].n, win: bm.bySetup[s].win, expR: bm.bySetup[s].expR, band: bm.bySetup[s].band ?? null } : null;
  if (r) {
    const up = r.dir === 'long', sg = up ? 1 : -1, ch = T?.chosen || null, stopA = ch?.stop ?? 1.5, tgtA = ch?.target ?? 3, hold = ch?.hold ?? 10, a = r.atr;
    const plan = { dir: up ? 'long' : 'short', entry: round(px), stop: round(px - sg * stopA * a), target: round(px + sg * tgtA * a), hold, stopAtr: stopA, targetAtr: tgtA,
      stopPct: round(stopA * a / px * 100, 3), targetPct: round(tgtA * a / px * 100, 3), costR: round(2 * TF.cost * px / (stopA * a), 3), costPct: round(2 * TF.cost * 100, 2), rr: round((tgtA * a - 2 * TF.cost * px) / (stopA * a + 2 * TF.cost * px), 2) };
    const missing = []; if (!T) missing.push('the bot\'s training results (not cached yet)'); if (priceStale) missing.push(`a fresh price (last quote ${priceAgeMin ?? '?'} min old)`);
    const hist = { inSample: setupHist(T, r.setup), heldOut: setupHist(T?.holdout, r.setup), heldOutRange: T?.holdout ? T.holdout.testedOn : null };
    if (T && !hist.inSample) missing.push(`history for the ${r.setup} setup`);
    ev.swing = { complete: !missing.length, missing, setup: r.setup, score: r.score, why: r.why, plan, hist, trained: !!ch, rsi: r.rsi, volR: r.volR, rs63: r.rs63 };
  } else ev.swing = { complete: false, missing: ['a swing setup: the bot\'s rules see none today'], plan: null };
  // ---- position ----
  const W = weekly(d), wc = W.map(w => w.c), w10 = sma(wc, 10), w40 = sma(wc, 40), w10ago = wc.length > 14 ? sma(wc.slice(0, -4), 10) : null;
  let hh = 0, hl = 0; for (let i = Math.max(1, W.length - 8); i < W.length; i++) { if (W[i].h > W[i - 1].h) hh++; if (W[i].l > W[i - 1].l) hl++; }
  const weeklyS = { close_vs_10w_pct: pctOf(px, w10), close_vs_40w_pct: pctOf(px, w40), w10_slope_4w_pct: pctOf(w10, w10ago), higher_highs_8w: hh, higher_lows_8w: hl, weeks: W.length };
  {
    const missing = [], pdir = regime === 'up' ? 'long' : regime === 'down' ? 'short' : null;
    if (n < 260 || !w40) missing.push('about a year of daily history (for the 40-week average)');
    const br21 = regime ? baseRate(d, 21, regime) : { n: 0 }, br63 = regime ? baseRate(d, 63, regime) : { n: 0 };
    if (regime && br63.n < TF.minBase) missing.push(`enough past days in the same trend regime (${br63.n} of ${TF.minBase})`);
    if (priceStale) missing.push('a fresh price');
    let plan = null;
    if (pdir) {
      const up = pdir === 'long', lo8 = Math.min(...W.slice(-8).map(w => w.l)), hi8 = Math.max(...W.slice(-8).map(w => w.h)), lvl = up ? lo8 : hi8, dPct = Math.abs(px - lvl) / px;
      const stop = dPct >= 0.03 && dPct <= 0.15 ? lvl : px * (1 - (up ? 1 : -1) * 0.08), tRef = br63.n ? px * (1 + (up ? Math.max(br63.p75, 5) : Math.min(br63.p25, -5)) / 100) : null;
      plan = { dir: pdir, entry: round(px), stop: round(stop), stopBasis: dPct >= 0.03 && dPct <= 0.15 ? `the lowest weekly ${up ? 'low' : 'high'} of the last 8 weeks` : '8% from the price (the 8-week level was too close or too far)', targetRef: round(tRef), targetBasis: '75th percentile of this stock\'s 63-session returns in the same regime (a conditional reference)', holdSessions: [21, 63],
        stopPct: round(Math.abs(px - stop) / px * 100, 3) };
    }
    ev.position = { complete: !!pdir && !missing.length, missing: pdir ? missing : ['a clear trend: price is between its 50- and 200-day averages (no position plan)', ...missing], regime, weekly: weeklyS,
      rs: { m3: rsOf(63), m6: rsOf(126), m12: rsOf(252) }, trend: { vs50: pctOf(px, s50), vs200: pctOf(px, s200) }, base: { d21: br21, d63: br63 }, plan };
  }
  // ---- long-term (SEC financials) ----
  {
    const ok = F?.status === 'ok', val = ok ? valuation(F, px) : null, missing = [];
    if (!ok) missing.push(F?.status === 'off' ? 'SEC financials (SEC_USER_AGENT is not set)' : F?.status === 'not_found' ? 'SEC financials (not an SEC filer: ETFs and some foreign stocks)' : 'SEC financials (could not be read)');
    else { for (const m of F.missing.filter(x => ['revenue', 'net income', 'operating cash flow', 'shares outstanding'].includes(x))) missing.push(m); if (F.stale) missing.push(`recent financials (latest period ${F.asOf || 'unknown'})`); }
    ev.invest = { complete: ok && !missing.length, missing, partial: ['business risks (10-K Item 1A) are not read'], fin: ok ? F : null, val };
  }
  // ---- options: the at-the-money contract and a debit spread in the direction of the plan being expressed ----
  {
    const base = ev.swing.complete ? { dir: ev.swing.plan.dir, target: ev.swing.plan.target, holdDays: Math.round(ev.swing.plan.hold * 1.4), want: Math.max(21, Math.round(ev.swing.plan.hold * 1.4) + 14), for: 'swing' }
      : ev.position.complete && ev.position.plan ? { dir: ev.position.plan.dir, target: ev.position.plan.targetRef, holdDays: 90, want: 100, for: 'position' } : null;
    if (!base) ev.options = { complete: false, missing: ['a complete swing or position plan to express'] };
    else {
      const up = base.dir === 'long', type = up ? 'call' : 'put', missing = [], flags = [];
      const [L, SP, IM] = await Promise.all([longIdeas(sym, px, { dir: up ? 'long' : 'short', want: base.want, target: base.target }).catch(e => ({ idea: null, message: e.message })),
        debitSpread(sym, px, { dir: up ? 'long' : 'short', target: base.target, want: base.want, fromDays: Math.max(14, base.want - 20), toDays: base.want + 40 }).catch(e => ({ idea: null, message: e.message })),
        impliedMove(sym, px, { want: base.holdDays }).catch(() => null)]);
      const atm = L.idea?.strikes?.find(k => k.label === 'At the money') || L.idea?.strikes?.[0] || null;
      if (!atm) missing.push(`quoted ${type}s (${L.message || 'none'})`);
      let oi = null;
      if (atm) {
        const ks = [atm.k, SP.idea?.buy?.k, SP.idea?.sell?.k].filter(x => x != null);
        oi = await openInterest(sym, L.idea.exp, type, Math.min(...ks), Math.max(...ks));
        if (SP.idea && SP.idea.exp !== L.idea.exp) { const o2 = await openInterest(sym, SP.idea.exp, type, Math.min(SP.idea.buy.k, SP.idea.sell.k), Math.max(SP.idea.buy.k, SP.idea.sell.k)); if (o2) oi = { ...(oi || {}), ...o2 }; }
        const age = atm.qt ? (now - Date.parse(atm.qt)) / 6e4 : null;
        if (atm.qt == null) missing.push('a quote time for the contract');
        else if (open && age > TF.quoteStaleMin) missing.push(`a fresh option quote (${Math.round(age)} min old)`);
        else if (!open) flags.push(`quotes are from the last session (${new Date(atm.qt).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET)`);
        if (atm.spread == null || atm.spread > TF.maxSpreadPct) missing.push(`a tradable bid/ask spread (${atm.spread ?? '?'}% of the ask)`);
        if (atm.iv == null) missing.push('implied volatility');
        const oiAtm = oi?.[atm.occ]?.oi ?? null;
        if (oiAtm == null && atm.vol == null) missing.push('liquidity (open interest or volume)'); else if (oiAtm != null && oiAtm < TF.minOI) flags.push(`thin open interest (${oiAtm})`);
        atm.oi = oiAtm; if (SP.idea) { SP.idea.buy.oi = oi?.[SP.idea.buy.occ]?.oi ?? null; SP.idea.sell.oi = oi?.[SP.idea.sell.occ]?.oi ?? null; }
        if (earn && earn.inDays >= 0 && earn.date <= L.idea.exp) flags.push(`the estimated earnings report (${earn.date}) falls before expiry`);
        if (L.idea.dte < base.holdDays) flags.push(`expiry (${L.idea.dte} days) is shorter than the ~${base.holdDays}-day hold`);
      }
      // payoffs at expiry (code): the stock ends at the bear / base / bull outcome of the plan's own history (10th / median / 90th pct)
      const hDist = base.for === 'swing' ? baseRate(d, ev.swing.plan.hold, regime || 'mixed') : ev.position.base.d63;
      const scen = hDist?.n ? { bear: hDist.p10, base: hDist.median, bull: hDist.p90 } : null, t = up ? 'C' : 'P', pay = {}, paySp = {};
      if (scen && atm) for (const [k, m] of Object.entries(scen)) { pay[k] = payoff([{ type: t, k: atm.k, qty: 1 }], atm.ask, px * (1 + m / 100)); if (SP.idea) paySp[k] = payoff([{ type: t, k: SP.idea.buy.k, qty: 1 }, { type: t, k: SP.idea.sell.k, qty: -1 }], SP.idea.debit, px * (1 + m / 100)); }
      ev.options = { complete: !!atm && !missing.length, missing, flags, for: base.for, dir: base.dir, exp: L.idea?.exp || null, dte: L.idea?.dte ?? null, contract: atm, spread: SP.idea || null, spreadMsg: SP.idea ? null : SP.message,
        implied: IM, scen, scenBasis: hDist?.n ? `this stock's ${hDist.h}-session returns in the ${hDist.regime} regime (${hDist.n} days, ~${hDist.effN} independent)` : null, pay, paySp, feed: 'indicative (derived from OPRA, may lag)' };
    }
  }
  // ---- news and levels ----
  const nf = NF[sym] || null, dated = (heads || []).filter(x => (x.syms || []).includes(sym) && (x.syms || []).length <= 4).slice(0, 8).map(x => ({ date: nyDay(x.t), text: x.h.slice(0, 160), src: x.src }));
  ev.news = { state: newsState(nf), dated, ok: heads != null };
  const up = (ev.swing.plan?.dir || ev.position.plan?.dir) !== 'short', sg = up ? 1 : -1;
  ev.levels = { pullback: atr ? [round(up ? Math.min(s20 ?? px, px - 0.5 * atr) : px + 0.25 * atr), round(up ? px - 0.25 * atr : Math.max(s20 ?? px, px + 0.5 * atr))] : null,
    breakout: up ? (px < hi20 ? round(hi20 + 0.1 * (atr || 0)) : null) : (px > lo20 ? round(lo20 - 0.1 * (atr || 0)) : null), s20: round(s20), s50: round(s50), s200: round(s200), w10: round(w10), extensionPct: pctOf(px, s20) };
  ev.earn = earn; ev.px = round(px); ev.priceAt = qAt; ev.priceAgeMin = priceAgeMin; ev.asOf = last.t; ev.regime = regime; ev.atr = round(atr); ev.sg = sg;
  return ev;
}
function atrAt(d) { return atr14(d, d.length - 1); }

// Conditions code builds for Jev to choose from (never invented by Jev): { c1: 'text', ... }
export function conditions(ev) {
  const C = {}, up = ev.sg > 0, w = up ? 'below' : 'above'; let i = 0; const add = (t) => { if (t) C['c' + (++i)] = t; };
  if (ev.swing.plan) add(`A daily close ${ev.swing.plan.dir === 'long' ? 'below' : 'above'} ${$(ev.swing.plan.stop)} (the swing plan's stop)`);
  if (ev.levels.w10) add(`A weekly close ${w} the 10-week average (${$(ev.levels.w10)})`);
  if (ev.levels.s200) add(`A daily close ${w} the 200-day average (${$(ev.levels.s200)})`);
  if (ev.earn && ev.earn.inDays >= 0 && ev.earn.inDays <= 95) add(`The earnings report estimated for ${ev.earn.date} gaps the stock ${up ? 'down' : 'up'} more than ${$(ev.atr)} (one ATR)`);
  add(`${up ? 'Lags' : 'Beats'} SPY by more than 5% over the next month`);
  if (ev.invest.complete) add('The next 10-Q shows revenue down versus a year earlier, or trailing free cash flow turning negative');
  return C;
}
// Code-only default "watch" line when Jev is off or unsure: the stop of the plan for the chosen window.
const defaultWatch = (ev, approach) => approach === TF.horizons.swing && ev.swing.plan ? `A daily close ${ev.swing.plan.dir === 'long' ? 'below' : 'above'} ${$(ev.swing.plan.stop)} (the swing plan's stop)`
  : approach === TF.horizons.position && ev.position.plan ? `A daily close ${ev.position.plan.dir === 'long' ? 'below' : 'above'} ${$(ev.position.plan.stop)} (the position plan's stop: ${ev.position.plan.stopBasis})`
  : approach === TF.horizons.invest ? 'The next 10-Q shows revenue down versus a year earlier, or trailing free cash flow turning negative' : null;

// The compact numbers Jev reads (well under 4 KB).
export function jevState(sym, ev) {
  const S = ev.swing, P = ev.position, I = ev.invest, O = ev.options;
  return { symbol: sym, price: ev.px, as_of: ev.asOf, trend_regime: ev.regime, chart: ev.chart || null,
    swing: S.complete ? { setup: S.setup, rules_score: S.score, plan: { dir: S.plan.dir, entry: S.plan.entry, stop: S.plan.stop, target: S.plan.target, hold_days: S.plan.hold, reward_risk_after_costs: S.plan.rr, round_trip_cost_R: S.plan.costR },
      history_in_sample: S.hist.inSample, history_held_out: S.hist.heldOut, rsi14: S.rsi, volume_vs_20d: S.volR } : null,
    position: P.complete ? { plan: P.plan, weekly: P.weekly, rel_strength_vs_spy_pct: P.rs, pct_vs_50d: P.trend.vs50, pct_vs_200d: P.trend.vs200, base_rate_21d: P.base.d21, base_rate_63d: P.base.d63 } : null,
    long_term: I.complete ? { financials_as_of: I.fin.asOf, filed: I.fin.filed, revenue_ttm_usd_m: round(I.fin.revenueTTM / 1e6, 0), revenue_growth_last_fy_pct: I.fin.revGrowthFY, net_income_ttm_usd_m: round(I.fin.netIncomeTTM / 1e6, 0),
      operating_cash_flow_ttm_usd_m: round(I.fin.ocfTTM / 1e6, 0), free_cash_flow_ttm_usd_m: I.fin.fcfTTM != null ? round(I.fin.fcfTTM / 1e6, 0) : null, debt_usd_m: I.fin.debt != null ? round(I.fin.debt / 1e6, 0) : null, cash_usd_m: I.fin.cash != null ? round(I.fin.cash / 1e6, 0) : null,
      share_count_change_1y_pct: I.fin.dilution1y, share_count_change_3y_pct: I.fin.dilution3y, valuation: I.val, business_risks: 'not supplied: treat as unknown' } : null,
    options: O.complete ? { expresses: O.for, dir: O.dir, expiry: O.exp, days_to_expiry: O.dte, contract: { strike: O.contract.k, ask: O.contract.ask, bid: O.contract.bid, spread_pct_of_ask: O.contract.spread, iv_pct: O.contract.iv, delta: O.contract.delta, theta_per_day_usd: O.contract.thetaDay, breakeven: O.contract.breakeven, move_needed_pct: O.contract.bePct, open_interest: O.contract.oi, volume: O.contract.vol },
      debit_spread: O.spread ? { buy: O.spread.buy.k, sell: O.spread.sell.k, debit: O.spread.debit, max_loss_usd: O.spread.maxLoss, max_profit_usd: O.spread.maxProfit, breakeven: O.spread.breakeven } : null,
      implied_move_pct: O.implied?.pct ?? null, stock_scenarios_pct: O.scen, payoff_at_expiry_usd: O.pay, spread_payoff_at_expiry_usd: O.paySp, flags: O.flags } : null,
    news: { ...(ev.news.state || {}), dated_headlines_10d: ev.news.ok ? ev.news.dated : null }, levels: { pullback_zone: ev.levels.pullback, breakout_level: ev.levels.breakout, pct_above_20d: ev.levels.extensionPct },
    next_earnings_est: ev.earn?.date || null };
}

const APPROACH = { swing_2_10d: 'Swing trade (2–10 trading days)', position_1_3m: 'Position trade (1–3 months)', invest_1_3y: 'Long-term hold (1–3 years)', wait: 'Wait', insufficient: 'Insufficient evidence', not_assessed: 'Not assessed (Jev is off)' };
const INSTR = { shares: 'Shares', long_call: 'Long call', long_put: 'Long put', spread: 'Defined-risk spread', insufficient: 'Insufficient evidence' };
// Build the card: code gates, Jev judges, code maps the answers to the card lines.
export async function tradeFit(sym, { d, bench, now = Date.now(), save = true } = {}) {
  const ev = await tradeFitEvidence(sym, { d, bench, now }); ev.chart = chartState(d);
  const eligible = [['swing', ev.swing], ['position', ev.position], ['invest', ev.invest]].filter(([, x]) => x.complete).map(([k]) => k);
  const horizons = eligible.map(k => TF.horizons[k]), conds = conditions(ev), up = ev.sg > 0;
  const timing = ['now', ...(ev.levels.pullback ? ['pullback'] : []), ...(ev.levels.breakout ? ['breakout'] : []), ...(ev.earn && ev.earn.inDays >= 0 && ev.earn.inDays <= 63 ? ['after_event'] : [])];
  const st = jevStatus(), catalyst = ev.news.ok && ev.news.dated.length > 0, qset = tradeFitQ({ horizons, plans: eligible, timing, conds, options: ev.options.complete, catalyst });
  const state = jevState(sym, ev);
  let J = null;
  if (st.mode !== 'off' && eligible.length) { const r = await makeJudge(qset, { log: false, timeoutMs: 8000 })([{ s: sym, state }]).catch(e => ({ results: { [sym]: { error: e.message } } })); J = r.results[sym] || null; }
  const A = J?.a || {}, pick = (x, min = 0.4) => x && x.choice && (x.conf == null || x.conf >= min) ? x.choice : null;
  // approach
  let approach = !eligible.length ? 'insufficient' : st.mode === 'off' ? 'not_assessed' : J?.error ? 'not_assessed' : (() => { const c = pick(A.horizon); return c && (horizons.includes(c) || c === 'wait') ? c : 'insufficient'; })();
  // instrument (code rule on Jev's options answer)
  const of = pick(A.options_fit), O = ev.options;
  let instrument = 'insufficient', instrWhy = null;
  if ([TF.horizons.swing, TF.horizons.position, TF.horizons.invest].includes(approach)) {
    const dirUp = approach === TF.horizons.position ? ev.position.plan?.dir === 'long' : approach === TF.horizons.swing ? ev.swing.plan?.dir === 'long' : true;
    if (approach === TF.horizons.invest) { instrument = 'shares'; instrWhy = 'Long-term hold: options were not assessed for 1–3 years.'; }
    else if (!O.complete || O.for !== (approach === TF.horizons.swing ? 'swing' : 'position')) { instrument = 'shares'; instrWhy = `Options not assessed for this window${O.missing?.length ? ': missing ' + O.missing.join(', ') : ''}.`; }
    else if (of === 'reasonable') { instrument = dirUp ? 'long_call' : 'long_put'; instrWhy = `The at-the-money ${dirUp ? 'call' : 'put'} (${O.exp}) was judged a reasonable expression.`; }
    else if (of === 'overpriced_for_move' && O.spread) { instrument = 'spread'; instrWhy = 'The single option needs a bigger move than history supports; the spread caps cost and gain.'; }
    else { instrument = 'shares'; instrWhy = of ? { illiquid: 'Options judged illiquid.', timing_mismatch: 'Option expiry does not fit the hold or event.', insufficient: 'Not enough option evidence.', overpriced_for_move: 'Options look expensive for the move and no spread was available.' }[of] || null : 'Jev gave no clear options answer.'; }
  }
  // timing and levels
  const tm = ['wait', 'insufficient', 'not_assessed'].includes(approach) ? approach : pick(A.timing) || 'insufficient';
  const timingText = { now: 'Current plan supported', pullback: `Wait for pullback · ${ev.levels.pullback ? $(ev.levels.pullback[0]) + '–' + $(ev.levels.pullback[1]) : ''}`, breakout: `Wait for breakout · ${up ? 'above' : 'below'} ${$(ev.levels.breakout)}`,
    after_event: `Wait until after the event · earnings est. ${ev.earn?.date || '?'}`, wait: 'Wait: no window is supported now', insufficient: 'Insufficient evidence', not_assessed: 'Not assessed' }[tm];
  // main concern (Jev's objection, filled with code numbers)
  const ob = pick(A.objection), S = ev.swing;
  const concern = !ob ? (eligible.length ? null : 'Missing evidence for every window') : {
    extension: `Stretched: ${ev.levels.extensionPct}% ${ev.levels.extensionPct >= 0 ? 'above' : 'below'} the 20-day average`, selling_pressure: 'Selling pressure in the latest candles',
    upcoming_event: ev.earn ? `Earnings estimated ${ev.earn.date} (from SEC filing history)` : 'An event inside the window', weak_history: S.hist?.heldOut ? `Held-out history for ${S.setup}: ${S.hist.heldOut.expR}R over ${S.hist.heldOut.n} trades` : S.hist?.inSample ? `${S.setup} history (in-sample only): ${S.hist.inSample.expR}R over ${S.hist.inSample.n}` : 'Weak or missing history',
    costs: `Costs: ${S.plan?.costR ?? '?'}R round trip${O.contract?.spread != null ? ` · option spread ${O.contract.spread}% of the ask` : ''}`, missing_data: `Missing: ${[...S.missing || [], ...ev.position.missing || [], ...ev.invest.missing || []][0] || 'some evidence'}`, none: 'No clear objection in the supplied evidence' }[ob];
  const inv = pick(A.invalidation), watch = inv && conds[inv] ? conds[inv] : defaultWatch(ev, approach);
  const fit = (k) => A[`${k}_fit`] ? { score: A[`${k}_fit`].score, conf: A[`${k}_fit`].conf } : null;
  const card = {
    approach, approachLabel: APPROACH[approach], instrument, instrumentLabel: INSTR[instrument], instrWhy, timing: tm, timingText, concern, watch, watchSource: inv && conds[inv] ? 'jev' : watch ? 'code' : null,
    confidence: A.horizon?.conf ?? null, catalystFit: A.catalyst_fit?.choice || null,
    plans: { swing: ev.swing.complete ? { status: 'assessed', ...fit('swing') } : { status: 'not_assessed', missing: ev.swing.missing },
      position: ev.position.complete ? { status: 'assessed', ...fit('position') } : { status: 'not_assessed', missing: ev.position.missing },
      invest: ev.invest.complete ? { status: 'assessed', partial: ev.invest.partial, ...fit('invest') } : { status: 'not_assessed', missing: ev.invest.missing },
      options: O.complete ? { status: 'assessed', answer: of, flags: O.flags } : { status: 'not_assessed', missing: O.missing } },
  };
  const id = `${sym}-${now.toString(36)}`;
  const out = { id, v: 1, qset: TF.qset, at: new Date(now).toISOString(), s: sym, card, ev: { ...ev, chart: undefined }, conds, offered: { horizons, timing, options: ev.options.complete, catalyst },
    jev: J ? { model: J.model || null, error: J.error || null, answers: A } : null, jevMode: st.mode, app: VERSION };
  if (save) await tfSave(out, state).catch(() => null);
  return out;
}

// ---------------- frozen records, index, grading ----------------
export async function readTfIndex() { return (await blobReadJson(TF.indexKey, { fresh: true }).catch(() => null)) || { items: [] }; }
async function tfSave(o, state) {
  await blobWriteJson(TF.recKey(o.id), { ...o, jevInput: state }, 3600);
  const L = await readTfIndex(), ev = o.ev, c = o.card;
  L.items.unshift({ id: o.id, at: o.at, s: o.s, px: ev.px, approach: c.approach, instrument: c.instrument, timing: c.timing, conf: c.confidence,
    fit: { swing: c.plans.swing.score ?? null, position: c.plans.position.score ?? null, invest: c.plans.invest.score ?? null },
    swing: ev.swing.plan ? { dir: ev.swing.plan.dir, stopPct: ev.swing.plan.stopPct, targetPct: ev.swing.plan.targetPct, hold: ev.swing.plan.hold } : null,
    position: ev.position.plan ? { dir: ev.position.plan.dir, stopPct: ev.position.plan.stopPct } : null,
    option: ev.options.contract ? { type: ev.options.dir === 'long' ? 'C' : 'P', k: ev.options.contract.k, cost: ev.options.contract.ask, exp: ev.options.exp } : null,
    spread: ev.options.spread ? { type: ev.options.dir === 'long' ? 'C' : 'P', buy: ev.options.spread.buy.k, sell: ev.options.spread.sell.k, cost: ev.options.spread.debit, exp: ev.options.spread.exp } : null,
    grade: {} });
  L.items = L.items.slice(0, TF.indexMax); L.at = new Date().toISOString();
  await blobWriteJson(TF.indexKey, L, 60);
}
// Grade what has matured. B: daily bars for the symbol, SPY: daily bars for SPY. Reference = the open of the first session after
// the ask (nothing before the ask counts). Returns the updated grade object (unchanged parts kept).
export function gradeTf(it, B, SPY, { now = Date.now(), intraday = null } = {}) {
  const g = { ...(it.grade || {}) }; if (!B?.length) return g;
  const d = B.map(b => nyDay(b.t)), runDay = nyDay(it.at), et = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date(it.at));
  const pre = (+et.find(x => x.type === 'hour').value % 24) + +et.find(x => x.type === 'minute').value / 60 < 9.5, today = nyDay(now);
  const i0 = d.findIndex(x => x > runDay || (pre && x === runDay)); if (i0 < 0) return g;
  const base = B[i0].o, done = (i) => i < B.length && d[i] < today, sm = new Map((SPY || []).map(b => [nyDay(b.t), b]));
  const vsSpy = (i) => { const a = sm.get(d[i0]), z = sm.get(d[i]); return a && z ? round(((B[i].c / base) - (z.c / a.o)) * 100, 2) : null; };
  if (it.swing && !g.swing && done(i0 + it.swing.hold - 1)) {
    const up = it.swing.dir === 'long', sg = up ? 1 : -1, stop = base * (1 - sg * it.swing.stopPct / 100), target = base * (1 + sg * it.swing.targetPct / 100), end = i0 + it.swing.hold - 1;
    const w = walk(B, i0, end, { entry: base, stop, target, up }, intraday ? (i) => firstTouch(intraday[d[i]], { stop, target, up }) : null);
    const risk = Math.abs(base - stop) + 2 * TF.cost * base;
    g.swing = { why: w.why === 'time' ? 'time' : w.why, day: d[w.i], r: w.exit != null ? round(((w.exit - base) * sg - TF.cost * (base + w.exit)) / risk, 2) : null, end: d[end] };
  }
  for (const [k, h] of [['d21', 21], ['d63', 63]]) if (it.position && !g[k] && done(i0 + h - 1)) { const e = i0 + h - 1, sg = it.position.dir === 'long' ? 1 : -1; let mae = 0; for (let i = i0; i <= e; i++) mae = Math.min(mae, sg > 0 ? B[i].l / base - 1 : 1 - B[i].h / base); g[k] = { ret: round(sg * (B[e].c / base - 1) * 100, 2), vsSpy: vsSpy(e) != null ? round(sg * vsSpy(e), 2) : null, worst: round(mae * 100, 2), end: d[e] }; }
  for (const [k, h] of [['m3', 63], ['m6', 126], ['m12', 252]]) if (!g[k] && done(i0 + h - 1)) { const e = i0 + h - 1; g[k] = { ret: round((B[e].c / base - 1) * 100, 2), vsSpy: vsSpy(e), end: d[e], immature: true }; }
  for (const [key, o] of [['option', it.option], ['spread', it.spread]]) if (o && !g[key] && o.exp < today) {
    const e = d.findIndex(x => x >= o.exp), i = e < 0 ? -1 : d[e] === o.exp ? e : e - 1; if (i < i0 || !done(i)) continue;
    const legs = key === 'option' ? [{ type: o.type, k: o.k, qty: 1 }] : [{ type: o.type, k: o.buy, qty: 1 }, { type: o.type, k: o.sell, qty: -1 }], pl = payoff(legs, o.cost, B[i].c);
    g[key] = { pl, cost: round(o.cost * 100, 0), multiple: o.cost ? round(pl / (o.cost * 100), 2) : null, close: round(B[i].c), exp: o.exp };
  }
  return g;
}
export async function gradeTradeFit({ now = Date.now(), save = true } = {}) {
  const L = await readTfIndex(), today = nyDay(now), open = L.items.filter(x => { const g = x.grade || {}; return (x.swing && !g.swing) || (x.position && !g.d63) || !g.m12 || (x.option && !g.option) || (x.spread && !g.spread); })
    .filter(x => nyDay(x.at) < today);
  if (open.length) {
    const oldest = Math.min(...open.map(x => Date.parse(x.at))), days = Math.min(1200, Math.ceil((now - oldest) / DAY) + 10);
    const B = await bars([...new Set([...open.map(x => x.s), 'SPY'])], { timeframe: '1Day', days }).catch(() => null);
    let changed = false;
    if (B) for (const it of open) {
      let g = gradeTf(it, B[it.s], B.SPY, { now });
      if (g.swing?.why === 'ambiguous' && g.swing.day && !it.grade?.swing) {
        const I = await bars([it.s], { timeframe: '5Min', start: `${g.swing.day}T08:00:00Z`, end: `${g.swing.day}T23:59:00Z` }).catch(() => null);
        if (I?.[it.s]?.length) { const g2 = gradeTf({ ...it, grade: { ...it.grade } }, B[it.s], B.SPY, { now, intraday: { [g.swing.day]: I[it.s] } }); if (g2.swing) g.swing = g2.swing; }
      }
      if (JSON.stringify(g) !== JSON.stringify(it.grade || {})) { it.grade = g; changed = true; }
    }
    if (changed && save) { L.at = new Date().toISOString(); await blobWriteJson(TF.indexKey, L, 60).catch(() => null); }
  }
  return { items: L.items, score: tfScore(L.items) };
}
// Report cards kept apart: swing R after costs (by approach Jev chose and by its swing suitability score), position excess return
// vs SPY at 63 sessions, options multiple at expiry. Long-term stays "pending" until 1–3 years pass.
export function tfScore(items) {
  const avg = (a) => a.length ? round(a.reduce((s, x) => s + x, 0) / a.length, 2) : null, rows = [];
  const bucket = (s) => s == null ? 'not rated' : s < 1 ? '0–1' : s < 2 ? '1–2' : '2–3';
  const sw = items.filter(x => Number.isFinite(x.grade?.swing?.r)), pos = items.filter(x => Number.isFinite(x.grade?.d63?.vsSpy)), op = items.filter(x => Number.isFinite(x.grade?.option?.multiple));
  for (const [k, list] of Object.entries(sw.reduce((m, x) => ((m[x.approach] ||= []).push(x), m), {}))) rows.push({ group: `Card said: ${APPROACH[k] || k}`, metric: 'swing R after costs', n: list.length, avg: avg(list.map(x => x.grade.swing.r)) });
  for (const [k, list] of Object.entries(sw.reduce((m, x) => ((m[bucket(x.fit?.swing)] ||= []).push(x), m), {}))) rows.push({ group: `Swing suitability ${k}`, metric: 'swing R after costs', n: list.length, avg: avg(list.map(x => x.grade.swing.r)) });
  if (pos.length) rows.push({ group: 'Position plans', metric: '63-session return vs SPY %', n: pos.length, avg: avg(pos.map(x => x.grade.d63.vsSpy)) });
  if (op.length) rows.push({ group: 'At-the-money options', metric: 'payoff ÷ cost at expiry', n: op.length, avg: avg(op.map(x => x.grade.option.multiple)) });
  return { asked: items.length, swingGraded: sw.length, ambiguous: items.filter(x => x.grade?.swing?.why === 'ambiguous').length, longTermPending: items.filter(x => x.fit?.invest != null).length, rows, minN: 30 };
}
