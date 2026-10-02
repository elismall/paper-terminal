// v0.15.0 Company financials from SEC XBRL "company facts" (data.sec.gov/api/xbrl/companyfacts, free, no key; it uses the same
// SEC_USER_AGENT the filings code already sends). Used by the Trade fit card (long-term view) and the Catalyst panel (business
// context for Jev). Code computes every number; nothing is estimated. Tags vary by company, so any field can be missing: the
// summary lists what is missing instead of guessing. Cached in Blob per stock for 24 hours (the raw file can be several MB).
//   TTM (trailing twelve months) = last fiscal year + this year's year-to-date − last year's same year-to-date (10-Q), else the
//   last fiscal year. Growth = last fiscal year vs the one before. Dilution = shares outstanding now vs about 1 and 3 years ago.
import { round } from './core.js';
import { cikFor, secJson } from './news.js';
import { blobReadJson, blobWriteJson } from './notify.js';

export const FUND = { ttlH: 24, staleDays: 200, key: (s) => `fund/${s}-v1.json` };
const DAY = 864e5;
const TAGS = {
  revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'],
  netIncome: ['NetIncomeLoss', 'ProfitLoss'],
  ocf: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
  debt: ['LongTermDebt', 'LongTermDebtNoncurrent'],
  debtCur: ['LongTermDebtCurrent', 'DebtCurrent'],
  cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
};
const days = (a, z) => (Date.parse(z) - Date.parse(a)) / DAY;
// All 10-K / 10-Q values of one concept (first tag that has data), newest filing wins for the same period.
function series(facts, names, unit = 'USD', ns = 'us-gaap') {
  for (const n of names) {
    const u = facts?.[ns]?.[n]?.units?.[unit]; if (!u?.length) continue;
    const by = new Map();
    for (const x of u) { if (!/^10-[KQ]/.test(x.form || '') || !Number.isFinite(x.val)) continue; const k = `${x.start || ''}|${x.end}`, p = by.get(k); if (!p || (x.filed || '') > (p.filed || '')) by.set(k, x); }
    const v = [...by.values()].sort((a, z) => a.end.localeCompare(z.end)); if (v.length) return { tag: n, v };
  }
  return null;
}
// Flow item (revenue, income, cash flow): TTM, last two fiscal years, as-of date.
export function flow(facts, names) {
  const S = series(facts, names); if (!S) return null;
  const dur = S.v.filter(x => x.start), fy = dur.filter(x => { const d = days(x.start, x.end); return d >= 350 && d <= 380; });
  const last = fy.at(-1); if (!last) return null;
  const prev = fy.filter(x => Math.abs(days(x.end, last.end) - 365) <= 20).at(-1) || null;
  const fyStart = new Date(Date.parse(last.end) + DAY).toISOString().slice(0, 10);
  const ytd = dur.filter(x => Math.abs(days(fyStart, x.start)) <= 7 && x.end > last.end && days(x.start, x.end) < 350).at(-1) || null;
  const prior = ytd ? dur.find(x => Math.abs(days(x.end, ytd.end) - 365) <= 20 && Math.abs(days(x.start, x.end) - days(ytd.start, ytd.end)) <= 10) : null;
  const ttm = ytd && prior ? last.val + ytd.val - prior.val : last.val;
  return { tag: S.tag, ttm, asOf: ytd && prior ? ytd.end : last.end, fy: last.val, fyEnd: last.end, fyPrev: prev?.val ?? null, filed: (ytd && prior ? ytd.filed : last.filed) || null };
}
// Point-in-time item (debt, cash): the latest value.
export function point(facts, names) { const S = series(facts, names); const x = S?.v.at(-1); return x ? { val: x.val, asOf: x.end, tag: S.tag } : null; }
// Shares outstanding (cover page, dei) now and about 1 and 3 years earlier.
export function shares(facts) {
  const u = facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares || [];
  const v = u.filter(x => Number.isFinite(x.val)).sort((a, z) => a.end.localeCompare(z.end)); const now = v.at(-1); if (!now) return null;
  const near = (y) => { const want = Date.parse(now.end) - y * 365 * DAY; const c = v.filter(x => Math.abs(Date.parse(x.end) - want) <= 75 * DAY); return c.sort((a, z) => Math.abs(Date.parse(a.end) - want) - Math.abs(Date.parse(z.end) - want))[0] || null; };
  const y1 = near(1), y3 = near(3);
  return { now: now.val, asOf: now.end, y1: y1?.val ?? null, y3: y3?.val ?? null };
}
// Company facts JSON -> slim summary (no prices; valuation is computed by the caller with a live price).
export function summarize(json, { now = Date.now() } = {}) {
  const facts = json?.facts || json;   // the API wraps the concepts in { cik, entityName, facts: { 'us-gaap', dei } }
  const rev = flow(facts, TAGS.revenue), ni = flow(facts, TAGS.netIncome), ocf = flow(facts, TAGS.ocf), capex = flow(facts, TAGS.capex);
  const debtL = point(facts, TAGS.debt), debtC = point(facts, TAGS.debtCur), cash = point(facts, TAGS.cash), sh = shares(facts);
  const pct = (a, b) => a != null && b ? round((a / b - 1) * 100, 1) : null;
  const asOf = [rev?.asOf, ni?.asOf, ocf?.asOf].filter(Boolean).sort().at(-1) || null;
  const filed = [rev?.filed, ni?.filed, ocf?.filed].filter(Boolean).sort().at(-1) || null;
  const out = {
    name: json?.entityName || null, asOf, filed,
    revenueTTM: rev?.ttm ?? null, revenueFY: rev?.fy ?? null, revenueFYPrev: rev?.fyPrev ?? null, revGrowthFY: rev ? pct(rev.fy, rev.fyPrev) : null, fyEnd: rev?.fyEnd || ni?.fyEnd || null,
    netIncomeTTM: ni?.ttm ?? null, netIncomeFY: ni?.fy ?? null, netIncomeFYPrev: ni?.fyPrev ?? null,
    ocfTTM: ocf?.ttm ?? null, capexTTM: capex?.ttm ?? null, fcfTTM: ocf ? ocf.ttm - (capex?.ttm || 0) : null,
    debt: debtL || debtC ? (debtL?.val || 0) + (debtC && debtL?.tag !== 'LongTermDebt' ? debtC.val : 0) : null, cash: cash?.val ?? null,
    shares: sh?.now ?? null, sharesAsOf: sh?.asOf || null, dilution1y: sh ? pct(sh.now, sh.y1) : null, dilution3y: sh ? pct(sh.now, sh.y3) : null,
    tags: { revenue: rev?.tag || null, netIncome: ni?.tag || null, ocf: ocf?.tag || null },
  };
  out.missing = Object.entries({ revenue: out.revenueTTM, 'net income': out.netIncomeTTM, 'operating cash flow': out.ocfTTM, 'shares outstanding': out.shares, debt: out.debt, cash: out.cash })
    .filter(([, v]) => v == null).map(([k]) => k);
  out.stale = !asOf || (now - Date.parse(asOf)) / DAY > FUND.staleDays;
  return out;
}
// Valuation from a live price (code only).
export function valuation(f, px) {
  if (!f || !px || !f.shares) return null;
  const cap = px * f.shares;
  return { marketCap: round(cap, 0), pe: f.netIncomeTTM > 0 ? round(cap / f.netIncomeTTM, 1) : null, ps: f.revenueTTM > 0 ? round(cap / f.revenueTTM, 2) : null,
    fcfYieldPct: f.fcfTTM != null ? round(f.fcfTTM / cap * 100, 2) : null, netDebt: f.debt != null && f.cash != null ? round(f.debt - f.cash, 0) : null,
    netMarginPct: f.revenueTTM ? round(f.netIncomeTTM / f.revenueTTM * 100, 1) : null };
}
// Cached summary for one stock: { status: ok|off|not_found|failed, ... }
export async function fundamentals(sym, { now = Date.now(), fresh = false } = {}) {
  const key = FUND.key(sym);
  if (!fresh) { const c = await blobReadJson(key).catch(() => null); if (c?.at && now - Date.parse(c.at) < FUND.ttlH * 36e5) return { ...c.f, status: 'ok', cachedAt: c.at }; }
  const cik = await cikFor(sym).catch(() => null);
  if (cik == null) return { status: process.env.SEC_USER_AGENT ? 'not_found' : 'off' };
  try {
    const facts = await secJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`);
    const f = summarize(facts, { now });
    await blobWriteJson(key, { at: new Date(now).toISOString(), f }, 3600).catch(() => null);
    return { ...f, status: 'ok' };
  } catch (e) { return { status: 'failed', error: String(e.message || e).slice(0, 120) }; }
}
