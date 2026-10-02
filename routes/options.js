import { json, denied, fail, needKeys, authorized, hasAlpaca, snapshots, quoteOf, round } from '../lib/core.js';
import { chain, dte, pickExpiry, ymd, longIdeas, impliedMove, debitSpread } from '../lib/options.js';
import { earningsInfo } from '../lib/news.js';
// Option ideas built from a directional view.
//  ?symbol=AAPL&dir=long&target=250      -> vertical debit spread (call for long, put for short)
//  ?symbol=AAPL&strategy=call&target=250 -> long call at three strikes (v0.13.0); strategy=put -> long put
//  ?symbol=AAPL&strategy=csp              -> cash-secured put about 7% below price
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
