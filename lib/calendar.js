// Economic calendar for the bot (v0.11.0): the US releases that move the whole market. No new key: FRED release dates use the
// FRED_API_KEY the Macro tab already has; the Fed's published FOMC meeting dates are built in as a backstop.
// Used by the stock bot's news layer: a CPI, jobs-report or Fed-decision day (today or tomorrow) adds flag C to the order id,
// which the news rule treats as "half size" (shadow by default; only acted on with NEWS_MODE=gate).
import { env } from './core.js';

const DAY = 864e5;
const nyDay = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
// federalreserve.gov/monetarypolicy/fomccalendars.htm (checked 2026-09-28). The decision is announced on the second day, 2:00 PM ET.
export const FOMC = ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
  '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09', '2027-07-28', '2027-09-15', '2027-10-27', '2027-12-08'];
// FRED release ids (fred.stlouisfed.org/release?rid=N, checked 2026-09-28) -> short name, usual release time (ET).
// TOP = the three that most often move every stock at once. FRED's "FOMC Press Release" (rid 101) is left out on purpose: it lists
// every day as a release date (live check 2026-09-28), so Fed decision days come only from the FOMC list above.
export const MAJOR = [[10, 'CPI', '8:30 AM'], [50, 'Jobs report', '8:30 AM'], [53, 'GDP', '8:30 AM'],
  [54, 'PCE inflation', '8:30 AM'], [46, 'PPI', '8:30 AM'], [9, 'Retail sales', '8:30 AM']];
export const TOP = new Set(['CPI', 'Jobs report', 'FOMC decision']);

// v0.11.1: one small request per release (fred/release/dates) instead of the all-releases list, which timed out from Vercel.
// A failed lookup is cached 15 minutes (not 6 hours) so one slow answer doesn't blank the calendar for the day.
let CAL = null;
export async function econCalendar({ now = Date.now(), days = 14 } = {}) {
  const from = nyDay(now), to = nyDay(now + days * DAY);
  if (CAL && CAL.from === from && CAL.to === to && now - CAL.at < (CAL.v.error ? 9e5 : 6 * 36e5)) return CAL.v;
  const ev = new Map(), add = (d, name, time, src) => { if (!ev.has(d + name)) ev.set(d + name, { d, name, time, top: TOP.has(name), src }); };
  for (const d of FOMC) if (d >= from && d <= to) add(d, 'FOMC decision', '2:00 PM', 'Federal Reserve');
  let error = null; const key = env('FRED_API_KEY');
  if (!key) error = 'FRED_API_KEY not set: Fed meeting dates only';
  else {
    const one = async ([id, name, time]) => {
      const q = new URLSearchParams({ release_id: String(id), api_key: key, file_type: 'json', realtime_start: from, realtime_end: to, include_release_dates_with_no_data: 'true', sort_order: 'asc', limit: '50' });
      const r = await fetch('https://api.stlouisfed.org/fred/release/dates?' + q, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`FRED answered ${r.status}`);
      for (const x of (await r.json()).release_dates || []) if (x.date >= from && x.date <= to) add(x.date, name, time, 'FRED');
    };
    const res = await Promise.allSettled(MAJOR.map(one)), bad = res.map((r, i) => r.status === 'rejected' ? [MAJOR[i][1], r.reason] : null).filter(Boolean);
    if (bad.length) {
      const e = bad[0][1], why = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'FRED timed out' : String(e?.message || e).replace(key, '***');
      error = `${why} for ${bad.map(b => b[0]).join(', ')}${bad.length === MAJOR.length ? ': Fed meeting dates only' : ''}`;
    }
  }
  const v = { from, to, events: [...ev.values()].sort((a, z) => a.d.localeCompare(z.d) || a.name.localeCompare(z.name)), error };
  CAL = { at: now, from, to, v }; return v;
}
// Market-moving releases today or tomorrow (ET): what a new swing entry would sit through.
export function eventRisk(cal, now = Date.now()) {
  const d0 = nyDay(now), d1 = nyDay(now + DAY);
  return (cal?.events || []).filter(e => e.top && (e.d === d0 || e.d === d1)).map(e => ({ ...e, when: e.d === d0 ? 'today' : 'tomorrow' }));
}
export const resetCalendar = () => { CAL = null; };
// v0.13.0 (Catalyst Scenario, macro type): past decision days. federalreserve.gov/monetarypolicy/fomccalendars.htm, checked 2026-09-29.
export const FOMC_PAST = ['2023-02-01', '2023-03-22', '2023-05-03', '2023-06-14', '2023-07-26', '2023-09-20', '2023-11-01', '2023-12-13',
  '2024-01-31', '2024-03-20', '2024-05-01', '2024-06-12', '2024-07-31', '2024-09-18', '2024-11-07', '2024-12-18',
  '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18', '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10'];
// Past release days of one FRED release (e.g. 10 = CPI, 50 = jobs report) since `from` (YYYY-MM-DD). null if FRED is unavailable.
export async function pastReleases(id, from, now = Date.now()) {
  const key = env('FRED_API_KEY'); if (!key) return null;
  const q = new URLSearchParams({ release_id: String(id), api_key: key, file_type: 'json', realtime_start: from, realtime_end: nyDay(now), include_release_dates_with_no_data: 'false', sort_order: 'desc', limit: '200' });
  const r = await fetch('https://api.stlouisfed.org/fred/release/dates?' + q, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r?.ok) return null;
  return ((await r.json()).release_dates || []).map(x => x.date).filter(d => d >= from && d <= nyDay(now));
}
