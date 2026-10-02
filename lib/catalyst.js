// Catalyst evidence and outcomes (Options tab, stocks only; v0.13.0, rebuilt in v0.15.0). You type a ticker and a scenario
// ("beats and raises guidance", "rumored new product next month", "FDA decision Friday"). The panel keeps four things apart:
//   1. Is the event supported by evidence?  Code gathers dated sources (this stock's headlines and SEC 8-Ks from the last 30 days);
//      Jev judges ONLY those sources. No sources = "Unverified hypothetical", and the analysis says "assuming this event happens".
//   2. What could happen?  Bull / base / bear cards. Base = ALL comparable past events (disappointments included); bull and bear
//      are conditional on a rise or a fall and say so. Historical frequencies are shown as counts, never as future probabilities.
//   3. How did comparable events actually go?  This stock's own moves around similar past events:
//        earnings    exact report dates from SEC 8-K item 2.02 filings (with before-open / after-close timing)
//        product, regulatory, deal   SEC full-text search of the company's 8-Ks and press-release exhibits + matching past headlines
//        rumor, analyst, other       matching past headlines (Alpaca / Benzinga news)
//        macro       past Fed decision days and CPI / jobs-report days (FRED)
//      with the coverage of each source (how far back it reached, what was left out and why). Missing history ≠ no events.
//   4. Is a trade plan attractive?  Enter now / code-defined pullback / wait for confirmation / no supported trade, each with entry,
//      stop, target reference, reward/risk after costs, and payoffs under the three scenarios; the "enter now" plan is also replayed
//      on the past events. A target taken from the events that rose is a CONDITIONAL reference, labeled as such.
// Jev (if on) answers two short question sets (lib/jev.js CAT_Q1 / catQ2, set cat-2); it never supplies numbers, prices or facts.
// Every run is frozen in Blob (catalyst/rec/<id>.json: inputs, sources, sample definition, plans, Jev inputs and outputs, versions)
// and indexed in catalyst/log-v2.json, then graded once its holding period is over (gradeOne): from the NEXT session's open after
// the run (or, for a later event date, from the close before the event session), with the stop and target set from that same
// reference; when a daily candle touches both, 5-minute bars decide, else the result is "ambiguous". Nothing here places orders.
import { bars, snapshots, quoteOf, round, regularSession } from './core.js';
import { earningsInfo, secSearch, alpacaNews, itemsText } from './news.js';
import { FOMC, FOMC_PAST, pastReleases } from './calendar.js';
import { makeJudge, CAT_Q1, catQ2, CAT_QSET, jevStatus } from './jev.js';
import { longIdeas, impliedMove, payoff } from './options.js';
import { fundamentals, valuation } from './fundamentals.js';
import { blobReadJson, blobWriteJson } from './notify.js';
import { COST } from './perf.js';
import { VERSION } from './version.js';

export const CAT = { minEvents: 5, years: 3, newsPages: 40, horizons: [1, 5, 10, 20], logKey: 'catalyst/log-v2.json', oldLogKey: 'catalyst/log-v1.json', recKey: (id) => `catalyst/rec/${id}.json`,
  logMax: 300, recentDays: 30, maxSources: 10, gradeChecks: 10, cost: COST, stopAtr: 1.5, band: [0.1, 0.9] };
export const KINDS = {
  earnings: 'Earnings', product: 'Product launch / company event', rumor: 'Rumor / media report', regulatory: 'FDA / regulatory / court',
  deal: 'Deal / merger / partnership', analyst: 'Analyst upgrade / downgrade', macro: 'Macro (Fed, CPI, jobs)', other: 'Other',
};
// Headline patterns per type (past events), and the phrases searched in the company's SEC filings.
export const KW = {
  earnings: /\b(earnings|quarterly results|(first|second|third|fourth)[- ]quarter (20\d\d )?results|Q[1-4] (20\d\d |fy\d* )?results|EPS|guidance)\b/i,
  product: /\b(launch(es|ed|ing)?|unveil(s|ed|ing)?|introduc(es|ed|ing)|debut(s|ed)?|rolls? out|rolled out|new (product|model|chip|device|phone|platform|service|feature|lineup)|product (event|launch)|keynote|showcase[sd]?)\b/i,
  rumor: /\b(reportedly|report(s|ed)? (that|says)|according to (people|sources|a report|reports|a person)|people familiar|sources (say|said)|in (early |advanced )?talks|exploring (a )?(sale|options|deal)|rumou?r(s|ed)?)\b/i,
  regulatory: /\b(FDA|PDUFA|approv(al|es|ed)|clearance|complete response letter|advisory committee|EMA|antitrust|FTC|DOJ|ruling|court|judge|regulators?)\b/i,
  deal: /\b(to acquire|acquires|acquired by|acquisition of|merger|takeover|buyout|tender offer|partnership|partners with|collaboration|contract (with|from)|awarded|agreement with|joint venture|strategic (alliance|investment))\b/i,
  analyst: /\b(upgrade[sd]?|downgrade[sd]?|price target|initiat\w+ (coverage|at|with)|reiterat\w+ (buy|sell|outperform|overweight))\b/i,
};
const SEC_PHRASES = { product: ['"launches"', '"unveils"', '"introduces"'], regulatory: ['"FDA approval"', '"approved by the U.S. Food and Drug Administration"', '"complete response letter"'], deal: ['"definitive agreement"', '"strategic partnership"', '"collaboration agreement"'] };
// 8-K items that confirm an event of each type once it happens (used when grading: did the event show up?)
const CONFIRM_ITEMS = { earnings: ['2.02'], deal: ['1.01', '2.01'], regulatory: ['8.01', '7.01'], product: ['8.01', '7.01'] };
const MACRO = { cpi: [10, 'CPI', /\b(cpi|inflation|consumer price)/i, 8.5], jobs: [50, 'Jobs report', /\b(jobs|payrolls|employment|unemployment)/i, 8.5] };
const UPW = /\b(cool(er|s|ing)?[- ](than[- ]expected[- ])?(cpi|inflation|print)|(cpi|inflation) (comes in |came in |runs )?cool(er)?|cuts? (interest )?rates|beat|beats|raise[sd]?|approv\w*|launch\w*|upgrade\w*|acquired by|partnership|record|strong|surge\w*|wins?|award\w*|cut rates|rate cut|buyback|better than)\b/i;
const DOWNW = /\b(hot(ter)?[- ](than[- ]expected[- ])?(cpi|inflation|print|jobs)|(cpi|inflation) (comes in |came in |runs )?hot(ter)?|hikes? (interest )?rates|miss\w*|cut guidance|lower\w*|reject\w*|delay\w*|recall\w*|downgrade\w*|lawsuit|probe|weak\w*|halt\w*|layoffs?|offering|worse than|hike|tariffs?|crl|complete response)\b/i;
const FUTUREW = /\b(coming|soon|next|upcoming|will|expected|expects|rumou?red|reportedly|plans?|planning|could|may|might|later)\b/i;
const STOP = new Set('the and for with that this will from into over they them their about after before next week month year stock shares company report reports rumor rumors news could would should might today tomorrow expected expect announce announces announced launch launches launching product products new earnings guidance quarter results beat miss raise raises rumored reportedly unveil unveils approval approved decision deal merger partnership upgrade downgrade analyst analysts price target could going likely maybe drop jump rally rallies dump pump days coming soon upcoming'.split(' '));

const DAY = 864e5, nyDay = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const etHour = (t) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date(t)); return (+p.find(x => x.type === 'hour').value % 24) + (+p.find(x => x.type === 'minute').value) / 60; };
const pct = (v) => v == null ? null : round(v * 100, 2);
const $ = (v) => v == null ? '—' : '$' + (+v).toFixed(2);
export function stats(a) {
  const v = a.filter(Number.isFinite).sort((x, z) => x - z), n = v.length; if (!n) return { n: 0, upN: 0, downN: 0 };
  const q = (p) => { const i = (n - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return v[lo] + (v[hi] - v[lo]) * (i - lo); };
  const ab = v.map(Math.abs).sort((x, z) => x - z), am = n % 2 ? ab[(n - 1) / 2] : (ab[n / 2 - 1] + ab[n / 2]) / 2, upN = v.filter(x => x > 0).length, downN = v.filter(x => x < 0).length;
  return { n, median: pct(q(0.5)), p10: pct(q(0.1)), p25: pct(q(0.25)), p75: pct(q(0.75)), p90: pct(q(0.9)), up: round(upN / n * 100, 0), upN, downN, medAbs: pct(am), mean: pct(v.reduce((s, x) => s + x, 0) / n), min: pct(v[0]), max: pct(v[n - 1]) };
}
export function keywordKind(text) {
  const t = String(text || '');
  if (/\b(earnings|quarter|q[1-4]\b|eps|guidance|revenue|report(s|ing)? (on|after|before))/i.test(t)) return 'earnings';
  if (/\b(fed|fomc|powell|cpi|inflation|jobs report|payrolls|rate (cut|hike)|tariffs?)\b/i.test(t)) return 'macro';
  for (const k of ['rumor', 'regulatory', 'deal', 'analyst', 'product']) if (KW[k].test(t)) return k;
  return 'other';
}
export const keywordDir = (text) => { const u = UPW.test(text), d = DOWNW.test(text); return u && !d ? 'up' : d && !u ? 'down' : 'unclear'; };
export const userTerms = (text, sym) => [...new Set(String(text || '').toLowerCase().match(/[a-z][a-z0-9+.-]{3,}/g) || [])].filter(w => !STOP.has(w) && w !== sym.toLowerCase()).slice(0, 6);
// The declared start of a scenario (used when it runs AND when it is graded, so both use the same reference):
//   'event'     a later event date (or today's date before the 9:30 AM ET open): hold from the close before the event session.
//   'next_open' news out now (or an event dated today after the open): enter at the open of the first session after the run.
export function startRule(at, date) { const runDay = nyDay(at); return date && (date > runDay || (date === runDay && etHour(at) < 9.5)) ? 'event' : 'next_open'; }

// Reaction session for an event: before the open -> that day; during or after the session -> the next session if after the close.
function sessionIndex(days, day, when) {
  let i = days.findIndex(d => d >= day); if (i < 0) return -1;
  if (days[i] === day && when === 'after close') i++;
  return i < days.length ? i : -1;
}
// One past event -> moves. base = close before the reaction session. h = holding period in sessions (includes the reaction day).
function measure(B, S, D, h) {
  if (D < 6) return null; const base = B[D - 1].c, sb = S ? S[D - 1]?.c : null, done = D + h - 1 < B.length;
  const mv = done ? B[D + h - 1].c / base - 1 : null, spy = done && sb && S?.[D + h - 1] ? S[D + h - 1].c / sb - 1 : null;
  return { day: B[D].c / base - 1, gap: B[D].o / base - 1, move: mv, vsSpy: mv != null && spy != null ? mv - spy : null, runup: base / B[D - 6].c - 1, done };
}
const atrAt = (B, i, n = 14) => { if (i < n + 1) return null; let s = 0; for (let k = i - n + 1; k <= i; k++) s += Math.max(B[k].h - B[k].l, Math.abs(B[k].h - B[k - 1].c), Math.abs(B[k].l - B[k - 1].c)); return s / n; };
// walk(): one plan over daily candles (stop / target / time exit, gaps, ambiguous days). Lives in lib/walk.js since v0.16.0
// (shared with the candidate ledger and the opening-range shadow without loading this module).
export { walk } from './walk.js';
import { walk } from './walk.js';
// R multiple after costs (0.05% per side, the same as the bot's training).
const rMult = (entry, exit, stop, up, c = CAT.cost) => { const risk = Math.abs(entry - stop) + 2 * c * entry; return risk > 0 ? round(((exit - entry) * (up ? 1 : -1) - c * (entry + exit)) / risk, 2) : null; };

// Past events of one type for one stock: { events: [{ day, when, what, src }], notes, cov } (cov = what each source covered)
async function pastEvents(kind, sym, { text, E, since, now }) {
  const out = [], notes = [], cov = {};
  const add = (day, when, what, src) => { if (day >= since && day < nyDay(now)) out.push({ day, when, what: String(what).slice(0, 160), src }); };
  if (kind === 'earnings') {
    if (E.status !== 'ok') notes.push(E.status === 'off' ? 'SEC_USER_AGENT is not set, so past earnings dates are unavailable' : 'SEC filings could not be read');
    for (const p of E.past) add(p.date, p.when, `Earnings report (${p.when})`, 'SEC 8-K 2.02');
    const inWin = E.past.filter(p => p.date >= since);
    cov.filings = { src: 'SEC 8-K item 2.02', ok: E.status === 'ok', n: inWin.length, from: inWin.at(-1)?.date || null, note: E.status === 'ok' ? `SEC's recent-filings list (up to ~1,000 filings) reaches ${E.past.at(-1)?.date || 'n/a'}` : 'unavailable' };
  } else if (kind === 'macro') {
    const which = Object.values(MACRO).filter(m => m[2].test(text)), fedSaid = /\b(fed|fomc|powell|rates?)\b/i.test(text), all = !which.length && !fedSaid;
    if (fedSaid || all) { for (const d of [...FOMC_PAST, ...FOMC]) add(d, 'during session', 'Fed decision (2:00 PM ET)', 'Federal Reserve'); cov.fed = { src: 'Fed decision calendar', ok: true, from: [...FOMC_PAST].sort()[0] || null }; }
    for (const [id, name] of all ? Object.values(MACRO) : which) {
      const ds = await pastReleases(id, since, now); if (!ds) { notes.push(`${name} dates unavailable (FRED)`); cov[name] = { src: `${name} dates (FRED)`, ok: false }; continue; }
      for (const d of ds) add(d, 'before open', `${name} (8:30 AM ET)`, 'FRED'); cov[name] = { src: `${name} dates (FRED)`, ok: true, n: ds.length, from: ds.slice().sort()[0] || null };
    }
  } else {
    if (SEC_PHRASES[kind] && E.cik) {
      const res = await Promise.all(SEC_PHRASES[kind].map(q => secSearch(E.cik, q, { from: since }).catch(() => null)));
      const ok = res.some(r => r != null); if (!ok) notes.push('SEC full-text search unavailable');
      let hits = 0, skipped = 0;
      for (const r of res) for (const f of r || []) { if (f.earnings) { skipped++; continue; } hits++; add(f.date, '?', `SEC ${f.type || '8-K'}${f.items?.length ? ` (items ${f.items.join(', ')})` : ''} mentioning ${SEC_PHRASES[kind].map(x => x.replace(/"/g, '')).join(' / ')}`, 'SEC full-text search'); }
      cov.sec = { src: 'SEC full-text search (8-Ks + press-release exhibits)', ok, n: hits, from: since, left: skipped ? `${skipped} earnings releases left out` : null };
    } else if (SEC_PHRASES[kind]) cov.sec = { src: 'SEC full-text search', ok: false, note: 'no SEC company ID (SEC_USER_AGENT not set or unknown ticker)' };
    if (kind === 'deal') { let n = 0; for (const f of E.k8 || []) if (f.items.some(i => i === '1.01' || i === '2.01') && !f.items.includes('2.02')) { n++; add(f.date, f.at ? (etHour(f.at) >= 16 ? 'after close' : etHour(f.at) < 9.5 ? 'before open' : 'during session') : '?', `8-K item ${f.items.filter(i => i === '1.01' || i === '2.01').join(', ')} (material agreement / acquisition)`, 'SEC 8-K'); } cov.k8 = { src: 'SEC 8-K items 1.01 / 2.01', ok: E.status === 'ok', n }; }
    const terms = userTerms(text, sym), rx = KW[kind];
    const news = await alpacaNews({ symbols: sym, since: Date.parse(since), pages: CAT.newsPages }).catch(() => null);
    if (!news) { notes.push('headline history unavailable'); cov.headlines = { src: 'Headlines (Alpaca / Benzinga)', ok: false, note: 'unavailable: events before now are unknown, not absent' }; }
    else {
      const oldest = news.at(-1)?.t ? nyDay(news.at(-1).t) : null, capped = news.length >= CAT.newsPages * 50;
      if (capped && oldest) notes.push(`headlines searched back to ${oldest} (busy stock: ${news.length} headlines)`);
      let dropped = 0, matched = 0;
      for (const x of news) {
        if ((x.syms || []).length > 4 || !(x.syms || []).includes(sym)) { dropped++; continue; } // stories about many stocks say little about this one
        const t = `${x.h} ${x.sum || ''}`, hitT = terms.some(w => t.toLowerCase().includes(w));
        if (rx ? !rx.test(t) : !hitT) continue;
        const h = etHour(x.t), when = h >= 16 ? 'after close' : h < 9.5 ? 'before open' : 'during session';
        matched++; add(nyDay(x.t), when, (hitT && rx ? '★ ' : '') + x.h, 'Headline');
      }
      cov.headlines = { src: 'Headlines (Alpaca / Benzinga)', ok: true, n: news.length, matched, dropped, from: capped ? oldest : (oldest && oldest > since ? oldest : since), capped,
        note: capped ? `stopped at ${news.length} headlines: nothing before ${oldest} was searched` : oldest && oldest > since ? `the feed had nothing older than ${oldest}` : null };
    }
  }
  return { events: out, notes, cov };
}

// Dated sources about THIS event from the last 30 days: this stock's headlines that contain your words or the type's keywords,
// and every 8-K it filed. Code gathers them; Jev only judges what is here.
function recentSources(news, E, { sym, terms, rx, now }) {
  const since = nyDay(now - CAT.recentDays * DAY), out = [];
  for (const f of (E.k8 || []).filter(f => f.date >= since)) out.push({ date: f.date, src: 'SEC 8-K', text: `8-K filed: ${itemsText(f.items)}`, items: f.items });
  for (const x of news || []) {
    if ((x.syms || []).length > 4 || !(x.syms || []).includes(sym) || nyDay(x.t) < since) continue;
    const t = `${x.h} ${x.sum || ''}`, hit = terms.some(w => t.toLowerCase().includes(w)) || (rx && rx.test(t));
    if (hit) out.push({ date: nyDay(x.t), t: x.t, src: x.src || 'Headline', text: x.h, url: x.url || null });
  }
  return out.sort((a, z) => z.date.localeCompare(a.date)).slice(0, CAT.maxSources);
}

export async function runScenario({ symbol, text = '', kind: kindIn = '', dir: dirIn = '', date = '', horizon = 5, now = Date.now(), save = true } = {}) {
  const sym = String(symbol || '').toUpperCase().trim(), h = CAT.horizons.includes(+horizon) ? +horizon : 5, since = nyDay(now - CAT.years * 365 * DAY);
  if (!/^[A-Z]{1,5}(\.[A-Z])?$/.test(sym)) throw Object.assign(new Error('Stocks only for now: use a ticker like AAPL.'), { code: 'bad_symbol' });
  const at = new Date(now).toISOString(), eventDay = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null, rule = startRule(at, eventDay), future = rule === 'event';
  const terms = userTerms(text, sym), kwKind = keywordKind(text), kwDir = keywordDir(text);
  const [B0, sn, E, recentNews, F] = await Promise.all([
    bars([sym, 'SPY'], { timeframe: '1Day', days: CAT.years * 365 + 60 }), snapshots([sym]).catch(() => ({})),
    earningsInfo(sym, { now }).catch(() => ({ status: 'failed', past: [], next: null })),
    alpacaNews({ symbols: sym, since: now - CAT.recentDays * DAY, pages: 2 }).catch(() => null),
    fundamentals(sym, { now }).catch(() => ({ status: 'failed' }))]);
  const B = (B0[sym] || []).map(b => ({ ...b, d: nyDay(b.t) })), S = B0.SPY || [];
  if (B.length < 60) throw Object.assign(new Error(`Not enough daily history for ${sym}.`), { code: 'no_data' });
  const Smap = new Map(S.map(b => [nyDay(b.t), b])), SA = B.map(b => Smap.get(b.d) || null), days = B.map(b => b.d);
  const px = quoteOf(sym, sn[sym])?.p || B.at(-1).c;
  // normal volatility: last ~250 sessions
  const rets = []; for (let i = Math.max(1, B.length - 250); i < B.length; i++) rets.push(Math.log(B[i].c / B[i - 1].c));
  const sd = Math.sqrt(rets.reduce((s, r) => s + r * r, 0) / Math.max(1, rets.length)), atr = atrAt(B, B.length - 1), normalH = sd * Math.sqrt(h);
  const val = F?.status === 'ok' ? valuation(F, px) : null;
  // ---- 1. event evidence (code gathers; Jev judges the sources) ----
  const sources = recentSources(recentNews, E, { sym, terms, rx: KW[KINDS[kindIn] ? kindIn : kwKind], now });
  const business = { name: F?.name || E.name || null, industry: E.sic || null, revenue_ttm_usd_m: F?.revenueTTM != null ? round(F.revenueTTM / 1e6, 0) : null, market_cap_usd_m: val ? round(val.marketCap / 1e6, 0) : null, net_margin_pct: val?.netMarginPct ?? null, financials_as_of: F?.asOf || null };
  const st = jevStatus(), jevOn = st.mode !== 'off' && !!text.trim();
  const state1 = jevOn ? { symbol: sym, scenario: text.slice(0, 500), catalyst_date: eventDay, holding_days: h, typical_daily_move_pct: round(sd * 100, 2), next_earnings_est: E.next?.date || null,
    sources: sources.map(s => ({ date: s.date, source: s.src, text: s.text.slice(0, 200) })), business } : null;
  let j1 = null;
  if (jevOn) { const J = await makeJudge(CAT_Q1, { log: false, timeoutMs: 8000 })([{ s: sym, state: state1 }]).catch(e => ({ results: { [sym]: { error: e.message } } })); j1 = J.results[sym] || null; }
  const A1 = j1?.a || {}, jOk = (x, min = 0.4) => x && x.choice && (x.conf == null || x.conf >= min) ? x.choice : null;
  const kind = KINDS[kindIn] ? kindIn : jOk(A1.kind) && KINDS[A1.kind.choice] ? A1.kind.choice : kwKind;
  const jdir = jOk(A1.direction), dir = ['up', 'down'].includes(dirIn) ? dirIn : jdir && jdir !== 'unclear' ? jdir : kwDir;   // Jev unsure or "unclear": keywords decide
  const how = { kind: KINDS[kindIn] ? 'you picked it' : kind === A1.kind?.choice ? `Jev (answer confidence ${Math.round((A1.kind.conf ?? 0) * 100)}%)` : 'keywords in your text',
    dir: ['up', 'down'].includes(dirIn) ? 'you picked it' : dir === A1.direction?.choice ? `Jev, assuming it happens (answer confidence ${Math.round((A1.direction.conf ?? 0) * 100)}%)` : dir === 'unclear' ? 'no clear direction' : 'keywords in your text' };
  // ---- 3. comparable past events (clusters within 2 sessions count once; non-earnings events in an earnings week are left out) ----
  const { events, notes, cov } = await pastEvents(kind, sym, { text, E, since, now });
  const earnIdx = new Set((E.past || []).map(p => sessionIndex(days, p.date, p.when)).filter(i => i >= 0));
  const rows = []; let lastD = -9, clustered = 0, earnWeek = 0;
  for (const e of events.sort((a, z) => a.day.localeCompare(z.day) || (a.what.startsWith('★') ? -1 : 1))) {
    const D = sessionIndex(days, e.day, e.when); if (D < 0) continue;
    if (D - lastD <= 2) { clustered++; continue; }
    if (kind !== 'earnings' && [D - 1, D, D + 1].some(i => earnIdx.has(i))) { earnWeek++; continue; }
    const m = measure(B, SA, D, h); if (!m) continue; lastD = D;
    rows.push({ D, day: e.day, session: days[D], when: e.when, what: e.what, src: e.src, dayPct: pct(m.day), gapPct: pct(m.gap), movePct: pct(m.move), vsSpyPct: pct(m.vsSpy), runupPct: pct(m.runup), done: m.done });
  }
  const done = rows.filter(r => r.done), mv = done.map(r => r.movePct / 100), enough = done.length >= CAT.minEvents;
  const st1 = { day: stats(done.map(r => r.dayPct / 100)), move: stats(mv), runup: stats(done.map(r => r.runupPct / 100)), vsSpy: stats(done.filter(r => r.vsSpyPct != null).map(r => r.vsSpyPct / 100)),
    upMoves: stats(mv.filter(x => x > 0)), downMoves: stats(mv.filter(x => x < 0)) };
  const starred = done.filter(r => r.what.startsWith('★')).length;
  const matchQ = !done.length ? { code: 'none', label: 'No comparable events found' } : kind === 'earnings' || kind === 'macro' ? { code: 'exact', label: 'Exact event dates (same type of event)' }
    : starred >= 3 ? { code: 'words', label: `Same type, ${starred} also contain your own words` } : { code: 'type', label: 'Same type by keywords only: specifics may differ' };
  const coverage = Object.values(cov);
  // ---- anticipation evidence (numbers only) ----
  const runupNow = B.length > 6 ? pct(B.at(-1).c / B.at(-6).c - 1) : null, onTerms = (recentNews || []).filter(x => terms.some(w => `${x.h} ${x.sum || ''}`.toLowerCase().includes(w))).length;
  // conditional target reference (median move of the events that went this way), graded range = 10th–90th percentile of ALL events
  const same = dir === 'up' ? mv.filter(x => x > 0) : dir === 'down' ? mv.filter(x => x < 0) : [];
  const sameMed = same.length >= 3 ? stats(same).median / 100 : null;
  const band = enough ? { lo: st1.move.p10, hi: st1.move.p90, src: `10th–90th percentile of all ${done.length} past events` } : { lo: pct(-1.2816 * normalH), hi: pct(1.2816 * normalH), src: 'normal volatility (too few past events)' };
  const expMove = dir === 'unclear' ? null : Math.abs(sameMed ?? normalH * 0.8) * (dir === 'down' ? -1 : 1);
  const targetKind = sameMed != null ? 'conditional' : 'volatility';
  // ---- options: long calls (up) / puts (down) past the event date, the implied move, breakevens vs history ----
  let options = null, implied = null, optErr = null;
  try {
    implied = await impliedMove(sym, px, { after: future ? eventDay : null, want: Math.max(h, 1) });
    if (dir !== 'unclear') {
      const L = await longIdeas(sym, px, { dir: dir === 'up' ? 'long' : 'short', want: Math.max(21, h * 2 + 14), after: future ? eventDay : null, target: px * (1 + expMove) });
      if (L.idea) for (const k of L.idea.strikes) { const need = k.bePct / 100; k.pastCleared = done.length ? done.filter(r => dir === 'up' ? r.movePct / 100 >= need : r.movePct / 100 <= need).length : null; k.pastN = done.length; }
      options = L.idea || { message: L.message };
    }
  } catch (e) { optErr = String(e.message || e).slice(0, 160); }
  const earnSoon = E.next && E.next.inDays >= 0 && E.next.inDays <= (future ? Math.round((Date.parse(eventDay) - now) / DAY) + h + 3 : h + 3) && kind !== 'earnings' ? E.next : null;
  // ---- 2. bull / base / bear (code) ----
  const hi5 = Math.max(...B.slice(-5).map(b => b.h)), lo5 = Math.min(...B.slice(-5).map(b => b.l)), lvl = (p) => p == null ? null : round(px * (1 + p / 100));
  const volCard = (sg) => ({ median: pct(sg * 0.8 * normalH), p75: pct(sg * 1.2816 * normalH), basis: 'volatility' });
  const scen = {
    base: enough ? { cond: `All ${done.length} comparable events, including the disappointing reactions`, basis: 'history', n: done.length, upN: st1.move.upN, downN: st1.move.downN, median: st1.move.median, p25: st1.move.p25, p75: st1.move.p75, p10: st1.move.p10, p90: st1.move.p90,
      check: `Stays between ${$(lvl(st1.move.p25))} and ${$(lvl(st1.move.p75))} (the middle half of past outcomes) through day ${h}` }
      : { cond: `Only ${done.length} comparable event${done.length === 1 ? '' : 's'}: the stock's normal ${h}-day volatility instead of history`, basis: 'volatility', n: done.length, median: 0, p25: pct(-0.674 * normalH), p75: pct(0.674 * normalH), p10: pct(-1.2816 * normalH), p90: pct(1.2816 * normalH),
      check: `Stays between ${$(lvl(pct(-0.674 * normalH)))} and ${$(lvl(pct(0.674 * normalH)))} (a normal ${h}-day range)` },
    bull: enough && st1.upMoves.n ? { cond: `Only the ${st1.upMoves.n} of ${done.length} events that rose (selected after the fact: conditional on a rise)`, basis: 'history', conditional: true, n: st1.upMoves.n, of: done.length, median: st1.upMoves.median, p75: st1.upMoves.p75, max: st1.upMoves.max,
      check: `Confirms: closes above ${$(hi5)} (the recent 5-day high)` } : { cond: enough ? `None of the ${done.length} events rose` : 'Too few events: a normal-volatility up move instead', ...volCard(1), conditional: true, check: `Confirms: closes above ${$(hi5)} (the recent 5-day high)` },
    bear: enough && st1.downMoves.n ? { cond: `Only the ${st1.downMoves.n} of ${done.length} events that fell (selected after the fact: conditional on a fall)`, basis: 'history', conditional: true, n: st1.downMoves.n, of: done.length, median: st1.downMoves.median, p25: st1.downMoves.p25, min: st1.downMoves.min,
      check: `Confirms: closes below ${$(lo5)} (the recent 5-day low)` } : { cond: enough ? `None of the ${done.length} events fell` : 'Too few events: a normal-volatility down move instead', ...volCard(-1), conditional: true, check: `Confirms: closes below ${$(lo5)} (the recent 5-day low)` },
  };
  const unc = [];
  if (!enough) unc.push(`Only ${done.length} comparable event${done.length === 1 ? '' : 's'} since ${since}.`);
  if (coverage.some(c => c.capped || c.ok === false)) unc.push('Some sources did not cover the whole period (see coverage): events there are unknown, not absent.');
  if (earnSoon) unc.push(`Earnings estimated for ${earnSoon.date} fall inside the hold.`);
  if (matchQ.code === 'type') unc.push('Past events matched by type keywords only: they may be quite different from this scenario.');
  scen.base.uncertain = unc;
  // ---- 4. trade plans (code): entry, stop, target reference, reward/risk after costs, payoffs under each scenario ----
  let plans = [], swing = null, test = null;
  if (dir !== 'unclear') {
    const up = dir === 'up', sg = up ? 1 : -1, stopD = CAT.stopAtr * atr, tgtLevel = px * (1 + expMove), c = CAT.cost;
    const mk = (id, label, entry, note) => {
      const stop = entry - sg * stopD, target = (tgtLevel - entry) * sg > 0 ? tgtLevel : entry * (1 + expMove);
      const risk = Math.abs(entry - stop) + 2 * c * entry, rr = round(((target - entry) * sg - 2 * c * entry) / risk, 2);
      const pay = {}; for (const k of ['bull', 'base', 'bear']) { const m = scen[k].median; if (m == null) { pay[k] = null; continue; } let x = px * (1 + m / 100); if ((x - stop) * sg <= 0) x = stop; if ((x - target) * sg >= 0) x = target; pay[k] = round(((x - entry) * sg / entry - 2 * c) * 100, 2); }
      return { id, label, entry: round(entry), stop: round(stop), target: round(target), rr, pay, note };
    };
    plans = [mk('now', 'Enter now', px, 'At the current price.'), mk('pullback', 'Pullback entry', px - sg * 0.5 * atr, `Only if it trades ${up ? 'down' : 'up'} to ${$(px - sg * 0.5 * atr)} (half an ATR) first; payoffs assume the fill.`),
      mk('confirm', 'Wait for confirmation', up ? Math.max(hi5, px + 0.5 * atr) : Math.min(lo5, px - 0.5 * atr), `Only after it trades ${up ? 'above' : 'below'} ${$(up ? Math.max(hi5, px + 0.5 * atr) : Math.min(lo5, px - 0.5 * atr))} (the 5-day ${up ? 'high' : 'low'} or half an ATR); payoffs assume the fill.`)];
    // the "enter now" plan replayed on each past event: enter at the close before the reaction session, stop 1.5 ATR (ATR at that
    // time), target the same % as today's target; a gap past a level exits at the open; both touched in one candle = ambiguous.
    const R = []; let tgt = 0, stp = 0, tm = 0, amb = 0;
    for (const r of done) {
      const base = B[r.D - 1].c, a = atrAt(B, r.D - 1); if (!a) continue;
      const lv = { entry: base, stop: base - sg * CAT.stopAtr * a, target: base * (1 + expMove), up }, w = walk(B, r.D, r.D + h - 1, lv);
      if (w.why === 'ambiguous') { amb++; R.push({ r: null, worst: rMult(base, lv.stop, lv.stop, up) }); continue; }
      if (w.why === 'target') tgt++; else if (w.why === 'stop') stp++; else tm++;
      const x = rMult(base, w.exit, lv.stop, up); R.push({ r: x, worst: x });
    }
    const clean = R.filter(x => x.r != null).map(x => x.r), worst = R.map(x => x.worst);
    test = R.length ? { n: R.length, target: tgt, stop: stp, time: tm, ambiguous: amb, avgR: clean.length ? round(clean.reduce((s, x) => s + x, 0) / clean.length, 2) : null,
      avgRWorst: round(worst.reduce((s, x) => s + x, 0) / worst.length, 2), win: clean.length ? round(clean.filter(x => x > 0).length / clean.length * 100, 0) : null,
      note: 'The target % comes from these same events, so this replay is optimistic. Ambiguous = a candle touched both levels; "worst case" counts those as stopped out.' } : null;
    const why = [];
    if (!enough) why.push(`fewer than ${CAT.minEvents} comparable events`);
    if (test && test.n >= CAT.minEvents && test.avgRWorst <= 0) why.push(`the replay on past events averaged ${test.avgRWorst}R (worst case) after costs`);
    if (plans[0].rr < 1 && (test?.win ?? 0) < 50) why.push(`reward/risk after costs is ${plans[0].rr}× with no winning history to make up for it`);
    plans.push({ id: 'none', label: 'No trade', supported: why.length > 0, why, note: why.length ? `Code finds no supported trade: ${why.join('; ')}.` : 'Always an option. The other plans are not proven by this analysis either.' });
    const p0 = plans[0];
    swing = { dir: up ? 'long' : 'short', px: round(px), zone: [round(Math.min(px, px - sg * 0.5 * atr)), round(Math.max(px, px - sg * 0.5 * atr))], stop: p0.stop, target: p0.target, rr: p0.rr, atr: round(atr), targetKind,
      stopPct: round(stopD / px * 100, 3), targetPct: round(Math.abs(expMove) * 100, 3),
      basis: sameMed != null ? `conditional reference: the median ${up ? 'gain' : 'drop'} of the ${same.length} past events that moved ${dir} (not an expected return)` : 'normal volatility (fewer than 3 past events moved this way)',
      note: p0.rr < 1 ? 'The target is closer than the 1.5-ATR stop after costs: weak as a stock swing. A defined-risk option or waiting may fit better.' : null };
  }
  if (options?.strikes) for (const k of options.strikes) { const t = options.strategy === 'Long call' ? 'C' : 'P'; k.pay = {}; for (const s of ['bull', 'base', 'bear']) k.pay[s] = scen[s].median == null ? null : payoff([{ type: t, k: k.k, qty: 1 }], k.ask, px * (1 + scen[s].median / 100)); }
  // ---- Jev, second set: comparability, why the reaction could differ, anticipation, which code-built condition breaks the reading ----
  const up = dir === 'up', conds = {};
  if (dir !== 'unclear' && swing) {
    const pre = future ? px : B.length > 1 ? B.at(-2).c : px, lagPct = round(1.2816 * sd * Math.sqrt(3) * 100, 1);
    conds.c1 = `A daily close ${up ? 'below' : 'above'} ${$(swing.stop)} (the plan's stop, 1.5 ATR ${up ? 'under' : 'over'} ${$(px)})`;
    conds.c2 = future ? `Trades ${up ? 'below' : 'above'} ${$(px * (1 - (up ? 1 : -1) * normalH))} (one normal ${h}-day move) before ${eventDay}` : `Closes back ${up ? 'below' : 'above'} ${$(pre)} (the last close before the news)`;
    conds.c3 = `${up ? 'Trails' : 'Beats'} SPY by more than ${lagPct}% over the first 3 sessions`;
    conds.c4 = up ? 'A dated source delays, denies or scales back the event' : 'A dated source shows the problem resolved or smaller than feared';
    if (earnSoon) conds.c5 = `The earnings report estimated for ${earnSoon.date} lands inside the hold and swamps this catalyst`;
  }
  const anticipation = { runup_5d_pct: runupNow, typical_pre_event_runup_pct: st1.runup.median ?? null, headlines_30d_with_your_words: onTerms, implied_move_pct: implied?.pct ?? null, typical_event_move_pct: st1.move.medAbs ?? null };
  const state2 = jevOn ? { symbol: sym, scenario: text.slice(0, 500), direction_if_it_happens: dir, holding_days: h,
    past_events: { n: done.length, up_pct: st1.move.up ?? null, median_move_pct: st1.move.median ?? null, examples: done.slice(-8).map(r => ({ date: r.day, what: r.what.slice(0, 120), move_pct: r.movePct })) }, anticipation } : null;
  let j2 = null;
  if (jevOn) { const J = await makeJudge(catQ2(conds), { log: false, timeoutMs: 8000 })([{ s: sym, state: state2 }]).catch(e => ({ results: { [sym]: { error: e.message } } })); j2 = J.results[sym] || null; }
  const A2 = j2?.a || {};
  // ---- event status (code first; Jev's reading of the sources second) ----
  const fedDay = kind === 'macro' && eventDay && [...FOMC].includes(eventDay);
  const sup = jOk(A1.event_support, 0.3);
  const status = kind === 'earnings' && E.next ? { code: 'scheduled_est', label: 'Scheduled report (date estimated from SEC filing history)' }
    : fedDay ? { code: 'scheduled', label: 'Scheduled (Fed calendar)' }
    : !sources.length ? { code: 'unverified', label: 'Unverified hypothetical: no dated source found' }
    : sup === 'confirmed' ? { code: 'confirmed', label: 'Confirmed by the supplied sources (Jev)' } : sup === 'credible_report' ? { code: 'credible', label: 'Credible report (Jev, from the sources)' }
    : sup === 'rumor' ? { code: 'rumor', label: 'Rumor: unconfirmed reports only (Jev)' } : sup === 'unsupported' ? { code: 'unverified', label: 'Unverified: the sources found do not mention it (Jev)' }
    : { code: 'sources', label: jevOn ? 'Sources found; Jev could not judge them' : 'Sources found; not judged (Jev off)' };
  const missing = [];
  if (!sources.length) missing.push('a dated source (company filing, press release or named news report)');
  if (!eventDay && FUTUREW.test(text)) missing.push('the expected date');
  if (!terms.length) missing.push('specifics (product, drug, deal or counterparty name)');
  const evidence = { status, sources, missing, basis: ['confirmed', 'scheduled'].includes(status.code) ? 'Event announced or scheduled: the history below shows how similar events played out' : 'Assuming this event happens: a what-if, not a forecast that it will' };
  const warn = [];
  if (!enough) warn.push(`Only ${done.length} past event${done.length === 1 ? '' : 's'} like this since ${since}: the ranges below come from the stock's normal volatility and the options' implied move, not from history.`);
  if (implied && st1.move.medAbs != null && enough && implied.pct > st1.move.medAbs * 1.2 && (future || kind === 'earnings')) warn.push(`Options price a ±${implied.pct}% move by ${implied.exp}, more than this stock's typical ${st1.move.medAbs}% on past events like this: buying options into the event is expensive, and implied volatility usually drops right after it.`);
  if (earnSoon) warn.push(`Earnings are estimated for ${earnSoon.date} (from SEC filing history), inside this trade's window: that report can swamp this catalyst.`);
  if (A2.anticipation?.choice === 'substantial' && (A2.anticipation.conf ?? 1) >= 0.4) warn.push('Jev reads the anticipation numbers as substantially priced in already.');
  const jev = jevOn ? { model: j2?.model || j1?.model || null, error: j1?.error || j2?.error || null, qset: CAT_QSET,
    kind: A1.kind, direction: A1.direction, support: A1.event_support, materiality: A1.materiality, match: A2.match, divergence: A2.divergence, anticipation: A2.anticipation,
    invalidation: A2.invalidation ? { ...A2.invalidation, text: conds[A2.invalidation.choice] || (A2.invalidation.choice === 'insufficient' ? 'Not enough information to choose' : null) } : null } : null;
  const id = `${sym}-${now.toString(36)}`;
  const out = { id, v: 2, at, s: sym, text: text.slice(0, 500), kind, kindLabel: KINDS[kind], dir, how, date: eventDay, future, start: rule, horizon: h, px: round(px),
    normal: { dayPct: pct(sd), hPct: pct(normalH), atr: round(atr), atrPct: pct(atr / px) }, since, events: rows.map(({ D, ...r }) => r).reverse().slice(0, 40), counted: done.length, clustered, earnWeek, stats: st1,
    match: matchQ, coverage, evidence, scen, plans, test, band, expPct: expMove == null ? null : pct(expMove), targetKind, swing, options, implied, optErr, anticipation, conds, jev, jevMode: st.mode, notes, warn, nextEarnings: E.next || null,
    business: { ...business, status: F?.status || 'failed' }, costPct: round(CAT.cost * 100, 2),
    sources: kind === 'earnings' ? 'SEC 8-K item 2.02 filings' : kind === 'macro' ? 'Fed decision days + FRED release dates' : SEC_PHRASES[kind] ? 'SEC full-text search + past headlines' : 'past headlines (Alpaca / Benzinga)' };
  if (save) await logAdd(out, { input: { symbol: sym, text: text.slice(0, 500), kind: kindIn, dir: dirIn, date, horizon: h }, state1, state2, terms }).catch(() => null);
  return out;
}

// ---------------- frozen records, index, grading ----------------
export async function readLog() { return (await blobReadJson(CAT.logKey, { fresh: true }).catch(() => null)) || { items: [] }; }
async function logAdd(r, { input, state1, state2, terms }) {
  await blobWriteJson(CAT.recKey(r.id), { v: 2, app: VERSION, qset: CAT_QSET, jevModel: r.jev?.model || null, at: r.at, input, terms, jevInputs: { set1: state1, set2: state2 }, out: r }, 3600);
  const L = await readLog();
  L.items.unshift({ v: 2, id: r.id, at: r.at, s: r.s, text: r.text.slice(0, 300), terms, kind: r.kind, dir: r.dir, date: r.date, start: r.start, horizon: r.horizon, px: r.px, band: r.band, expPct: r.expPct,
    plan: r.swing ? { stopPct: r.swing.stopPct, targetPct: r.swing.targetPct } : null, status: r.evidence.status.code, support: r.jev?.support?.choice || null, n: r.counted, grade: null });
  L.items = L.items.slice(0, CAT.logMax); L.at = new Date().toISOString();
  await blobWriteJson(CAT.logKey, L, 60);
}
// Grade one saved scenario once its holding period is over. Reference (the same rule as when it ran, startRule):
//   next_open  entry = the open of the first session after the run time (nothing before the run can count)
//   event      entry = the close before the event session
// The stop and target are set from that reference (the saved % distances). Move = last close of the hold / reference − 1.
// intraday: { 'YYYY-MM-DD': [5-minute bars] } for days where one candle touched both levels; without it that day is 'ambiguous'.
export function gradeOne(it, B, { now = Date.now(), intraday = null } = {}) {
  if (!B?.length) return null;
  const d = B.map(b => nyDay(b.t)), rule = it.start || startRule(it.at, it.date), runDay = nyDay(it.at);
  let i0, base;
  if (rule === 'event') { i0 = d.findIndex(x => x >= it.date); if (i0 < 1) return null; base = B[i0 - 1].c; }
  else { const pre = etHour(it.at) < 9.5; i0 = d.findIndex(x => x > runDay || (pre && x === runDay)); if (i0 < 0) return null; base = B[i0].o; }
  const end = i0 + it.horizon - 1;
  if (end >= B.length || d[end] >= nyDay(now)) return null; // not over yet (today's candle is still forming)
  const move = (B[end].c / base - 1) * 100;
  const inBand = it.band ? move >= it.band.lo && move <= it.band.hi : null, dirHit = it.dir === 'up' ? move > 0 : it.dir === 'down' ? move < 0 : null;
  let swing = null, r = null, day = null;
  if (it.plan && (it.dir === 'up' || it.dir === 'down')) {
    const up = it.dir === 'up', sg = up ? 1 : -1, stop = base * (1 - sg * it.plan.stopPct / 100), target = base * (1 + sg * it.plan.targetPct / 100);
    const order = intraday ? (i) => firstTouch(intraday[d[i]], { stop, target, up }) : null;
    const w = walk(B, i0, end, { entry: base, stop, target, up }, order);
    swing = w.why === 'time' ? 'neither' : w.why; day = d[w.i];
    r = w.exit != null ? rMult(base, w.exit, stop, up) : null;
  }
  return { v: 2, at: new Date(now).toISOString(), start: d[i0], ref: rule === 'event' ? 'close before the event session' : 'next session open after the run', base: round(base), end: d[end], movePct: round(move, 2), inBand, dirHit, swing, r, day };
}
// Which level 5-minute bars (regular session only) touched first; null if unknown or both in the same 5-minute bar.
export function firstTouch(bs, { stop, target, up }) {
  for (const b of (bs || []).filter(x => regularSession(Date.parse(x.t)))) {
    const hs = up ? b.l <= stop : b.h >= stop, ht = up ? b.h >= target : b.l <= target;
    if (hs && ht) return null; if (hs) return 'stop'; if (ht) return 'target';
  }
  return null;
}
// Did the event show up after the run? This stock's headlines with your words / the type's keywords, or a confirming 8-K item,
// between the run and the end of the hold. true / false / null (could not check).
async function eventSeen(it, g, E) {
  if (['scheduled_est', 'scheduled'].includes(it.status)) return null; // a calendar event: nothing to confirm
  const until = Date.parse(g.end + 'T21:00:00Z');
  const news = await alpacaNews({ symbols: it.s, since: Date.parse(it.at), pages: 2 }).catch(() => null);
  const rx = KW[it.kind], terms = it.terms || [];
  const hit = (news || []).some(x => Date.parse(x.t) <= until && ((x.syms || []).length <= 4) && (terms.some(w => `${x.h} ${x.sum || ''}`.toLowerCase().includes(w)) || (rx && rx.test(`${x.h}`) && terms.length === 0)));
  const k8 = (E?.k8 || []).some(f => f.date >= nyDay(it.at) && f.date <= g.end && (CONFIRM_ITEMS[it.kind] || []).some(i => f.items.includes(i)));
  return news == null && !E?.k8 ? null : hit || k8;
}
export async function gradeLog({ save = true, now = Date.now() } = {}) {
  const L = await readLog(), open = L.items.filter(x => !x.grade);
  if (open.length) {
    const syms = [...new Set(open.map(x => x.s))], B = await bars(syms, { timeframe: '1Day', days: 150 }).catch(() => null);
    let changed = false, checks = 0;
    if (B) for (const it of open) {
      let g = gradeOne(it, B[it.s], { now }); if (!g) continue;
      if (g.swing === 'ambiguous' && g.day) {   // one daily candle touched both: ask 5-minute bars which came first
        const I = await bars([it.s], { timeframe: '5Min', start: `${g.day}T08:00:00Z`, end: `${g.day}T23:59:00Z` }).catch(() => null);
        if (I?.[it.s]?.length) g = gradeOne(it, B[it.s], { now, intraday: { [g.day]: I[it.s] } }) || g;
      }
      if (checks < CAT.gradeChecks) { checks++; const E = await earningsInfo(it.s, { now }).catch(() => null); g.eventSeen = await eventSeen(it, g, E).catch(() => null); }
      it.grade = g; changed = true;
    }
    if (changed && save) { L.at = new Date().toISOString(); await blobWriteJson(CAT.logKey, L, 60).catch(() => null); }
  }
  return { items: L.items, score: scorecard(L.items) };
}
// Separate report cards: event (did it show up, by Jev's source rating), direction (all / when the event showed up), range
// coverage (should be near 80% if the 10–90% ranges are honest), and the plan (R after costs; ambiguous counted apart).
export function scorecard(items) {
  const g = items.filter(x => x.grade), by = {}, sup = {}; let inBand = 0, bandN = 0;
  for (const x of g) {
    const k = by[x.kind] || (by[x.kind] = { kind: x.kind, label: KINDS[x.kind] || x.kind, n: 0, dirN: 0, dirHit: 0, seenN: 0, seenHit: 0, inBand: 0, target: 0, stop: 0, ambiguous: 0, neither: 0, rN: 0, rSum: 0 });
    k.n++; if (x.grade.dirHit != null) { k.dirN++; if (x.grade.dirHit) k.dirHit++; if (x.grade.eventSeen) { k.seenN++; if (x.grade.dirHit) k.seenHit++; } }
    if (x.grade.inBand != null) { bandN++; if (x.grade.inBand) { inBand++; k.inBand++; } }
    if (x.grade.swing && k[x.grade.swing] != null) k[x.grade.swing]++;
    if (Number.isFinite(x.grade.r)) { k.rN++; k.rSum += x.grade.r; }
    const s = x.support || (x.status === 'unverified' ? 'no_sources' : 'not_rated'), q = sup[s] || (sup[s] = { support: s, n: 0, checked: 0, seen: 0 });
    q.n++; if (x.grade.eventSeen != null) { q.checked++; if (x.grade.eventSeen) q.seen++; }
  }
  const rows = Object.values(by).map(k => ({ ...k, dirPct: k.dirN ? round(k.dirHit / k.dirN * 100, 0) : null, seenDirPct: k.seenN ? round(k.seenHit / k.seenN * 100, 0) : null, bandPct: k.n ? round(k.inBand / k.n * 100, 0) : null, avgR: k.rN ? round(k.rSum / k.rN, 2) : null }));
  return { graded: g.length, waiting: items.length - g.length, rows, coverage: { n: bandN, inside: inBand, pct: bandN ? round(inBand / bandN * 100, 0) : null, nominal: 80 }, support: Object.values(sup) };
}
