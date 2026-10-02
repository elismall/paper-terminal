// Jev (TypeSafe AI) as an optional second opinion on each NEW trade the rules already picked. It never places orders
// and never touches stops, exits or the risk limits. Off until TYPESAFE_API_KEY is set in Vercel.
//   JEV_MODE = shadow (default once the key exists): ask + record the answer in the order id; trades are unchanged.
//              gate: skip setups Jev rates weak with confidence, halve size on doubtful ones.
//              off:  never called.
// Jev reads charts as numbers, not pictures: chartState() turns the daily candles into a compact snapshot (returns,
// where price sits in its ranges, streaks, the last candle's shape, volume and volatility trends). Code computes, Jev judges,
// code decides (the verdict policy below), and the hard risk rules always win.
// Docs: POST https://api.typesafe.ai/v1/systemone (Bearer key), questions of type score / choice / noul (docs.typesafe.ai/api).
import { env, round } from './core.js';
import { blobReadJson, blobWriteJson } from './notify.js';

export const JEV = { model: 'jev-1.13.0', timeoutMs: 4000, gate: { skipBelow: 1.0, skipConf: 0.6, downsideSkip: 0.75, halfBelow: 1.6, halfConf: 0.4, flag: 0.7 } };
export function jevStatus() {
  const key = !!env('TYPESAFE_API_KEY'), m = env('JEV_MODE');
  return { key, mode: key ? (['off', 'shadow', 'gate'].includes(m) ? m : 'shadow') : 'off', model: env('JEV_MODEL') || JEV.model };
}
const yn = (t, f) => ({ true: t, false: f });
// Atomic questions (one factor each); the policy that combines them lives in code (verdict below).
export const ENTRY_Q = {
  quality: { type: 'score', instructions: 'Given only these numbers, how good is this long entry for a gain over the next few days?', criteria: ['Poor: likely to fail', 'Marginal', 'Decent', 'Strong'] },
  trend: { type: 'score', instructions: 'How strong and orderly is the uptrend in this chart data?', criteria: ['No uptrend', 'Weak', 'Moderate', 'Strong'] },
  regime: { type: 'choice', instructions: 'Which regime do these numbers describe for this asset?', criteria: { trending: 'steady move in one direction', mean_reverting: 'swinging around an average', choppy: 'noisy, no clear pattern' } },
  extended: { type: 'noul', instructions: 'Is price stretched too far above its recent averages and range to buy now?', criteria: yn('stretched, likely to pull back first', 'not stretched') },
  reversal: { type: 'noul', instructions: 'Do the latest candles show selling pressure that often comes before a drop?', criteria: yn('selling pressure', 'no clear selling pressure') },
  volume_ok: { type: 'noul', instructions: 'Does recent volume support the price move?', criteria: yn('volume supports it', 'volume does not support it') },
  downside: { type: 'noul', instructions: 'Is a sharp drop over the next few days more likely than usual for this asset?', criteria: yn('more likely than usual', 'not more likely than usual') },
};
// Hold review for positions the bots already own (shadow only: recorded and shown, never acted on).
export const REVIEW_Q = {
  hold: { type: 'score', instructions: 'Given this open long position and its chart numbers, how good is it to keep holding for the next few days?', criteria: ['Exit now', 'Weak hold', 'Hold', 'Strong hold'] },
  continues: { type: 'noul', instructions: 'Is the move in favor of this long position likely to continue over the next few days?', criteria: yn('likely to continue', 'not likely to continue') },
  fading: { type: 'noul', instructions: 'Is upward momentum fading (smaller gains, weaker closes, rising wicks)?', criteria: yn('fading', 'not fading') },
  downside: { type: 'noul', instructions: 'Is a sharp drop over the next few days more likely than usual for this asset?', criteria: yn('more likely than usual', 'not more likely than usual') },
};
// Stock entries also get the recent headlines/filings (lib/news.js) and one extra question about them (v0.10.0, shadow).
export const ENTRY_NEWS_Q = { ...ENTRY_Q, news_support: { type: 'noul', instructions: 'Do the recent headlines and filings in "news" support buying this stock now, with no earnings report, share offering or bad-news risk right ahead? A null field means that data could not be fetched (see news.data_status): treat it as unknown, not as good or bad news. Earnings dates are estimates.', criteria: yn('news supports buying now', 'news does not support buying now') } };
// Market Brief (News tab): Jev reads the last day's headlines for a stock plus the price reaction.
export const NEWS_Q = {
  impact: { type: 'score', instructions: 'Given these headlines and the price reaction, how much should this news move the stock over the next few days?', criteria: ['None', 'Small', 'Meaningful', 'Major'] },
  direction: { type: 'choice', instructions: 'Which way does this news most likely push the stock over the next few days?', criteria: { up: 'more likely higher', down: 'more likely lower', unclear: 'no clear direction' } },
  priced_in: { type: 'noul', instructions: "Does the latest price move already reflect this news?", criteria: yn('already priced in', 'not yet priced in') },
  risk_event: { type: 'noul', instructions: 'Is a scheduled or likely event coming soon (earnings, offering, ruling, trial data) that could move the stock sharply?', criteria: yn('risky event soon', 'no risky event soon') },
};
// Research question sets (v0.15.0). Jev judges the evidence code supplies; it never supplies numbers, price levels or facts, and
// every set allows "insufficient". Answers come back per question (choice / score / yes-no probability + answer confidence).
// These sets are only used by the Catalyst panel and the Trade fit card: never by the bots, never for orders.
const GENERIC = new WeakSet();
const research = (q) => (GENERIC.add(q), q);
// Catalyst panel, question set cat-2. Call 1 (before the history study, which depends on the type): what kind of event, which way
// it pushes the stock IF it happens, how well the supplied dated sources support it, and how much it could matter to the business.
export const CAT_QSET = 'cat-2';
export const CAT_Q1 = research({
  kind: { type: 'choice', instructions: 'What kind of catalyst does "scenario" describe for this stock?', criteria: { earnings: 'quarterly results or guidance', product: 'a product launch, company event or new business line', rumor: 'an unconfirmed report or rumor', regulatory: 'an FDA, court or government decision', deal: 'a merger, acquisition, partnership or big contract', analyst: 'an analyst upgrade, downgrade or price target change', macro: 'an economy-wide event (Fed, CPI, jobs report, tariffs)', other: 'something else' } },
  direction: { type: 'choice', instructions: 'ASSUMING the scenario happens exactly as described, which way would it most likely push this stock over the holding period? This is conditional on the event happening; it is not a forecast that it will happen.', criteria: { up: 'higher', down: 'lower', unclear: 'no clear direction' } },
  event_support: { type: 'choice', instructions: 'Judge ONLY the dated items in "sources" (headlines and SEC filings supplied by code; do not use memory). How strongly do they support that this event has happened or will happen? No sources = insufficient.', criteria: { confirmed: 'an official company filing or announcement confirms it', credible_report: 'a named, credible outlet reports it', rumor: 'only unconfirmed or anonymous reports', unsupported: 'the sources do not mention it', insufficient: 'not enough information to judge' } },
  materiality: { type: 'choice', instructions: 'Using only "business" (industry, revenue scale, market value) and "scenario", could this event materially change the company\'s business (revenue, costs, risk) within the holding period? This is about business impact, not the next-day price move. Do not estimate revenue figures.', criteria: { low: 'small relative to the business', moderate: 'noticeable but not transformative', high: 'could change the business meaningfully', insufficient: 'not enough information to judge' } },
});
// Call 2 (after the history study): how comparable the past events are, why the reaction could differ from the headline, how much
// is already anticipated, and which code-built condition would most undermine the reading. `conds` = { c1: 'text', ... }.
export const catQ2 = (conds) => research({
  match: { type: 'choice', instructions: 'Compare "scenario" with "past_events.examples" (dated headlines or filings code matched). How comparable are these past events to this scenario?', criteria: { weak: 'different kinds of events', partial: 'same broad type, different specifics or scale', strong: 'closely similar events', insufficient: 'too few examples to judge' } },
  divergence: { type: 'choice', instructions: 'What could most plausibly make the market react differently from the headline\'s apparent direction? Use the supplied numbers (run-up, implied move, past reactions).', criteria: { expectations: 'already expected or priced in', weak_commercial_impact: 'little real business effect', execution_risk: 'delays, execution or approval risk', competing_news: 'other news or the market could dominate', unclear: 'no clear reason' } },
  anticipation: { type: 'choice', instructions: 'Using "anticipation" (the run-up before now vs this stock\'s typical run-up before such events, recent headline count, implied move vs typical event move), how much of this event already seems reflected in the price?', criteria: { little: 'little sign it is priced in', mixed: 'some signs', substantial: 'strong signs it is already priced in', insufficient: 'not enough data' } },
  ...(conds && Object.keys(conds).length ? { invalidation: { type: 'choice', instructions: 'Which ONE of these code-built conditions would most undermine the scenario\'s expected direction? Pick only from the list.', criteria: { ...conds, insufficient: 'not enough information to choose' } } } : {}),
});
// Trade fit card (Ask Jev), question set tf-1. `opt` says which choices code offers (only those with complete evidence), plus the
// code-built invalidation conditions. Suitability scores rate the supplied plan against the rubric; they are not chances of profit.
export const TF_QSET = 'tf-1';
const RUBRIC = ['Not suitable: the evidence argues against this plan', 'Marginal: mixed evidence', 'Suitable: the evidence mostly supports it', 'Well supported: strong, consistent evidence'];
export function tradeFitQ({ horizons = [], plans = [], timing = [], conds = {}, options = false, catalyst = false } = {}) {
  const H = { swing_2_10d: 'swing trade, 2–10 trading days', position_1_3m: 'position trade, 1–3 months', invest_1_3y: 'long-term hold, 1–3 years' };
  const T = { now: 'the current plan entry is supported now', pullback: 'wait for the pullback zone code supplied', breakout: 'wait for the breakout level code supplied', after_event: 'wait until after the upcoming event' };
  const q = {
    horizon: { type: 'choice', instructions: 'Which holding period do the supplied evidence and plans best support? Judge each window on its own evidence; weak short-term evidence does not by itself make a long-term hold weak.', criteria: { ...Object.fromEntries(horizons.map(h => [h, H[h]])), wait: 'none right now: wait', insufficient: 'not enough evidence to choose' } },
    timing: { type: 'choice', instructions: 'Which entry timing do the supplied price levels support?', criteria: { ...Object.fromEntries(timing.map(t => [t, T[t]])), insufficient: 'not enough evidence' } },
    objection: { type: 'choice', instructions: 'What is the strongest reason in the supplied evidence to avoid or delay this entry?', criteria: { extension: 'price is stretched', selling_pressure: 'selling pressure in recent candles', upcoming_event: 'an earnings report or event inside the window', weak_history: 'weak historical results for this setup', costs: 'costs or wide option spreads eat the edge', missing_data: 'important evidence is missing', none: 'no clear objection' } },
  };
  for (const p of plans) q[`${p}_fit`] = { type: 'score', instructions: { swing: 'Rate the supplied SWING plan (entry, stop, target, 2–10 day hold) against its chart, news, costs and the setup\'s historical results. Suitability, not a probability of profit.', position: 'Rate the supplied POSITION plan (1–3 months) against the weekly trend, relative strength, the base rate of this stock\'s 1–3 month returns in similar conditions, and upcoming earnings. Suitability, not a probability of profit.', invest: 'Rate the supplied LONG-TERM case (1–3 years) against the dated SEC financials: revenue, earnings, cash flow, debt, valuation and dilution. Business risks were not supplied: treat them as unknown. Suitability, not a probability of profit.' }[p], criteria: RUBRIC };
  if (catalyst) q.catalyst_fit = { type: 'choice', instructions: 'Do the dated items in "news" support the plan\'s direction within the holding period, given the price reaction already seen?', criteria: { supports: 'they support it', neutral: 'no clear support either way', contradicts: 'they argue against it', insufficient: 'not enough dated evidence' } };
  if (options) q.options_fit = { type: 'choice', instructions: 'Is the supplied option contract a reasonable way to express the plan\'s thesis? Compare its breakeven with the historical moves, its bid/ask spread and liquidity, its implied volatility vs the implied and typical moves, and its expiry vs the holding period. A bullish view alone does not make buying a call attractive.', criteria: { reasonable: 'a reasonable expression of the thesis', overpriced_for_move: 'the premium needs a bigger move than history supports', illiquid: 'spread or liquidity too poor', timing_mismatch: 'expiry does not fit the holding period or event', insufficient: 'not enough option evidence' } };
  if (Object.keys(conds).length) q.invalidation = { type: 'choice', instructions: 'Which ONE of these code-built conditions would most weaken the thesis? Pick only from the list.', criteria: { ...conds, insufficient: 'not enough information to choose' } };
  return research(q);
}
const num = (a, k) => round(a?.[k], 2);
const parse = (j, set) => {
  const a = j.answers || {};
  if (set === REVIEW_Q) return { hold: num(a.hold, 'score'), conf: num(a.hold, 'confidence'), cont: num(a.continues, 'noul'), fade: num(a.fading, 'noul'), down: num(a.downside, 'noul'), model: j.model };
  if (GENERIC.has(set)) return { a: Object.fromEntries(Object.keys(set).map(k => { const x = a[k]; return [k, x ? { choice: x.choice ?? null, score: num(x, 'score'), noul: num(x, 'noul'), conf: num(x, 'confidence') } : null]; })), model: j.model };
  if (set === NEWS_Q) return { impact: num(a.impact, 'score'), conf: num(a.impact, 'confidence'), dir: a.direction?.choice || null, dirConf: num(a.direction, 'confidence'), priced: num(a.priced_in, 'noul'), risk: num(a.risk_event, 'noul'), model: j.model };
  return { q: num(a.quality, 'score'), conf: num(a.quality, 'confidence'), ...(a.news_support ? { nws: num(a.news_support, 'noul') } : {}), trend: num(a.trend, 'score'), regime: a.regime?.choice || null, ext: num(a.extended, 'noul'), rev: num(a.reversal, 'noul'), vol: num(a.volume_ok, 'noul'), down: num(a.downside, 'noul'), model: j.model };
};
async function call(state, model, set = ENTRY_Q, timeoutMs = JEV.timeoutMs) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController(), t0 = Date.now(), timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch('https://api.typesafe.ai/v1/systemone', { method: 'POST', signal: ac.signal,
        headers: { authorization: `Bearer ${env('TYPESAFE_API_KEY')}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, state, questions: set }) });
      if ((r.status === 429 || r.status === 529) && attempt === 0) { await new Promise(res => setTimeout(res, 500)); continue; }
      if (!r.ok) throw new Error(`Jev ${r.status}`);
      const j = await r.json();
      return { ...parse(j, set), ms: Date.now() - t0 };
    } catch (e) { if (attempt === 1 || e.name !== 'AbortError') throw e.name === 'AbortError' ? new Error('Jev timed out') : e; }
    finally { clearTimeout(timer); }
  }
  throw new Error('Jev unavailable');
}
// Every bot call is also kept here (exact state sent + answers) so the run can save it for the Jev tab. Drained per run.
export const JLOG = [];
// items: [{ s, state }] -> { mode, results: { SYM: answer | { error } }, failed }
// timeoutMs: research calls (Catalyst panel, Trade fit card) ask more questions and allow longer than a bot run's 4 s.
export function makeJudge(set = ENTRY_Q, { log = true, timeoutMs = JEV.timeoutMs } = {}) {
  const st = jevStatus();
  const judge = async (items) => {
    if (st.mode === 'off' || !items.length) return { mode: st.mode, results: {}, failed: 0 };
    const results = {}; let failed = 0;
    await Promise.all(items.map(async it => { try { results[it.s] = await call(it.state, st.model, set, timeoutMs); } catch (e) { failed++; results[it.s] = { error: e.message }; }
      if (log) JLOG.push({ t: new Date().toISOString(), kind: set === REVIEW_Q ? 'review' : set === NEWS_Q ? 'news' : GENERIC.has(set) ? 'research' : 'entry', s: it.s, state: it.state, a: results[it.s] }); }));
    return { mode: st.mode, results, failed };
  };
  judge.mode = st.mode;
  return judge;
}
// v0.14.0: the bots now look every 5–15 minutes, so Jev is asked about a symbol at most ONCE per New York day per question set
// (Blob jev/day/<date>.json). Later runs that day reuse that answer (it's the same setup), so more frequent checks never mean
// more AI calls. Failed calls are not cached (the next run asks again).
export const jevDayKey = (day) => `jev/day/${day}.json`;
export function oncePerDay(judge, set = 'entry', { day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) } = {}) {
  if (!judge || judge.mode === 'off') return judge;
  const f = async (items) => {
    if (!items.length) return { mode: judge.mode, results: {}, failed: 0, cached: 0 };
    const key = jevDayKey(day), C = (await blobReadJson(key, { fresh: true }).catch(() => null)) || {}, k = (s) => `${set}:${s}`;
    const need = items.filter(it => !C[k(it.s)]), r = need.length ? await judge(need) : { mode: judge.mode, results: {}, failed: 0 };
    let added = 0; for (const [s, a] of Object.entries(r.results || {})) if (a && !a.error) { C[k(s)] = a; added++; }
    if (added) await blobWriteJson(key, C).catch(() => null);
    const results = {}; for (const it of items) results[it.s] = C[k(it.s)] || r.results?.[it.s];
    return { mode: r.mode || judge.mode, results, failed: r.failed || 0, cached: items.length - need.length };
  };
  f.mode = judge.mode;
  return f;
}
// One tiny call to prove the key, the model and the request format work (health ?probe=jev). Never returns the key.
export async function jevProbe() {
  const st = jevStatus(); if (!st.key) return { ok: false, why: 'TYPESAFE_API_KEY is not set' };
  const state = { asset: 'stock', setup: 'Pullback', rules_score: 70, rsi14: 44, ...chartState(Array.from({ length: 60 }, (_, i) => { const c = 100 + i * 0.5 - (i > 55 ? (i - 55) * 1.2 : 0); return { o: c - 0.3, h: c + 0.8, l: c - 0.9, c, v: 1e6 }; })) };
  try { const r = await call(state, st.model); return { ok: true, mode: st.mode, ...r }; } catch (e) { return { ok: false, mode: st.mode, error: e.message }; }
}
// The policy (only used in gate mode). Hard risk rules elsewhere always win; this can only make the bot MORE careful.
export function verdict(r, mode) {
  if (mode !== 'gate' || !r || r.error || r.q == null) return { act: 'normal', size: 1 };
  const G = JEV.gate;
  if (r.down != null && r.down >= G.downsideSkip) return { act: 'skip', size: 0, why: `AI filter: drop risk ${Math.round(r.down * 100)}%` };
  if (r.q < G.skipBelow && r.conf >= G.skipConf) return { act: 'skip', size: 0, why: `AI filter: weak setup (${r.q}/3, confidence ${r.conf})` };
  if (r.q < G.halfBelow || r.conf < G.halfConf) return { act: 'half', size: 0.5, why: `AI filter: doubtful (${r.q}/3), half size` };
  if ((r.ext ?? 0) >= G.flag || (r.rev ?? 0) >= G.flag) return { act: 'half', size: 0.5, why: `AI filter: ${(r.ext ?? 0) >= G.flag ? 'looks stretched' : 'selling pressure'}, half size` };
  return { act: 'normal', size: 1 };
}
// Kept in the entry order id: -j<score x10>[e<stretched>r<selling>d<drop risk>] (each a tenth, 0-9), e.g. -j24e3r1d2.
const tenth = (v) => Number.isFinite(v) ? Math.min(9, Math.floor(v * 10)) : null;
export const jevTag = (r) => { if (!r || r.error || !Number.isFinite(r.q)) return ''; const e = tenth(r.ext), v = tenth(r.rev), d = tenth(r.down); return `-j${Math.round(r.q * 10)}${e != null && v != null && d != null ? `e${e}r${v}d${d}` : ''}`; };
const JRE = /-j(\d{1,2})(?:e(\d)r(\d)d(\d))?(?:-|$)/;
export const jevOf = (coid) => { const m = JRE.exec(coid || ''); return m ? +m[1] / 10 : null; };
// true when Jev flagged a risk at entry (stretched, selling pressure or drop risk >= 70%), null when not recorded
export const jevFlagOf = (coid) => { const m = JRE.exec(coid || ''); return m && m[2] != null ? Math.max(+m[2], +m[3], +m[4]) >= 7 : null; };
// The chart as numbers (completed daily candles only, oldest first). Well under 400 tokens.
export function chartState(b) {
  if (!b || b.length < 30) return {};
  const n = b.length, c = b.map(x => x.c), px = c[n - 1], L = b[n - 1], pct = (a, z) => z ? round((a / z - 1) * 100, 2) : null;
  const hi = (k) => Math.max(...b.slice(-k).map(x => x.h)), lo = (k) => Math.min(...b.slice(-k).map(x => x.l));
  let streak = 0; for (let i = n - 1; i > 0; i--) { const d = Math.sign(c[i] - c[i - 1]); if (!d || (streak && Math.sign(streak) !== d)) break; streak += d; }
  const tr = (i) => Math.max(b[i].h - b[i].l, Math.abs(b[i].h - c[i - 1]), Math.abs(b[i].l - c[i - 1]));
  const atr = (k) => { let s = 0; for (let i = n - k; i < n; i++) s += tr(i); return s / k; };
  const v = b.map(x => +x.v || 0), avg = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1), rng = (L.h - L.l) || 1e-9;
  return {
    ret_1d_pct: pct(px, c[n - 2]), ret_5d_pct: pct(px, c[n - 6]), ret_20d_pct: pct(px, c[n - 21]),
    last10_closes_vs_now_pct: c.slice(-11, -1).map(x => round((x / px - 1) * 100, 1)),
    pct_vs_20d_high: pct(px, hi(20)), pct_vs_20d_low: pct(px, lo(20)), pct_vs_52w_high: pct(px, hi(Math.min(252, n))),
    streak_days: streak,
    last_candle: { green: L.c >= L.o, body_pct_of_range: round(Math.abs(L.c - L.o) / rng * 100, 0), upper_wick_pct: round((L.h - Math.max(L.o, L.c)) / rng * 100, 0), lower_wick_pct: round((Math.min(L.o, L.c) - L.l) / rng * 100, 0), close_in_range_pct: round((L.c - L.l) / rng * 100, 0) },
    volume_5d_vs_20d: avg(v.slice(-20)) ? round(avg(v.slice(-5)) / avg(v.slice(-20)), 2) : null,
    atr14_vs_atr50: n > 52 ? round(atr(14) / atr(50), 2) : null,
  };
}
// Compact numeric state from a swing setup (lib/core.js swingEval result) plus the chart snapshot.
export const swingState = (r, asset, market3m, bars) => ({ asset, setup: r.setup, rules_score: r.score, rsi14: r.rsi, volume_vs_20d: r.volR, rel_strength_3m_pct: r.rs63, atr_pct: r.atrPct,
  pct_from_20d: r.s20 ? round((r.px / r.s20 - 1) * 100, 2) : null, pct_from_50d: r.s50 ? round((r.px / r.s50 - 1) * 100, 2) : null, pct_from_200d: r.s200 ? round((r.px / r.s200 - 1) * 100, 2) : null,
  trend_up: r.s50 > r.s200 && r.px > r.s50, market_3m_pct: round(market3m * 100, 2), chart: chartState(bars) });
