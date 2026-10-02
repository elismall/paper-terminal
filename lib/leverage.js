// Crypto leverage signal (v0.11.0): perpetual-futures funding rates from Hyperliquid's public info API (no key, no account).
// Funding = what traders holding leveraged longs pay shorts (or the reverse). Very high funding means longs are crowded,
// which often comes before a sharp flush; negative funding means shorts are crowded. Recorded on each new crypto DCA deal
// (order id -h<n|0|1|2>) in shadow mode; LEVERAGE_MODE=gate skips new deals when funding is very hot; =off stops the lookups.
import { env, round } from './core.js';

const INFO = 'https://api.hyperliquid.xyz/info';
let C = null;
// { COIN: { apr, oiUsd, volUsd, premium } } for every Hyperliquid perp. funding is an hourly rate -> x 24 x 365 = % a year.
export async function perpStats() {
  if (C && Date.now() - C.t < 10 * 6e4) return C.v;
  const r = await fetch(INFO, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'metaAndAssetCtxs' }), signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`Hyperliquid answered ${r.status}`);
  const [meta, ctxs] = await r.json(), v = {};
  (meta?.universe || []).forEach((u, i) => { const c = ctxs?.[i]; if (!c || c.funding == null) return;
    v[u.name] = { apr: round(+c.funding * 24 * 365 * 100, 1), oiUsd: Math.round(+c.openInterest * +c.markPx), volUsd: Math.round(+c.dayNtlVlm), premium: c.premium != null ? round(+c.premium * 100, 3) : null }; });
  C = { t: Date.now(), v }; return v;
}
// BTC/USD -> BTC; small-price coins trade as 1,000-unit contracts there (kPEPE, kSHIB, kBONK); funding is the same either way.
export const perpOf = (P, sym) => { const b = String(sym).replace(/\/?USD$/, ''); return P?.[b] || P?.['k' + b] || null; };
export const levBucket = (apr) => apr == null ? null : apr < 0 ? 'n' : apr < 20 ? '0' : apr < 50 ? '1' : '2';
export const LEV_TXT = { n: 'negative (shorts crowded)', 0: 'normal (under 20%/yr)', 1: 'hot (20–50%/yr, longs crowded)', 2: 'very hot (over 50%/yr, longs very crowded)' };
export const levTag = (apr) => { const b = levBucket(apr); return b == null ? '' : '-h' + b; };
export const levOf = (coid) => (/-h([n012])(?=-|$)/.exec(coid || '') || [])[1] ?? null;
export const levMode = () => env('LEVERAGE_MODE') === 'gate' ? 'gate' : env('LEVERAGE_MODE') === 'off' ? 'off' : 'shadow';
