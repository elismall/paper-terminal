import { json, authorized, hasAlpaca, fail, bars, swingEval, round } from '../lib/core.js';
import { jevStatus, JEV, ENTRY_Q, REVIEW_Q, makeJudge, verdict, swingState, chartState } from '../lib/jev.js';
import { readJevLog, lastReview } from '../lib/review.js';
import { tradeFit, readTfIndex, tfScore, TF } from '../lib/tradefit.js';
// Jev tab. GET: status, the exact question battery, the gate policy, the bots' last Jev calls (state sent + answers +
// what the bot did) and the hold review. ?symbol=AAPL (or BTC/USD): build the same chart snapshot the bot would send,
// ask Jev now, and show what gate mode would do. Passcode required. Asking never places an order.
// v0.15.0: for stocks the answer also carries the Trade fit card (lib/tradefit.js: swing / position / long-term / options, what
// evidence is missing, Jev's structured assessment), saved for later grading. ?fit=log: the saved Trade fit asks + report cards.
const nyDay = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
export async function GET(req) {
  if (!authorized(req, { strict: true })) return json({ error: 'locked', message: 'Enter your passcode in Settings to see Jev.' }, { status: 401 });
  const u = new URL(req.url).searchParams, sym = (u.get('symbol') || '').toUpperCase().trim();
  try {
    if (u.get('fit') === 'log') { const L = await readTfIndex(); return json({ items: L.items.slice(0, 60), score: tfScore(L.items), at: new Date().toISOString() }, { priv: true }); }
    if (!sym) {
      const [log, review] = await Promise.all([readJevLog(), lastReview()]);
      return json({ status: jevStatus(), gate: JEV.gate, questions: { entry: ENTRY_Q, review: REVIEW_Q }, log: log?.items || [], logAt: log?.at || null, review, at: new Date().toISOString() }, { priv: true });
    }
    if (!/^[A-Z.]{1,6}(\/USD)?$/.test(sym)) return json({ error: 'bad_symbol', message: 'Use a ticker like AAPL or BTC/USD.' }, { status: 400 });
    if (!hasAlpaca()) return json({ error: 'no_keys', message: 'Alpaca keys are not set.' }, { status: 400 });
    const st = jevStatus(); if (!st.key) return json({ error: 'no_jev', message: 'TYPESAFE_API_KEY is not set in Vercel.' }, { status: 400 });
    const crypto = sym.includes('/'), bench = crypto ? 'BTC/USD' : 'SPY';
    const b = await bars([...new Set([sym, bench])], { timeframe: '1Day', days: crypto ? 420 : TF.histDays });
    const today = crypto ? new Date().toISOString().slice(0, 10) : nyDay(Date.now());
    const done = (s) => (b[s] || []).filter(x => (crypto ? String(x.t).slice(0, 10) : nyDay(x.t)) < today);
    const d = done(sym), bb = done(bench); if (d.length < 30) return json({ error: 'no_data', message: `Not enough daily history for ${sym}.` }, { status: 400 });
    const bret = bb.length > 64 ? bb.at(-1).c / bb.at(-64).c - 1 : 0;
    const r = swingEval(sym, d, sym === bench ? 0 : bret);
    const state = r ? swingState(r, crypto ? 'crypto' : 'stock', bret, d) : { asset: crypto ? 'crypto' : 'stock', setup: 'none (the rules see no setup today)', market_3m_pct: round(bret * 100, 2), chart: chartState(d) };
    const [J, fit] = await Promise.all([makeJudge(undefined, { log: false })([{ s: sym, state }]),
      crypto ? Promise.resolve({ error: 'stocks_only', message: 'Trade fit is for stocks only.' }) : tradeFit(sym, { d, bench: bb }).catch(e => ({ error: 'trade_fit_failed', message: String(e.message || e).slice(0, 160) }))]);
    const a = J.results[sym];
    return json({ s: sym, asOf: d.at(-1).t, rules: r ? { setup: r.setup, dir: r.dir, score: r.score, why: r.why } : null, state, stateChars: JSON.stringify(state).length,
      answers: a, gate: a && !a.error ? verdict(a, 'gate') : null, mode: J.mode, fit, at: new Date().toISOString() }, { priv: true });
  } catch (e) { return fail(e, 'jev'); }
}
