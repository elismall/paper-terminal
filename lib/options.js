// Option chains and idea builders shared by the Options tab (routes/options.js) and the Catalyst Scenario panel (lib/catalyst.js).
// Free plan = indicative feed: quotes are derived from OPRA and trades are 15 minutes delayed. Ideas only: nothing here places orders.
// v0.13.0: long calls / long puts at three strikes, the move the options price in (at-the-money straddle), earnings-aware expiries.
// v0.15.0: each quote keeps its time, the day's volume, gamma and vega; openInterest() reads the contracts list (trading API); the
// debit spread builder moved here from routes/options.js so the Trade fit card can use it; payoff() values any mix of legs at expiry.
import { alpaca, round } from './core.js';
import { pget } from './trade.js';

const OCC = /^([A-Z.]+?)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;
export const ymd = (d) => new Date(d).toISOString().slice(0, 10);
export async function chain(sym, type, from, to) {
  const out = []; let token = '', pages = 0;
  do {
    const q = new URLSearchParams({ feed: 'indicative', type, limit: '1000', expiration_date_gte: from, expiration_date_lte: to });
    if (token) q.set('page_token', token);
    const d = await alpaca(`/v1beta1/options/snapshots/${encodeURIComponent(sym)}?${q}`);
    for (const [occ, s] of Object.entries(d.snapshots || {})) {
      const m = occ.match(OCC); if (!m) continue;
      const exp = `20${m[2]}-${m[3]}-${m[4]}`;
      const bid = s.latestQuote?.bp ?? null, ask = s.latestQuote?.ap ?? null;
      out.push({ occ, exp, type: m[5], k: +m[6] / 1000, bid, ask, mid: bid != null && ask != null && ask > 0 ? (bid + ask) / 2 : (s.latestTrade?.p ?? null),
        last: s.latestTrade?.p ?? null, delta: s.greeks?.delta ?? null, theta: s.greeks?.theta ?? null, iv: s.impliedVolatility ?? null,
        gamma: s.greeks?.gamma ?? null, vega: s.greeks?.vega ?? null, qt: s.latestQuote?.t || null, vol: s.dailyBar?.v ?? null });
    }
    token = d.next_page_token || ''; pages++;
  } while (token && pages < 4);
  return out;
}
export const dte = (exp) => Math.round((new Date(exp + 'T20:00:00Z') - Date.now()) / 864e5);
export function pickExpiry(rows, want) {
  const exps = [...new Set(rows.map(r => r.exp))];
  exps.sort((a, b) => Math.abs(dte(a) - want) - Math.abs(dte(b) - want));
  return exps[0];
}
const DAY = 864e5;
// Expiry window: after a catalyst date, the options must outlive it by a couple of days (so the reaction can play out);
// otherwise about `want` days out.
function windowFor({ want = 35, after = null }) {
  const now = Date.now(), a = after ? Math.max(now, Date.parse(after + 'T00:00:00Z')) : null;
  return a ? { from: ymd(a + 2 * DAY), to: ymd(a + Math.max(want, 10) * DAY + 30 * DAY), pick: (rows) => [...new Set(rows.map(r => r.exp))].sort()[0] }
    : { from: ymd(now + Math.max(7, want - 20) * DAY), to: ymd(now + (want + 40) * DAY), pick: (rows) => pickExpiry(rows, want) };
}

// Long call (dir long) or long put (dir short) at about 0.70 / 0.50 / 0.30 delta: cost, breakeven, the move needed to break even
// at expiry, time decay per day and what it is worth at the target price at expiry. Max loss = what you pay.
export async function longIdeas(sym, px, { dir = 'long', want = 35, after = null, target = null } = {}) {
  const type = dir === 'short' ? 'put' : 'call', W = windowFor({ want, after });
  const rows = (await chain(sym, type, W.from, W.to)).filter(r => r.ask > 0);
  if (!rows.length) return { idea: null, message: `No ${type}s with quotes between ${W.from} and ${W.to}.` };
  const exp = W.pick(rows), legs = rows.filter(r => r.exp === exp), hasD = legs.some(r => r.delta != null);
  const byDelta = (d, fallbackK) => [...legs].sort((a, b) => hasD ? Math.abs(Math.abs(a.delta ?? 9) - d) - Math.abs(Math.abs(b.delta ?? 9) - d) : Math.abs(a.k - fallbackK) - Math.abs(b.k - fallbackK))[0];
  const sgn = type === 'call' ? 1 : -1, picks = [['In the money', 0.7, px * (1 - sgn * 0.05)], ['At the money', 0.5, px], ['Out of the money', 0.3, px * (1 + sgn * 0.05)]];
  const seen = new Set(), strikes = [];
  for (const [label, d, fk] of picks) {
    const o = byDelta(d, fk); if (!o || seen.has(o.occ)) continue; seen.add(o.occ);
    const cost = o.ask, be = type === 'call' ? o.k + cost : o.k - cost, atT = target ? Math.max(0, sgn * (target - o.k)) : null;
    strikes.push({ label, k: o.k, occ: o.occ, ask: round(o.ask), bid: round(o.bid), mid: round(o.mid), cost: round(cost * 100, 0), breakeven: round(be), bePct: round((be / px - 1) * 100, 2), qt: o.qt, vol: o.vol,
      gamma: o.gamma != null ? round(o.gamma, 4) : null, vega: o.vega != null ? round(o.vega * 100, 2) : null,
      delta: round(o.delta, 2), thetaDay: o.theta != null ? round(o.theta * 100, 2) : null, iv: o.iv != null ? round(o.iv * 100, 0) : null,
      atTarget: atT == null ? null : round((atT - cost) * 100, 0), multiple: atT == null ? null : round(atT / cost, 2), spread: o.bid > 0 ? round((o.ask - o.bid) / o.ask * 100, 0) : null });
  }
  if (!strikes.length) return { idea: null, message: 'Could not pick strikes from the quoted chain.' };
  return { idea: { strategy: type === 'call' ? 'Long call' : 'Long put', exp, dte: dte(exp), strikes, target: target ? round(target) : null, after,
    plan: `Buy 1 ${exp} ${type} at the strike that fits: in the money moves most like the stock and decays slowest; out of the money is cheaper but needs a bigger move before expiry. Max loss is what you pay.` } };
}

// The move the options price in by an expiry: at-the-money call + put (mid) divided by the stock price. The first expiry after
// `after` (a catalyst date), else the first one at least `want` days out.
export async function impliedMove(sym, px, { after = null, want = 7 } = {}) {
  const from = after ? ymd(Date.parse(after + 'T00:00:00Z') + DAY) : ymd(Date.now() + want * DAY), to = ymd(Date.parse(from + 'T00:00:00Z') + 21 * DAY);
  const [c, p] = await Promise.all([chain(sym, 'call', from, to), chain(sym, 'put', from, to)]);
  const exp = [...new Set(c.map(r => r.exp))].sort()[0]; if (!exp) return null;
  const cs = c.filter(r => r.exp === exp && r.mid > 0), k = cs.sort((a, b) => Math.abs(a.k - px) - Math.abs(b.k - px))[0]?.k;
  const cl = cs.find(r => r.k === k), pt = p.find(r => r.exp === exp && r.k === k && r.mid > 0); if (!cl || !pt) return null;
  const straddle = cl.mid + pt.mid;
  return { exp, dte: dte(exp), strike: k, straddle: round(straddle), pct: round(straddle / px * 100, 2), iv: cl.iv != null ? round(cl.iv * 100, 0) : null };
}

// v0.15.0 (moved from routes/options.js): vertical debit spread. Long leg about 0.60 delta, short leg at the strike nearest the
// price target beyond it. Natural debit = long ask − short bid (what you would likely pay); mid shown too. Max loss = the debit.
export async function debitSpread(sym, px, { dir = 'long', target = null, fromDays = 20, toDays = 60, want = 35 } = {}) {
  const today = Date.now(), type = dir === 'long' ? 'call' : 'put', tgt = target || (dir === 'long' ? px * 1.06 : px * 0.94);
  const rows = (await chain(sym, type, ymd(today + fromDays * DAY), ymd(today + toDays * DAY))).filter(r => r.ask > 0);
  if (!rows.length) return { idea: null, message: `No ${type}s with quotes ${fromDays}-${toDays} days out.` };
  const exp = pickExpiry(rows, want), legs = rows.filter(r => r.exp === exp).sort((a, b) => a.k - b.k), hasD = legs.some(r => r.delta != null);
  const longLeg = [...legs].sort((a, b) => hasD ? Math.abs(Math.abs(a.delta) - 0.6) - Math.abs(Math.abs(b.delta) - 0.6)
    : Math.abs(a.k - (dir === 'long' ? px * 0.97 : px * 1.03)) - Math.abs(b.k - (dir === 'long' ? px * 0.97 : px * 1.03)))[0];
  const beyond = legs.filter(r => dir === 'long' ? r.k > longLeg.k : r.k < longLeg.k).filter(r => r.bid != null);
  const shortLeg = beyond.sort((a, b) => Math.abs(a.k - tgt) - Math.abs(b.k - tgt))[0];
  if (!longLeg || !shortLeg) return { idea: null, message: 'Could not build a spread from the quoted strikes.' };
  const width = Math.abs(shortLeg.k - longLeg.k), debitNat = longLeg.ask - (shortLeg.bid || 0), debitMid = (longLeg.mid ?? longLeg.ask) - (shortLeg.mid ?? shortLeg.bid ?? 0);
  if (!(debitNat > 0 && debitNat < width)) return { idea: null, message: 'Quoted prices do not make a sensible spread right now (debit is zero or wider than the strikes).' };
  const maxProfit = width - debitNat;
  return { idea: {
    strategy: dir === 'long' ? 'Call debit spread' : 'Put debit spread', exp, dte: dte(exp),
    buy: { k: longLeg.k, occ: longLeg.occ, ask: round(longLeg.ask), bid: round(longLeg.bid), delta: round(longLeg.delta, 2), iv: longLeg.iv != null ? round(longLeg.iv * 100, 0) : null, qt: longLeg.qt, vol: longLeg.vol,
      spread: longLeg.bid > 0 ? round((longLeg.ask - longLeg.bid) / longLeg.ask * 100, 0) : null },
    sell: { k: shortLeg.k, occ: shortLeg.occ, bid: round(shortLeg.bid), ask: round(shortLeg.ask), delta: round(shortLeg.delta, 2), qt: shortLeg.qt, vol: shortLeg.vol },
    width, debit: round(debitNat), debitMid: round(debitMid), maxLoss: round(debitNat * 100, 0), maxProfit: round(maxProfit * 100, 0),
    payoff: round(maxProfit / debitNat, 2), breakeven: round(dir === 'long' ? longLeg.k + debitNat : longLeg.k - debitNat), target: round(tgt),
    plan: `Buy ${exp} ${longLeg.k}${type[0].toUpperCase()} / sell ${shortLeg.k}${type[0].toUpperCase()} for about $${debitMid.toFixed(2)} (mid). Max loss is the debit paid.` } };
}
// Profit or loss per contract (x100) at expiry for a stock price S. legs: [{ type: 'C'|'P', k, qty: +1 bought / -1 sold }], cost = net
// premium paid per share (negative for a credit). Ignores any time value left, early assignment and fees.
export function payoff(legs, cost, S) {
  let v = 0; for (const l of legs) v += l.qty * Math.max(0, l.type === 'C' ? S - l.k : l.k - S);
  return round((v - cost) * 100, 0);
}
// Open interest for contracts of one expiry and type between two strikes (Alpaca trading API contracts list; the data feed's
// snapshots do not carry it). { occ: { oi, date } } or null when unavailable.
export async function openInterest(sym, exp, type, kLo, kHi) {
  try {
    const q = new URLSearchParams({ underlying_symbols: sym, expiration_date: exp, type, strike_price_gte: String(kLo), strike_price_lte: String(kHi), limit: '200' });
    const d = await pget('/v2/options/contracts?' + q), out = {};
    for (const c of d.option_contracts || []) out[c.symbol] = { oi: c.open_interest != null ? +c.open_interest : null, date: c.open_interest_date || null };
    return out;
  } catch { return null; }
}
