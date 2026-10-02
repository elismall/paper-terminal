// News layer (v0.10.0, insider buying + economic calendar added in v0.11.0). No API keys beyond what the terminal already has:
//   Benzinga via Alpaca (existing keys) + SEC EDGAR (free; needs SEC_USER_AGENT, already set) + press-release wires
//   (GlobeNewswire, PR Newswire RSS) + Federal Reserve press releases (RSS). Every source is optional: one failing never
//   blocks the others.
// Three uses: mergedNews() for the News tab, marketBrief() for "Market Brief · 24h", newsFeatures() + newsVerdict() for the
// stock bot (shadow: recorded in the order id and shown, trades unchanged).
import { alpaca, env, hasAlpaca, snapshots, quoteOf, round } from './core.js';
import { econCalendar, eventRisk } from './calendar.js';

const DAY = 864e5;
const nyDay = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const BROWSER_UA = 'Mozilla/5.0 (compatible; Paper-Terminal/1.0; personal paper-trading dashboard)';
const secUA = () => env('SEC_USER_AGENT');
// SEC fair access: at most 10 requests a second. Every sec.gov call waits for its slot (one every 110 ms).
let secNext = 0;
const secSlot = async () => { const t = Math.max(Date.now(), secNext); secNext = t + 110; if (t > Date.now()) await new Promise(r => setTimeout(r, t - Date.now())); };
async function getText(url, headers = {}, ms = 6000) {
  if (/(^|\.)sec\.gov$/.test(new URL(url).hostname)) await secSlot();
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { 'user-agent': BROWSER_UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.8', ...headers } });
    if (!r.ok) throw new Error(`${r.status} from ${new URL(url).hostname}`);
    return await r.text();
  } catch (e) { throw e.name === 'AbortError' ? new Error(`timeout from ${new URL(url).hostname}`) : e; }
  finally { clearTimeout(timer); }
}

// ---------------- tiny RSS / Atom reader (no npm) ----------------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', reg: '®', trade: '™', copy: '©' };
export const unxml = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? (() => { try { return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)); } catch { return m; } })() : ENT[e.toLowerCase()] ?? m);
const strip = (s) => unxml(unxml(s).replace(/<[^>]*>/g, ' ')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
export function parseFeed(xml) {
  const out = [], re = /<(item|entry)\b[\s\S]*?<\/\1>/gi; let m;
  while ((m = re.exec(String(xml || '')))) {
    const x = m[0], tag = (n) => { const r = new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)</${n}>`, 'i').exec(x); return r ? r[1] : ''; };
    const href = (/<link\b[^>]*\bhref="([^"]+)"/i.exec(x) || [])[1];
    const cats = [...x.matchAll(/<category\b([^>]*)>([\s\S]*?)<\/category>|<category\b([^>]*)\/>/gi)].map(c => strip(c[2] || '') || unxml((/term="([^"]*)"/.exec(c[1] || c[3] || '') || [])[1] || '')).filter(Boolean);
    out.push({ title: strip(tag('title')), link: unxml(href || strip(tag('link'))).trim(), date: strip(tag('pubDate') || tag('updated') || tag('published') || tag('dc:date')),
      sum: strip(tag('description') || tag('summary') || tag('content')).slice(0, 700), cats, guid: strip(tag('guid') || tag('id')) });
  }
  return out;
}
const isoOf = (d) => { const t = Date.parse(d); return isFinite(t) ? new Date(t).toISOString() : new Date().toISOString(); };

// ---------------- tickers + catalyst tags ----------------
// "(NASDAQ: ABCD)", "(NYSE:XYZ)", "(NYSE American: ABC)", "(Cboe: X)". Canadian-only listings are left out (tickers can clash).
const EXCH = /\((?:NASDAQ|Nasdaq|NasdaqGS|NasdaqGM|NasdaqCM|NYSE|NYSE American|NYSE Arca|NYSE MKT|NYSEAMERICAN|Cboe|CBOE|OTCQX|OTCQB|OTC)\s*[:：]\s*([A-Z][A-Z]{0,4}(?:\.[A-Z])?)\s*[;,)]/g;
export const tickersIn = (s) => [...new Set([...String(s || '').matchAll(EXCH)].map(m => m[1]))].slice(0, 6);
// Law-firm "investor alert" releases flood the wires (class-action solicitations). They are noise, not news about the business.
const LAWFIRM = /(rosen law|pomerantz|levi\s*&\s*korsinsky|bronstein|glancy prongay|faruqi|kessler topaz|robbins geller|bragar eagel|schall law|the gross law|frank r\. cruz|kirby mcinerney|holzer|investor alert|shareholder alert|investors? who (lost|purchased)|lead plaintiff deadline|class action (lawsuit )?(has been )?filed|securities (fraud )?class action|reminds investors)/i;
export const CATS = [
  ['beat', 1, /\b(beats?|tops|topped|above (analyst )?(estimates|expectations|consensus)|record (revenue|quarter|sales)|raise[sd]? (its )?(full[- ]year |fy\d* |annual )?(guidance|outlook|forecast))\b/i],
  ['miss', -1, /\b(miss(es|ed)?|below (analyst )?(estimates|expectations|consensus)|(cuts?|lowers?|lowered|slash(es|ed)?|withdraws?) (its )?(full[- ]year |fy\d* |annual )?(guidance|outlook|forecast)|profit warning)\b/i],
  ['earnings', 0, /\b(earnings|quarterly results|financial results|(first|second|third|fourth)[- ]quarter (20\d\d )?results|Q[1-4] (20\d\d |fy\d* )?results|EPS)\b/i],
  ['upgrade', 1, /\b(upgrade[sd]?|raised to (buy|outperform|overweight)|initiat\w+ (at|with) (a )?(buy|outperform|overweight)|price target (raised|increased|hiked|boosted))\b/i],
  ['downgrade', -1, /\b(downgrade[sd]?|cut to (sell|underperform|underweight|neutral|hold|equal[- ]weight)|price target (cut|lowered|reduced|slashed))\b/i],
  ['offering', -1, /\b((public|secondary|follow-on|common stock|stock|share|equity|registered direct|underwritten) offering|at[- ]the[- ]market (equity )?(offering|program)|pric(es|ed|ing) (of )?(its |an |a )?(upsized )?(public )?(offering|private placement)|private placement|convertible (senior )?notes offering|dilut\w+)\b/i],
  ['mna', 0, /\b(to acquire|acquires|acquired by|acquisition of|agreed to (buy|acquire)|merger (agreement|with)|to be acquired|takeover|buyout|tender offer|go(ing)?[- ]private)\b/i],
  ['buyback', 1, /\b(buyback|share repurchase|repurchase (program|authorization))\b/i],
  ['dividend', 0, /\bdividends?\b/i],
  ['fda', 0, /\b(FDA|PDUFA|phase (1|2|3|i|ii|iii) (trial|study|data)|clinical (trial|hold)|breakthrough therapy|approval of)\b/i],
  ['legal', -1, /\b(lawsuit|sued|sues|subpoena|investigation|probe|charged|indicted|antitrust|recall|wells notice)\b/i],
  ['exec', 0, /\b(CEO|CFO|chief executive|chief financial)( officer)? (resigns?|steps? down|departs?|to step down|to depart|retires?|is out|ousted|appointed|named)\b/i],
  ['bankrupt', -1, /\b(bankruptcy|chapter 11|going concern|delist(ed|ing)?)\b/i],
  ['layoffs', -1, /\b(layoffs?|job cuts|cut(ting)? \d[\d,]* jobs|workforce reduction)\b/i],
  ['macro', 0, /\b(FOMC|Federal Reserve|the Fed|Powell|CPI|consumer price|inflation|jobs report|payrolls|unemployment rate|GDP|tariffs?|Treasury yields?|rate (cut|hike)s?)\b/i],
];
export const CAT_LABEL = { beat: 'beat / raised outlook', miss: 'miss / cut outlook', earnings: 'earnings', upgrade: 'upgrade', downgrade: 'downgrade', offering: 'share offering', mna: 'M&A', buyback: 'buyback', dividend: 'dividend',
  fda: 'FDA / trial', legal: 'legal', exec: 'exec change', bankrupt: 'bankruptcy / delisting', layoffs: 'layoffs', macro: 'macro', restatement: 'restatement', agreement: 'material agreement', auditor: 'auditor change', impairment: 'impairment', regfd: 'investor update', other: 'other event', lawfirm: 'law-firm ad' };
// 8-K item numbers -> tag and tone (SEC Form 8-K items)
export const ITEM8K = { '1.01': ['agreement', 0], '1.03': ['bankrupt', -1], '2.01': ['mna', 0], '2.02': ['earnings', 0], '2.05': ['layoffs', -1], '2.06': ['impairment', -1], '3.01': ['bankrupt', -1],
  '3.02': ['offering', -1], '4.01': ['auditor', -1], '4.02': ['restatement', -1], '5.02': ['exec', 0], '7.01': ['regfd', 0], '8.01': ['other', 0] };
export function classify(text) {
  if (LAWFIRM.test(text)) return { cats: ['lawfirm'], tone: 0, noise: true };
  const cats = [], tones = []; for (const [k, t, re] of CATS) if (re.test(text)) { cats.push(k); tones.push(t); }
  const tone = Math.max(-2, Math.min(2, tones.reduce((a, t) => a + t, 0)));
  return { cats, tone, noise: false };
}
const tagItem = (x) => { const c = classify(`${x.h} ${x.sum || ''}`); return { ...x, cats: [...new Set([...(x.cats || []), ...c.cats])], tone: (x.tone || 0) + c.tone, noise: c.noise }; };

// ---------------- SEC: ticker map, latest 8-Ks, per-company filing history ----------------
let TICK = null;
async function tickerMaps() {
  if (TICK && Date.now() - TICK.at < DAY) return TICK;
  const j = JSON.parse(await getText('https://www.sec.gov/files/company_tickers.json', { 'user-agent': secUA(), accept: 'application/json' }, 8000));
  const byCik = new Map(), byTicker = new Map();
  for (const v of Object.values(j)) { if (!byCik.has(v.cik_str)) byCik.set(v.cik_str, v.ticker); byTicker.set(v.ticker, v.cik_str); }
  return (TICK = { at: Date.now(), byCik, byTicker });
}
export const itemsText = (items) => items.filter(i => i !== '9.01').map(i => CAT_LABEL[ITEM8K[i]?.[0]] || `item ${i}`).join(', ') || 'exhibits';
// v0.15.0: shared with lib/fundamentals.js (SEC XBRL company facts): the company's CIK and a JSON read from data.sec.gov with the
// SEC User-Agent and the 10-a-second pacing above. null when SEC_USER_AGENT is not set or the ticker is not in SEC's list.
export async function cikFor(sym) { if (!secUA()) return null; const T = await tickerMaps(); return T.byTicker.get(sym) || null; }
export async function secJson(url, ms = 12000) { if (!secUA()) return null; return JSON.parse(await getText(url, { 'user-agent': secUA(), accept: 'application/json' }, ms)); }
export async function edgar8k() {
  if (!secUA()) throw new Error('SEC_USER_AGENT is not set');
  const [xml, T] = await Promise.all([getText('https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&dateb=&owner=include&start=0&count=100&output=atom', { 'user-agent': secUA() }), tickerMaps()]);
  const out = [];
  for (const e of parseFeed(xml)) {
    const cik = +((/\((\d{4,10})\)/.exec(e.title) || [])[1] || 0), tk = cik ? T.byCik.get(cik) : null; if (!tk) continue; // listed companies only
    const items = [...new Set([...e.sum.matchAll(/Item (\d\.\d\d)/g)].map(m => m[1]))], name = e.title.replace(/^8-K(\/A)?\s*-\s*/, '').replace(/\s*\(\d+\)\s*\((Filer|Subject|Reporting)\)\s*$/i, '').trim();
    const tags = items.map(i => ITEM8K[i]).filter(Boolean);
    out.push({ id: 'sec-' + (e.guid || e.link), h: `${name} (${tk}) filed an 8-K: ${itemsText(items)}`, sum: '', src: 'SEC 8-K', kind: '8k', by: 'SEC EDGAR', t: isoOf(e.date), url: e.link, syms: [tk],
      items, cats: [...new Set(tags.map(x => x[0]))], tone: Math.max(-2, Math.min(2, tags.reduce((a, x) => a + x[1], 0))), noise: false });
  }
  return out;
}
const SUBS = new Map();
async function submissions(sym) {
  const c = SUBS.get(sym); if (c && Date.now() - c.at < 6 * 36e5) return c.v;
  const T = await tickerMaps(), cik = T.byTicker.get(sym); if (!cik) return null;
  const j = JSON.parse(await getText(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`, { 'user-agent': secUA(), accept: 'application/json' }, 8000));
  const r = j.filings?.recent || {}, v = (r.form || []).map((f, i) => ({ form: f, date: r.filingDate[i], items: String(r.items?.[i] || '').split(',').map(x => x.trim()).filter(Boolean),
    acc: r.accessionNumber?.[i] || null, doc: r.primaryDocument?.[i] || null })).slice(0, 400);
  // v0.13.0: every 8-K in the full recent list (up to ~1,000 filings) with its items and acceptance time (UTC), for the
  // Catalyst Scenario panel's past-reaction study. The 400-filing slice above can hold as little as a year for busy filers.
  v.k8 = (r.form || []).map((f, i) => f.startsWith('8-K') ? { date: r.filingDate[i], at: r.acceptanceDateTime?.[i] || null, items: String(r.items?.[i] || '').split(',').map(x => x.trim()).filter(Boolean) } : null).filter(Boolean);
  v.cik = cik; v.sic = j.sicDescription || null; v.name = j.name || null; SUBS.set(sym, { at: Date.now(), v }); return v;
}
// v0.13.0: past earnings reports (newest first) with when they came out (before the open, during the session or after the close,
// from the 8-K acceptance time in ET) and the next report date (an estimate: same quarter last year + 364 days, else last + 91).
export async function earningsInfo(sym, { now = Date.now() } = {}) {
  if (!secUA()) return { status: 'off', past: [], next: null, cik: null };
  const S = await submissions(sym).catch(() => null); if (!S) return { status: 'failed', past: [], next: null, cik: null };
  const et = (iso) => { if (!iso) return null; const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date(iso)); const h = +p.find(x => x.type === 'hour').value % 24, m = +p.find(x => x.type === 'minute').value; return h + m / 60; };
  const seen = new Set(), past = [];
  for (const x of (S.k8 || []).filter(x => x.items.includes('2.02'))) { if (seen.has(x.date)) continue; seen.add(x.date); const h = et(x.at); past.push({ date: x.date, when: h == null ? '?' : h < 9.5 ? 'before open' : h >= 16 ? 'after close' : 'during session' }); }
  past.sort((a, z) => z.date.localeCompare(a.date));
  let next = null;
  if (past.length) { const today = nyDay(now), last = Date.parse(past[0].date), yearAgo = past.find(p => (now - Date.parse(p.date)) / DAY >= 340 && (now - Date.parse(p.date)) / DAY <= 390);
    const est = new Date(yearAgo ? Date.parse(yearAgo.date) + 364 * DAY : last + 91 * DAY).toISOString().slice(0, 10); if (est >= nyDay(now - 10 * DAY)) next = { date: est, estimated: true, inDays: Math.round((Date.parse(est) - Date.parse(today)) / DAY) }; }
  return { status: 'ok', past, next, cik: S.cik, k8: S.k8 || [], sic: S.sic || null, name: S.name || null };
}
// v0.13.0: SEC full-text search (efts.sec.gov, free, same User-Agent rule) for one company's filings (8-Ks and their press-release
// exhibits) that contain a phrase. Returns [{ date, items, type }] newest first. Filings that are earnings releases (item 2.02)
// are marked so catalyst studies can leave them out.
export async function secSearch(cik, q, { from, to, forms = '8-K' } = {}) {
  if (!secUA() || !cik) return null;
  const u = new URLSearchParams({ q, forms, ciks: String(cik).padStart(10, '0'), dateRange: 'custom', startdt: from, enddt: to || nyDay(Date.now()) });
  const j = JSON.parse(await getText('https://efts.sec.gov/LATEST/search-index?' + u, { 'user-agent': secUA(), accept: 'application/json' }, 8000));
  const seen = new Map();
  for (const h of j.hits?.hits || []) { const x = h._source || {}, d = x.file_date; if (!d) continue; const it = x.items || [], prev = seen.get(d);
    seen.set(d, { date: d, items: [...new Set([...(prev?.items || []), ...it])], type: x.file_type || x.form, earnings: (prev?.earnings || false) || it.includes('2.02') }); }
  return [...seen.values()].sort((a, z) => z.date.localeCompare(a.date));
}
// Form 4 (insider trades): officers' and directors' open-market purchases (code P) and sales (code S), in dollars.
// Buying with their own money is the signal studies keep finding; routine sales (taxes, 10b5-1 plans) mean much less.
const F4 = new Map();
export function parseForm4(xml) {
  const rel = /<(isDirector|isOfficer)>\s*(1|true)\s*</i.test(xml); let buy = 0, sell = 0;
  for (const m of String(xml).matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/gi)) {
    const t = m[1], code = (/<transactionCode>\s*([A-Z])\s*</i.exec(t) || [])[1], num = (tag) => +((new RegExp(`<${tag}>\\s*<value>\\s*([\\d.]+)`, 'i').exec(t) || [])[1] || 0);
    const usd = num('transactionShares') * num('transactionPricePerShare'); if (code === 'P') buy += usd; else if (code === 'S') sell += usd;
  }
  return { rel, buy: Math.round(buy), sell: Math.round(sell) };
}
async function form4(cik, f) {
  if (F4.has(f.acc)) return F4.get(f.acc);
  const doc = String(f.doc || '').replace(/^xslF345X\d+\//i, ''); // primaryDocument points at the styled copy; the raw XML sits one folder up
  const v = parseForm4(await getText(`https://www.sec.gov/Archives/edgar/data/${cik}/${String(f.acc).replace(/-/g, '')}/${doc}`, { 'user-agent': secUA(), accept: 'application/xml, text/xml' }, 6000));
  F4.set(f.acc, v); return v;
}

// ---------------- press-release wires + Fed ----------------
export const WIRES = {
  gnw: { label: 'GlobeNewswire', kind: 'pr', url: 'https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire%20-%20News%20about%20Public%20Companies' },
  prn: { label: 'PR Newswire', kind: 'pr', url: 'https://www.prnewswire.com/rss/news-releases-list.rss' },
  fed: { label: 'Federal Reserve', kind: 'fed', url: 'https://www.federalreserve.gov/feeds/press_all.xml' },
};
// A feed that just failed is skipped for 5 minutes, so one slow site can't hold up every News-tab refresh.
const DOWN = new Map();
async function wire(key) {
  const W = WIRES[key], d = DOWN.get(key); if (d && d.until > Date.now()) throw new Error(`${d.why} (retrying after ${new Date(d.until).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET)`);
  const xml = await getText(W.url).catch(e => { DOWN.set(key, { until: Date.now() + 3e5, why: e.message }); throw e; }); DOWN.delete(key);
  return parseFeed(xml).map(e => tagItem({ id: `${key}-${e.guid || e.link}`, h: e.title, sum: e.sum.slice(0, 400), src: W.label, kind: W.kind, by: W.label, t: isoOf(e.date), url: e.link,
    syms: W.kind === 'pr' ? tickersIn(`${e.title} ${e.sum}`) : [], cats: W.kind === 'fed' ? ['macro'] : [] }));
}
// ---------------- Benzinga via Alpaca ----------------
const benz = (n) => tagItem({ id: 'bz-' + n.id, h: n.headline, sum: (n.summary || '').slice(0, 400), src: n.source === 'benzinga' ? 'Benzinga' : (n.source || 'Benzinga'), kind: 'news', by: n.author, t: n.created_at, url: n.url, syms: (n.symbols || []).slice(0, 8) });
export async function alpacaNews({ symbols = '', since = null, pages = 1 } = {}) {
  if (!hasAlpaca()) return [];
  const out = []; let token = '';
  for (let p = 0; p < pages; p++) {
    const q = new URLSearchParams({ limit: '50', sort: 'desc', include_content: 'false' }); if (symbols) q.set('symbols', symbols); if (since) q.set('start', new Date(since).toISOString()); if (token) q.set('page_token', token);
    const d = await alpaca('/v1beta1/news?' + q); out.push(...(d.news || []).map(benz)); token = d.next_page_token || ''; if (!token) break;
  }
  return out;
}

// ---------------- News tab: every source merged, newest first ----------------
const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 90);
export async function mergedNews({ symbols = '' } = {}) {
  const want = symbols ? new Set(symbols.split(',').filter(Boolean)) : null;
  const jobs = [['Benzinga', () => alpacaNews({ symbols })], ...(want ? [] : [['SEC 8-K', edgar8k], ['GlobeNewswire', () => wire('gnw')], ['PR Newswire', () => wire('prn')], ['Federal Reserve', () => wire('fed')]])];
  const res = await Promise.all(jobs.map(([src, f]) => f().then(items => ({ src, items })).catch(e => ({ src, items: [], error: e.message }))));
  const seen = new Set(), items = [];
  for (const x of res.flatMap(r => r.items).sort((a, z) => Date.parse(z.t) - Date.parse(a.t))) { const k = norm(x.h); if (!k || seen.has(k)) continue; seen.add(k); items.push(x); }
  return { items: items.slice(0, 160), sources: res.map(r => ({ src: r.src, n: r.items.length, error: r.error || null })) };
}

// ---------------- Market Brief · last 24 hours ----------------
const isStock = (s) => /^[A-Z]{1,5}(\.[A-Z])?$/.test(s) && !/USD[CT]?$/.test(s);
const pctTxt = (v) => v == null ? '' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`;
// A plain-English read built from the tags + the price reaction. Deliberately hedged: these are tendencies, not promises.
export function implication(g) {
  const c = g.cats, mv = g.move, big = mv != null && Math.abs(mv) >= 3, parts = [];
  if (g.tone > 0 && mv != null && mv > 1) parts.push(`Good news and the stock agrees (${pctTxt(mv)}).`);
  else if (g.tone > 0 && mv != null && mv < -1) parts.push(`Positive headlines but the stock is down (${pctTxt(mv)}): the market may have expected more, or it was priced in.`);
  else if (g.tone < 0 && mv != null && mv < -1) parts.push(`Negative news confirmed by the price (${pctTxt(mv)}).`);
  else if (g.tone < 0 && mv != null && mv > 1) parts.push(`Bad headlines shrugged off (${pctTxt(mv)}), a sign buyers are in control.`);
  else if (big) parts.push(`A big move (${pctTxt(mv)}) and the headlines don't give one clear reason.`);
  else parts.push(mv == null ? 'No price reaction data.' : `Little price reaction so far (${pctTxt(mv)}).`);
  if (c.has('beat') || c.has('miss') || c.has('earnings')) parts.push('Earnings moves often keep drifting the same way for days after the report, but big gaps can also fade.');
  if (c.has('offering')) parts.push('Share offerings add supply; prices often sag toward the offer price for a few days.');
  if (c.has('upgrade') || c.has('downgrade')) parts.push('Analyst rating changes usually move a stock for a day or two.');
  if (c.has('mna')) parts.push('Deal news: a target tends to trade near the offer price; the buyer can go either way.');
  if (c.has('fda')) parts.push('Drug and trial news can gap a stock hard in either direction.');
  if (c.has('restatement') || c.has('bankrupt')) parts.push('Accounting or solvency trouble: high risk.');
  return parts.join(' ');
}
export async function marketBrief({ judge = null } = {}) {
  const since = Date.now() - DAY, calP = econCalendar({ days: 10 }).catch(e => ({ events: [], error: e.message }));
  const res = await Promise.all([['Benzinga', () => alpacaNews({ since, pages: 8 })], ['SEC 8-K', edgar8k], ['GlobeNewswire', () => wire('gnw')], ['PR Newswire', () => wire('prn')], ['Federal Reserve', () => wire('fed')]]
    .map(([src, f]) => f().then(items => ({ src, items })).catch(e => ({ src, items: [], error: e.message }))));
  const all = res.flatMap(r => r.items).filter(x => Date.parse(x.t) >= since), items = all.filter(x => !x.noise);
  const by = new Map();
  for (const x of items) for (const s of x.syms) { if (!isStock(s)) continue; const g = by.get(s) || { s, n: 0, tone: 0, cats: new Set(), items: [], srcs: new Set() }; g.n++; g.tone += x.tone; x.cats.forEach(k => g.cats.add(k)); g.items.push(x); g.srcs.add(x.src); by.set(s, g); }
  const pool = [...by.values()].sort((a, z) => z.n - a.n || z.cats.size - a.cats.size).slice(0, 60);
  const sn = await snapshots(pool.map(g => g.s)).catch(() => ({}));
  const hard = ['beat', 'miss', 'earnings', 'offering', 'mna', 'upgrade', 'downgrade', 'fda', 'restatement', 'bankrupt', 'buyback'];
  for (const g of pool) {
    const q = quoteOf(g.s, sn[g.s]); g.px = q?.p ?? null; g.move = q?.pct != null ? round(q.pct * 100, 2) : null; g.relVol = q?.v && sn[g.s]?.prevDailyBar?.v ? round(q.v / sn[g.s].prevDailyBar.v, 2) : null;
    g.score = Math.log2(1 + g.n) + Math.min(Math.abs(g.move || 0), 15) / 2.5 + (hard.some(k => g.cats.has(k)) ? 1.5 : 0) + (g.srcs.has('SEC 8-K') ? 0.5 : 0);
  }
  const top = pool.filter(g => g.px != null).sort((a, z) => z.score - a.score).slice(0, 10);
  let J = { mode: 'off', results: {} };
  if (judge) J = await judge(top.slice(0, 6).map(g => ({ s: g.s, state: { symbol: g.s, price_move_pct_last_session: g.move, volume_vs_prior_day: g.relVol, headline_count_24h: g.n,
    catalysts: [...g.cats].map(k => CAT_LABEL[k] || k), headlines: g.items.slice(0, 6).map(x => x.h) } }))).catch(() => ({ mode: 'error', results: {} }));
  const movers = top.map(g => {
    const heads = [...g.items].sort((a, z) => (z.cats.length - a.cats.length) || (Date.parse(z.t) - Date.parse(a.t))).slice(0, 3).map(x => ({ h: x.h, url: x.url, src: x.src, t: x.t }));
    const jr = J.results?.[g.s]; return { s: g.s, n: g.n, tone: Math.max(-3, Math.min(3, g.tone)), cats: [...g.cats].filter(k => k !== 'macro').map(k => CAT_LABEL[k] || k), move: g.move, relVol: g.relVol, px: g.px,
      read: implication(g), heads, jev: jr && !jr.error ? { impact: jr.impact, dir: jr.dir, dirConf: jr.dirConf, priced: jr.priced, risk: jr.risk } : null };
  });
  const macro = all.filter(x => x.kind === 'fed' || (x.cats.includes('macro') && !x.syms.some(isStock))).sort((a, z) => Date.parse(z.t) - Date.parse(a.t)).slice(0, 6).map(x => ({ h: x.h, url: x.url, src: x.src, t: x.t }));
  const count = (k) => [...by.values()].filter(g => g.cats.has(k)).length;
  const up = movers.filter(m => m.move > 0).length, dn = movers.filter(m => m.move < 0).length;
  const lead = `Last 24 hours: ${items.length} headlines and filings from ${res.filter(r => r.items.length).length} sources (${all.length - items.length} law-firm ads skipped). ${count('earnings') + count('beat') + count('miss') ? `${new Set([...by.values()].filter(g => g.cats.has('earnings') || g.cats.has('beat') || g.cats.has('miss')).map(g => g.s)).size} companies with earnings news, ` : ''}${count('offering')} with share offerings, ${count('upgrade')} upgrades, ${count('downgrade')} downgrades. Of the ${movers.length} biggest news stocks, ${up} are up and ${dn} down.`;
  const cal = await calP;
  return { at: new Date().toISOString(), lead, movers, macro, jev: J.mode, calendar: { events: cal.events.slice(0, 12), error: cal.error || null }, sources: res.map(r => ({ src: r.src, n: r.items.length, error: r.error || null })) };
}

// ---------------- the stock bot: news features per candidate (shadow) ----------------
// n24/n72 headline counts, tone, tags from Benzinga (72 h) + SEC filing history: last earnings 8-K (item 2.02) -> estimated
// next report (same quarter last year + 364 days, else last + 91), recent offerings (8-K 3.02 or a 424B prospectus), restatements.
// v0.11.0 adds: insider buying/selling from Form 4 (last 30 days, newest 3 filings per stock) and the economic calendar
// (CPI, jobs report or Fed decision today or tomorrow).
export async function newsFeatures(syms, { now = Date.now() } = {}) {
  syms = syms.filter(isStock); if (!syms.length) return {};
  const pool = async (list, n, f) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < list.length) await f(list[i++]); })); };
  const [heads, subs, cal] = await Promise.all([
    alpacaNews({ symbols: syms.join(','), since: now - 3 * DAY, pages: 3 }).catch(() => null), // v0.12.1: null = the lookup failed (unknown), [] = really no headlines
    (async () => { const out = {}; if (!secUA()) return out; await pool(syms, 4, async (s) => { out[s] = await submissions(s).catch(() => null); }); return out; })(),
    econCalendar({ now }).catch(() => null),
  ]);
  const headsOk = Array.isArray(heads), H = headsOk ? heads : [], ev = eventRisk(cal, now), ins = {};
  const f4s = syms.flatMap(s => (subs[s] || []).filter(x => x.form === '4' && x.acc && x.doc && Date.parse(x.date) >= Date.parse(nyDay(now)) - 30 * DAY).slice(0, 3).map(x => ({ s, x })));
  await pool(f4s, 4, async ({ s, x }) => { const r = await form4(subs[s].cik, x).catch(() => null); const a = ins[s] || (ins[s] = { buyUsd: 0, sellUsd: 0, buys: 0, filings: 0, read: 0 }); a.filings++; if (!r) return; a.read++; if (r.rel && r.buy) { a.buyUsd += r.buy; a.buys++; } if (r.rel) a.sellUsd += r.sell; });
  const F = {};
  for (const s of syms) {
    const mine = H.filter(x => x.syms.includes(s) && !x.noise), h24 = mine.filter(x => Date.parse(x.t) >= now - DAY), within = (x, h) => Date.parse(x.t) >= now - h * 36e5;
    const has = (k, h = 72) => mine.some(x => within(x, h) && x.cats.includes(k));
    const f = { n24: h24.length, n72: mine.length, tone: Math.max(-3, Math.min(3, mine.filter(x => within(x, 48)).reduce((a, x) => a + x.tone, 0))),
      cats: [...new Set(mine.flatMap(x => x.cats))].filter(k => k !== 'macro'), heads: mine.slice(0, 3).map(x => x.h),
      downgrade: has('downgrade', 48), upgrade: has('upgrade', 48), beat: has('beat'), miss: has('miss'), legal: has('legal'), offering: has('offering'), earnIn: null, earnAgo: null, restated: false, sec: !!subs[s],
      insider: ins[s] || null, event: ev.length ? ev.map(e => `${e.name} ${e.when} ${e.time} ET`) : null,
      // v0.12.1: where each part came from. 'failed' / 'off' means unknown, never "nothing bad". Earnings dates are only ever estimates here.
      status: { headlines: headsOk ? 'ok' : 'failed', sec: !secUA() ? 'off' : subs[s] ? 'ok' : 'failed', calendar: cal ? 'ok' : 'failed' }, earnStatus: 'unknown' };
    const S = subs[s];
    if (S) {
      const days = (d) => Math.round((Date.parse(d) - Date.parse(nyDay(now))) / DAY); // filing dates are whole ET days
      const e8 = S.filter(x => x.form.startsWith('8-K') && x.items.includes('2.02')).map(x => x.date).sort().reverse();
      if (e8.length) {
        f.earnAgo = -days(e8[0]); const yearAgo = e8.find(d => -days(d) >= 340 && -days(d) <= 390);
        const est = yearAgo ? Date.parse(yearAgo) + 364 * DAY : Date.parse(e8[0]) + 91 * DAY; f.earnIn = Math.round((est - Date.parse(nyDay(now))) / DAY); f.earnEst = new Date(est).toISOString().slice(0, 10); f.earnStatus = 'estimated';
        if (f.earnIn < -10) { f.earnIn = null; f.earnStatus = 'unknown'; } // estimate already passed without a report: unknown
      }
      if (S.some(x => (x.form.startsWith('8-K') && x.items.includes('3.02') && -days(x.date) <= 10) || (/^424B[1-5]/.test(x.form) && -days(x.date) <= 4))) f.offering = true;
      if (S.some(x => x.form.startsWith('8-K') && (x.items.includes('4.02') || x.items.includes('1.03')) && -days(x.date) <= 30)) f.restated = true;
    }
    F[s] = f;
  }
  return F;
}
// Rules a news gate would apply (shadow now). Letters go into the order id: -n<headlines 24h, max 9><flags>[w<Jev news 0-9>]
//   E earnings expected within 3 days  R reported in the last 2 days  O share offering  D downgrade (48 h)  U upgrade (48 h)
//   B beat / raised outlook  M miss / cut outlook  L legal  X restatement or bankruptcy  P positive tone  N negative tone
//   C CPI, jobs report or Fed decision today or tomorrow (v0.11.0)  I officers/directors bought $10k+ on the open market in 30 days (v0.11.0)
//   Q (v0.12.1) the headline or SEC lookup failed, so the news is unknown (not "no bad news")
// Skip on E O X D M. Half size on N L C Q. I is recorded only, so the scorecard can show whether it helps before it changes anything.
export const INSIDER_MIN = 1e4;
export function newsVerdict(f) {
  if (!f) return { act: 'none', why: null, tag: '' };
  const fl = [];
  if (f.earnIn != null && f.earnIn >= 0 && f.earnIn <= 3) fl.push('E'); if (f.earnAgo != null && f.earnAgo <= 2) fl.push('R');
  if (f.offering) fl.push('O'); if (f.downgrade) fl.push('D'); if (f.upgrade) fl.push('U'); if (f.beat) fl.push('B'); if (f.miss) fl.push('M'); if (f.legal) fl.push('L'); if (f.restated) fl.push('X');
  if (f.tone > 0) fl.push('P'); if (f.tone < 0) fl.push('N'); if (f.event?.length) fl.push('C'); if (f.insider?.buyUsd >= INSIDER_MIN) fl.push('I');
  if (f.status && (f.status.headlines === 'failed' || f.status.sec === 'failed')) fl.push('Q');
  const veto = fl.includes('E') ? `earnings expected in ~${f.earnIn} day${f.earnIn === 1 ? '' : 's'} (${f.earnEst}, estimated from SEC filings)` : fl.includes('O') ? 'share offering in the last few days' : fl.includes('X') ? 'restatement or bankruptcy filing' : fl.includes('D') ? 'analyst downgrade in the last 48 h' : fl.includes('M') ? 'missed or cut its outlook' : null;
  const caution = veto ? null : fl.includes('L') ? 'legal headline' : fl.includes('N') ? 'negative headlines' : fl.includes('C') ? `market-moving release: ${f.event.join(', ')}` : fl.includes('Q') ? `news unknown (${f.status.headlines === 'failed' ? 'headline' : 'SEC'} lookup failed)` : null;
  return { act: veto ? 'skip' : caution ? 'half' : 'ok', why: veto || caution, tag: `-n${Math.min(9, f.n24)}${fl.join('')}` };
}
export const newsTag = (f, jevNews) => { const v = newsVerdict(f); return v.tag ? v.tag + (jevNews != null ? `w${Math.max(0, Math.min(9, Math.round(jevNews * 9)))}` : '') : ''; };
const NEWS_RE = /-n(\d)([EROUDBMLXPNCIQ]*)(?:w(\d))?(?=-|$)/;
export function parseNewsTag(coid) {
  if (!String(coid || '').startsWith('tbbot-')) return null; const m = NEWS_RE.exec(coid); if (!m) return null;
  const fl = m[2].split(''), veto = ['E', 'O', 'X', 'D', 'M'].find(x => fl.includes(x)) || null;
  return { n24: +m[1], flags: fl, veto, caution: !veto && ['N', 'L', 'C', 'Q'].some(x => fl.includes(x)), jevNews: m[3] != null ? +m[3] / 9 : null };
}
const FLAG_TXT = { E: 'earnings due within 3 days', R: 'just reported earnings', O: 'share offering', D: 'downgrade', U: 'upgrade', B: 'beat / raised outlook', M: 'miss / cut outlook', L: 'legal headline', X: 'restatement / bankruptcy', P: 'positive tone', N: 'negative tone',
  C: 'CPI / jobs report / Fed decision today or tomorrow', I: 'insiders bought shares in the last 30 days', Q: 'news unknown (a lookup failed)' };
export const newsTagText = (t) => !t ? null : `News at entry (shadow): ${t.n24} headline${t.n24 === 1 ? '' : 's'} in 24 h${t.flags.length ? ' · ' + t.flags.map(f => FLAG_TXT[f]).join(', ') : ''}${t.jevNews != null ? ` · Jev: news supports buying ${Math.round(t.jevNews * 100)}%` : ''} → ${t.veto ? 'the news rule would have SKIPPED this trade' : t.caution ? 'the news rule would have used half size' : 'the news rule was fine with it'}.`;
// What Jev sees about the news for a stock entry (numbers + up to 3 headlines).
// v0.12.1: a failed lookup is sent as null plus data_status, so Jev is told the news is unknown instead of "0 headlines".
export const newsState = (f) => { if (!f) return null; const hOk = !f.status || f.status.headlines === 'ok', sOk = !f.status || f.status.sec === 'ok';
  return { data_status: f.status || null, headlines_24h: hOk ? f.n24 : null, headlines_72h: hOk ? f.n72 : null, tone_48h: hOk ? f.tone : null, catalysts: hOk ? f.cats.map(k => CAT_LABEL[k] || k) : null,
  earnings_date_status: sOk ? f.earnStatus || 'unknown' : 'unknown', earnings_in_days_est: f.earnIn, days_since_earnings: f.earnAgo,
  offering_recent: sOk || hOk ? !!f.offering : null, downgrade_48h: hOk ? !!f.downgrade : null, upgrade_48h: hOk ? !!f.upgrade : null, recent_headlines: hOk ? f.heads : null,
  insider_open_market_buys_usd_30d: f.insider ? f.insider.buyUsd : null, insider_sales_usd_30d: f.insider ? f.insider.sellUsd : null, market_moving_releases_soon: f.status?.calendar === 'failed' ? null : f.event || [] }; };
export const newsMode = () => env('NEWS_MODE') === 'gate' ? 'gate' : env('NEWS_MODE') === 'off' ? 'off' : 'shadow';
