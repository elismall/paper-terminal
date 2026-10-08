import { json, denied, fail, needKeys, authorized, hasAlpaca, snapshots, quoteOf, round, bars, stdevRet, marketSession } from '../lib/core.js';
import { chain, dte, pickExpiry, ymd, longIdeas, impliedMove, debitSpread, straddle } from '../lib/options.js';
import { patternsAt, history, describe, ivLabel, PATTERN } from '../lib/patterns.js';
import { earningsInfo } from '../lib/news.js';
// Option ideas built from a directional view.
//  ?symbol=AAPL&dir=long&target=250      -> vertical debit spread (call for long, put for short)
//  ?symbol=AAPL&strategy=call&target=250 -> long call at three strikes (v0.13.0); strategy=put -> long put
//  ?symbol=AAPL&strategy=csp              -> cash-secured put about 7% below price
//  ?symbol=AAPL&strategy=chart            -> reads the daily chart (lib/patterns.js) and builds one play that fits (v0.18.0)
// v0.13.0: every call / put idea says when the next earnings report is expected (estimated from SEC filings) if the expiry spans it,
// and long calls / puts also show the move the options price in by then.
// Free plan = indicative feed: quotes are derived from OPRA and trades are 15 minutes delayed.
const earnFlag = async (sym, exp) => { const E = await earningsInfo(sym).catch(() => null), n = E?.next; return n && n.inDays >= 0 && n.date <= exp ? { date: n.date, inDays: n.inDays, estimated: true } : null; };
export async function GET(req) {
  if (!authorized(req)) return denied();
  if (!hasAlpaca()) return needKeys('options ideas');
  const u = new URL(req.url).searchParams;
  const sym = (u.get('symbol') || '').toUpperCase().replace(/[^A-Z.]/g, '');
  if (!sym) return json({ error: 'bad_request', message: 'symbol is required' }, { status: 400 });
  try {
    if ((u.get('strategy') || '') === 'chart') return json(await chartPlay(sym), { cache: 300, swr: 900 });
    const sn = await snapshots([sym]); const q = quoteOf(sym, sn[sym]);
    if (!q?.p) return json({ error: 'no_quote', message: `No quote for ${sym}` }, { status: 404 });
    const px = q.p, today = new Date();
    const strategy = u.get('strategy') || 'debit';
    if (strategy === 'call' || strategy === 'put') {
      const tgt = +u.get('target') || null, want = Math.min(120, Math.max(10, +u.get('dte') || 35));
      const L = await longIdeas(sym, px, { dir: strategy === 'put' ? 'short' : 'long', want, target: tgt });
      if (!L.idea) return json({ s: sym, px, idea: null, message: L.message }, { cache: 120 });
      const earn = await earnFlag(sym, L.idea.exp), iv = earn ? await impliedMove(sym, px, { after: earn.date }).catch(() => null) : null;
      return json({ s: sym, px: round(px), idea: { ...L.idea, earn, implied: iv }, feed: 'indicative', at: new Date().toISOString() }, { cache: 300, swr: 900 });
    }
    if (strategy === 'csp') {
      const rows = (await chain(sym, 'put', ymd(new Date(+today + 25 * 864e5)), ymd(new Date(+today + 50 * 864e5)))).filter(r => r.bid > 0);
      if (!rows.length) return json({ s: sym, px, idea: null, message: 'No puts with bids 25-50 days out.' }, { cache: 300 });
      const exp = pickExpiry(rows, 38); const puts = rows.filter(r => r.exp === exp && r.k < px);
      const hasD = puts.some(r => r.delta != null);
      puts.sort((a, b) => hasD ? Math.abs(Math.abs(a.delta) - 0.25) - Math.abs(Math.abs(b.delta) - 0.25) : Math.abs(a.k - px * 0.93) - Math.abs(b.k - px * 0.93));
      const p = puts[0]; if (!p) return json({ s: sym, px, idea: null, message: 'No suitable put.' }, { cache: 300 });
      const d = dte(exp);
      return json({ s: sym, px: round(px), idea: { strategy: 'Cash-secured put', exp, dte: d, earn: await earnFlag(sym, exp), strike: p.k, occ: p.occ, credit: round(p.bid), capital: round(p.k * 100, 0),
        yieldAnn: round(p.bid / p.k * 365 / d * 100, 1), breakeven: round(p.k - p.bid), delta: round(p.delta, 2), iv: p.iv != null ? round(p.iv * 100, 0) : null,
        plan: `Sell 1 ${exp} ${p.k} put for about $${(p.bid * 100).toFixed(0)}. If assigned you buy 100 shares at an effective $${(p.k - p.bid).toFixed(2)}.` },
        feed: 'indicative', at: new Date().toISOString() }, { cache: 300, swr: 900 });
    }
    const dir = u.get('dir') === 'short' ? 'short' : 'long';
    const S = await debitSpread(sym, px, { dir, target: +u.get('target') || null });   // v0.15.0: shared builder (lib/options.js)
    if (!S.idea) return json({ s: sym, px, idea: null, message: S.message }, { cache: /sensible/.test(S.message) ? 120 : 300 });
    return json({ s: sym, px: round(px), idea: { ...S.idea, earn: await earnFlag(sym, S.idea.exp) }, feed: 'indicative', at: new Date().toISOString() }, { cache: 300, swr: 900 });
  } catch (e) { return fail(e, 'options'); }
}

// v0.18.0: "Plays from the chart". The pattern on the daily chart (today's candle so far counts while the market is open), what the
// same pattern did before on this stock, and one play: straddle / strangle when it may break either way, else a debit spread, or a
// long call / put when options are cheap. Ideas only: nothing here places orders. The price is today's candle (bars() folds in the
// latest trade), so no second snapshot lookup; results are kept 5 minutes per stock in this instance, so a query string that dodges
// the CDN cache costs no extra Alpaca calls.
const nyDay = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const CHART = new Map(), CHART_TTL = 3e5;
async function chartPlay(sym) {
  const hit = CHART.get(sym); if (hit && Date.now() - hit.ts < CHART_TTL) return hit.out;
  const out = await chartRead(sym);
  if (CHART.size > 200) CHART.clear();
  if (out.pattern !== undefined) CHART.set(sym, { ts: Date.now(), out });
  return out;
}
async function chartRead(sym) {
  const b = ((await bars([sym], { timeframe: '1Day', days: 800, limitPages: 2 }))[sym] || []).filter(x => [x.o, x.h, x.l, x.c].every(Number.isFinite) && x.h >= x.l);
  const px = b.at(-1)?.c;
  if (b.length < 120 || !(px > 0)) return { s: sym, px: round(px), pattern: null, message: 'Not enough price history for this stock.' };
  // How much of today's session the candle covers. Its volume comes from the 15-minute-delayed feed, so count from 15 minutes ago.
  const S = marketSession(), frac = S.open && nyDay(b.at(-1).t) === nyDay(Date.now()) ? Math.max(0, S.frac - 15 / 390) : 1;
  const ps = patternsAt(b, b.length - 1, frac), base = { s: sym, px: round(px), partial: frac < 1, at: new Date().toISOString(), feed: 'indicative' };
  if (!ps.length) return { ...base, pattern: null, message: 'No clear pattern on the chart right now.' };
  const p = ps[0], P = PATTERN[p.key], d = describe(p, px), hist = history(b, p.key, p.dir);
  const rv = round(stdevRet(b.map(x => x.c), 20) * Math.sqrt(252) * 100, 0);
  const pattern = { key: p.key, name: P.name, dir: p.dir, trend: p.trend, text: d.text, trigger: d.trigger, off: d.off, atr: round(p.atr), also: ps.slice(1).map(x => PATTERN[x.key].name) };
  let idea = null, message = null, iv = null;
  if (p.dir === 'either') {
    const S2 = await straddle(sym, px, { want: P.want }); iv = S2.idea?.call.iv ?? null;
    idea = ivLabel(iv, rv) === 'expensive' && S2.wide ? S2.wide : S2.idea; message = S2.message;
  } else {
    const from = p.dir === 'up' ? Math.max(px, p.key === 'tight' || p.key === 'coil' ? p.hi : px) : Math.min(px, p.key === 'tight' || p.key === 'coil' ? p.lo : px);
    const target = round(from + (p.dir === 'up' ? 2 : -2) * p.atr);
    const D = await debitSpread(sym, px, { dir: p.dir === 'up' ? 'long' : 'short', target, fromDays: 7, toDays: P.want + 25, want: P.want });
    iv = D.idea?.buy.iv ?? null; idea = D.idea; message = D.message;
    if (ivLabel(iv, rv) === 'cheap' || !idea) { const L = await longIdeas(sym, px, { dir: p.dir === 'up' ? 'long' : 'short', want: P.want, target }); if (L.idea) { idea = L.idea; iv ??= L.idea.strikes.find(x => x.label === 'At the money')?.iv ?? null; } else message ??= L.message; }
  }
  if (idea) idea.earn = await earnFlag(sym, idea.exp);
  return { ...base, pattern, history: hist, vol: { iv, rv, label: ivLabel(iv, rv) }, idea, message: idea ? null : message };
}
