// Shared helpers for all API routes. No dependencies: Node 20+ fetch + crypto.
import { createHash, createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export const DATA = 'https://data.alpaca.markets';
export const PAPER = 'https://paper-api.alpaca.markets';

export const env = (k) => (process.env[k] || '').trim();
export const hasAlpaca = () => !!(env('ALPACA_KEY_ID') && env('ALPACA_SECRET_KEY'));

// ---------- auth (v0.17.0) ----------
// Two credentials, both derived from DASH_PASSCODE plus a server-only secret (CRON_SECRET), so a stolen value cannot be used
// to guess the passcode offline, and changing the passcode signs every device out:
// 1. Session cookie `__Host-tb_s` (HttpOnly, Secure, SameSite=Strict, 7 days): issued by POST /api/session after the passcode is
//    checked (wrong tries are locked out, lib/authguard.js). Required for everything account-related (`strict` routes).
// 2. Market-data key `x-tb-gate` (a request header, not a cookie): an HMAC of today's New York date, handed out by /api/session
//    only to a signed-in device. Market routes are cached on Vercel's CDN, which cannot key on cookies, so their cache is keyed
//    on this header instead (`Vary: x-tb-gate`): a cached answer is only ever served to a request that carries today's key.
//    It unlocks market data only (never the account) and changes every day. The old `?k=` URL token is gone.
export const SESSION = { cookie: '__Host-tb_s', days: 7, gateHeader: 'x-tb-gate' };
const h256 = (s) => createHash('sha256').update(String(s)).digest();
export const safeEq = (a, b) => timingSafeEqual(h256(a), h256(b)); // constant time, any lengths
export const cronOk = (req) => !!env('CRON_SECRET') && safeEq(req.headers.get('authorization') || '', `Bearer ${env('CRON_SECRET')}`);
const skey = () => createHmac('sha256', 'tb-session-v1').update(`${env('DASH_PASSCODE')}\n${env('CRON_SECRET')}`).digest();
const mac = (s) => createHmac('sha256', skey()).update(s).digest('base64url');
export function sessionToken(now = Date.now()) {
  const exp = Math.floor(now / 1000) + SESSION.days * 86400, nonce = randomBytes(12).toString('base64url');
  return { value: `${exp}.${nonce}.${mac(`s1.${exp}.${nonce}`)}`, exp };
}
export function sessionCookie(value, maxAge = SESSION.days * 86400) {
  return `${SESSION.cookie}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}
export const gateFor = (day = nyDate(Date.now())) => mac(`g1.${day}`).slice(0, 32);
function readCookie(req, name) {
  for (const part of (req.headers.get('cookie') || '').split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim(); }
  return '';
}
export function sessionOf(req) {
  const [exp, nonce, sig, extra] = readCookie(req, SESSION.cookie).split('.');
  if (!exp || !nonce || !sig || extra !== undefined || !/^\d{9,11}$/.test(exp)) return null;
  if (+exp * 1000 <= Date.now()) return null;
  return safeEq(sig, mac(`s1.${exp}.${nonce}`)) ? { exp: +exp } : null;
}
export function gateOk(req) {
  const g = req.headers.get(SESSION.gateHeader) || ''; if (!g) return false;
  const now = Date.now(); // today's key, or yesterday's for a page left open across midnight
  return safeEq(g, gateFor(nyDate(now))) || safeEq(g, gateFor(nyDate(now - 864e5)));
}
// strict: account, orders, bot controls, anything that is not public market data -> the session cookie.
// not strict: market data -> the day's market-data key (a signed-in page always sends both).
export function authorized(req, { strict = false } = {}) {
  if (!env('DASH_PASSCODE')) return !strict; // no passcode set: market data open, account locked
  return strict ? !!sessionOf(req) : gateOk(req);
}

// Vercel's waitUntil (the same hook @vercel/functions uses; no dependency): lets a function answer now and keep working.
// Returns null outside Vercel (tests, local), where callers simply await the work.
export const waitUntilFn = () => { const c = globalThis[Symbol.for('@vercel/request-context')]?.get?.(); return typeof c?.waitUntil === 'function' ? (p) => c.waitUntil(p) : null; };

// ---------- responses ----------
export function json(data, { status = 200, cache = 0, swr = 0, priv = false } = {}) {
  const h = { 'content-type': 'application/json; charset=utf-8' };
  if (priv || !cache) h['cache-control'] = 'private, no-store';
  else { h['cache-control'] = `public, s-maxage=${cache}, stale-while-revalidate=${swr || cache * 4}`; h.vary = SESSION.gateHeader; } // cached copies are keyed on the market-data key
  return new Response(JSON.stringify(data), { status, headers: h });
}
export const denied = () => json({ error: 'locked', message: 'Enter your passcode in Settings.' }, { status: 401 });
export const needKeys = (what = 'this panel') =>
  json({ error: 'no_keys', message: `Add ALPACA_KEY_ID and ALPACA_SECRET_KEY in Vercel → Settings → Environment Variables to turn on ${what}.` }, { status: 200, cache: 30 });
export function fail(e, where) {
  console.error(where, e && e.stack || e);
  return json({ error: 'upstream', message: String(e && e.message || e).slice(0, 300) }, { status: 502 });
}

// ---------- fetch ----------
async function getJSON(url, headers = {}, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { headers });
    if (r.ok) return r.json();
    last = new Error(`${r.status} ${url.split('?')[0].replace(/^https?:\/\//, '')}: ${(await r.text()).slice(0, 160)}`);
    if (r.status !== 429 && r.status < 500) break;
    await new Promise(res => setTimeout(res, (r.status === 429 ? 2000 : 600) * (i + 1))); // 429: Alpaca's per-minute limit, wait longer
  }
  throw last;
}
const alpacaHeaders = () => ({ 'APCA-API-KEY-ID': env('ALPACA_KEY_ID'), 'APCA-API-SECRET-KEY': env('ALPACA_SECRET_KEY') });
export const alpaca = (path, auth = true) => getJSON(DATA + path, auth && hasAlpaca() ? alpacaHeaders() : {});
export const paper = (path) => getJSON(PAPER + path, alpacaHeaders());
export const plain = (url, headers) => getJSON(url, headers);

const qs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
export const isCrypto = (s) => s.includes('/');

// Bars with pagination. Returns {SYM:[{t,o,h,l,c,v,vw}]}. Stocks: many symbols per request (their pages hold 10,000 bars).
// Crypto (v0.12.2): one coin per request with every page followed (barRange), because Alpaca's crypto pages are much smaller
// (about 10,000 one-minute bars' worth: ~170 hourly bars, ~7 days) and shared by every coin in a request, so a multi-coin request
// with a page cap silently dropped most coins' history. Coins that fail are left out; the call only throws if every coin failed.
export async function bars(symbols, { timeframe = '1Day', days = 400, start, end, limitPages = 12 } = {}) {
  if (!symbols.length) return {};
  const crypto = isCrypto(symbols[0]);
  const s = start || new Date(Date.now() - days * 864e5).toISOString();
  const out = {};
  if (crypto) {
    const q = [...symbols], errs = [];
    await Promise.all(Array.from({ length: Math.min(4, q.length) }, async () => {
      while (q.length) { const sym = q.shift(); try { const r = await barRange(sym, { timeframe, start: s, end, maxPages: limitPages * 10 }); if (r.bars.length) out[sym] = r.bars; } catch (e) { errs.push(e); } }
    }));
    if (errs.length === symbols.length) throw errs[0];
    return out;
  }
  return stockBars(symbols, { timeframe, start: s, end, limitPages });
}

// ---------- stock feeds (v0.14.0, A1) ----------
// Alpaca's free plan: IEX = one exchange, real time (~2–3% of US volume, so its candles' highs, lows and volume differ from
// TradingView's); SIP = every US exchange (what TradingView shows), allowed up to 15 minutes ago. So candles come from SIP up to
// FEED.lagMin minutes ago and from IEX after that (those bars carry f:'i'); today's daily candle is the 15-minute-delayed SIP day
// (snapshot feed delayed_sip) with the newest IEX trade folded in. If Alpaca refuses SIP (plan change), everything falls back to
// IEX alone for FEED.offMin minutes, exactly as before v0.14.0.
export const FEED = { hist: 'sip', live: 'iex', delayed: 'delayed_sip', lagMin: 16, offMin: 10 };
const FS = { sipOff: 0, delayedOff: 0, lastError: null };
export const feedStatus = () => ({ sip: Date.now() >= FS.sipOff, delayed: Date.now() >= FS.delayedOff, lagMin: FEED.lagMin, lastError: FS.lastError });
export const feedReset = () => { FS.sipOff = 0; FS.delayedOff = 0; FS.lastError = null; }; // tests
const refused = (e) => /^(401|403|422) /.test(String(e?.message || ''));
const TFMS = { '1Min': 6e4, '5Min': 3e5, '15Min': 9e5, '30Min': 18e5, '1Hour': 36e5, '4Hour': 144e5 };
const nyDate = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
// true for a time inside the regular session (9:30 AM–4:00 PM New York, weekdays): only those trades belong in a daily candle
export function regularSession(ms) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms));
  const g = (k) => p.find(x => x.type === k)?.value, m = (+g('hour') % 24) * 60 + +g('minute');
  return !/Sat|Sun/.test(g('weekday')) && m >= 570 && m < 960;
}

async function stockPages(chunk, { timeframe, start, end, feed, limitPages }) {
  const out = {}; let token = '', pages = 0;
  do {
    const q = qs({ symbols: chunk.join(','), timeframe, start, end, limit: 10000, page_token: token, feed, adjustment: 'split' });
    const d = await alpaca(`/v2/stocks/bars?${q}`);
    for (const [k, arr] of Object.entries(d.bars || {})) (out[k] ||= []).push(...arr);
    token = d.next_page_token || ''; pages++;
  } while (token && pages < limitPages);
  return out;
}
// Newer bars win a tie on time, except a SIP bar that the IEX bar only extends (same start): keep the SIP open and volume,
// widen the high/low, take the IEX close.
export function stitch(sip = [], iex = []) {
  if (!iex.length) return sip;
  const lastT = sip.length ? Date.parse(sip.at(-1).t) : -Infinity, out = sip.slice();
  for (const b of iex) {
    const t = Date.parse(b.t);
    if (t < lastT) continue;
    if (t === lastT) { const S = out[out.length - 1]; out[out.length - 1] = { ...S, h: Math.max(S.h, b.h), l: Math.min(S.l, b.l), c: b.c }; continue; }
    out.push({ ...b, f: 'i' });
  }
  return out;
}
async function stockBars(symbols, { timeframe, start, end, limitPages }) {
  const now = Date.now(), cut = now - FEED.lagMin * 6e4, endMs = end ? Date.parse(end) : now, startMs = Date.parse(start);
  const chunks = []; for (let i = 0; i < symbols.length; i += 50) chunks.push(symbols.slice(i, i + 50));
  const iexOnly = () => Promise.all(chunks.map(c => stockPages(c, { timeframe, start, end, feed: FEED.live, limitPages }))).then(r => Object.assign({}, ...r));
  if (now < FS.sipOff || startMs >= cut) return iexOnly();
  let sip;
  try { sip = Object.assign({}, ...await Promise.all(chunks.map(c => stockPages(c, { timeframe, start, end: new Date(Math.min(endMs, cut)).toISOString(), feed: FEED.hist, limitPages })))); }
  catch (e) { if (!refused(e)) throw e; FS.sipOff = now + FEED.offMin * 6e4; FS.lastError = String(e.message).slice(0, 160); return iexOnly(); }
  if (endMs <= cut) return sip;
  const tfMs = TFMS[timeframe];
  if (tfMs) {
    // the newest ~15 minutes: IEX bars from the start of the bar that holds the cut
    const from = new Date(Math.floor(cut / tfMs) * tfMs).toISOString();
    const iex = Object.assign({}, ...await Promise.all(chunks.map(c => stockPages(c, { timeframe, start: from, end, feed: FEED.live, limitPages: 2 }).catch(() => ({})))));
    for (const s of symbols) { const x = stitch(sip[s] || [], iex[s] || []); if (x.length) sip[s] = x; }
    return sip;
  }
  if (timeframe === '1Day') {
    // today's candle: the delayed full-market day plus the newest IEX trade (both from snapshots(), which merges them)
    const sn = await snapshots(symbols).catch(() => ({})), today = nyDate(now);
    for (const s of symbols) {
      const d = sn[s]?.dailyBar; if (!d?.t || nyDate(Date.parse(d.t)) !== today || Date.parse(d.t) > endMs) continue;
      const arr = sip[s] ||= [], bar = { t: d.t, o: d.o, h: d.h, l: d.l, c: d.c, v: d.v, vw: d.vw, ...(sn[s].feed === FEED.live ? { f: 'i' } : {}) };
      if (arr.length && arr.at(-1).t === d.t) arr[arr.length - 1] = { ...arr.at(-1), ...bar }; else if (!arr.length || Date.parse(arr.at(-1).t) < Date.parse(d.t)) arr.push(bar);
    }
  }
  return sip; // 1Week and longer: SIP up to the cut; the chart route folds the latest trade into the last candle
}

// v0.12.2: one shared pacer for paged bar downloads. Alpaca's free market-data plan allows 200 requests a minute per account and
// the bots share it, so downloads run at 2 a second (short bursts of up to 30 are allowed, for normal page loads and bot runs).
export const PACE = { cap: 30, perSec: 2, tokens: 30, t: Date.now() };
export async function paced() {
  for (;;) {
    const now = Date.now(); PACE.tokens = Math.min(PACE.cap, PACE.tokens + (now - PACE.t) / 1000 * PACE.perSec); PACE.t = now;
    if (PACE.tokens >= 1) { PACE.tokens -= 1; return; }
    await new Promise(res => setTimeout(res, Math.ceil((1 - PACE.tokens) / PACE.perSec * 1000) + 5));
  }
}
// One symbol, one time range, every page (up to maxPages, or until the deadline; minPages are fetched even past it). start/end: ISO text or ms.
// Returns { bars, pages, done } (done = false: stopped early, so the bars end before `end`).
const isoOf = (x) => x == null || x === '' ? undefined : typeof x === 'number' ? new Date(x).toISOString() : x;
export async function barRange(sym, { timeframe = '1Day', start, end, maxPages = 400, deadline = Infinity, minPages = 0 } = {}) {
  const crypto = isCrypto(sym), out = []; let token = '', pages = 0;
  do {
    if (pages >= minPages && Date.now() > deadline) return { bars: out, pages, done: false };
    await paced();
    const sipOk = !crypto && Date.now() >= FS.sipOff, cutIso = new Date(Date.now() - FEED.lagMin * 6e4).toISOString();
    const e2 = crypto ? isoOf(end) : sipOk ? (isoOf(end) && isoOf(end) < cutIso ? isoOf(end) : cutIso) : isoOf(end);
    const q = qs({ symbols: sym, timeframe, start: isoOf(start), end: e2, limit: 10000, page_token: token, ...(crypto ? {} : { feed: sipOk ? FEED.hist : FEED.live, adjustment: 'split' }) });
    const d = await getJSON(DATA + (crypto ? `/v1beta3/crypto/us/bars?${q}` : `/v2/stocks/bars?${q}`), hasAlpaca() ? alpacaHeaders() : {}, 4);
    out.push(...(d.bars?.[sym] || [])); token = d.next_page_token || ''; pages++;
  } while (token && pages < maxPages);
  return { bars: out, pages, done: !token };
}

export async function snapshots(symbols) {
  if (!symbols.length) return {};
  const st = symbols.filter(s => !isCrypto(s)), cr = symbols.filter(isCrypto);
  const out = {};
  const jobs = [];
  if (cr.length) jobs.push(alpaca(`/v1beta3/crypto/us/snapshots?${qs({ symbols: cr.join(',') })}`, false).then(d => Object.assign(out, d.snapshots || {})));
  if (st.length && hasAlpaca()) {
    for (let i = 0; i < st.length; i += 100) {
      const chunk = st.slice(i, i + 100);
      const useDelayed = Date.now() >= FS.delayedOff;
      jobs.push(Promise.all([
        alpaca(`/v2/stocks/snapshots?${qs({ symbols: chunk.join(','), feed: FEED.live })}`),
        useDelayed ? alpaca(`/v2/stocks/snapshots?${qs({ symbols: chunk.join(','), feed: FEED.delayed })}`).catch(e => { if (refused(e)) { FS.delayedOff = Date.now() + FEED.offMin * 6e4; FS.lastError = String(e.message).slice(0, 160); } return null; }) : null,
      ]).then(([live, del]) => { const L = live.snapshots || live, D = del ? del.snapshots || del : {}; for (const s of chunk) { const m = mergeSnap(L[s], D[s]); if (m) out[s] = m; } }));
    }
  }
  await Promise.all(jobs);
  return out;
}
// v0.14.0: one snapshot from two feeds. Yesterday's close, today's open and volume = the full market (15 minutes delayed: the
// official numbers TradingView shows); the price = whichever trade is newer (IEX is real time); today's high/low = both widened by
// that trade. latestQuote and minuteBar stay IEX (real time). feed says which one the day came from.
export function mergeSnap(L, D) {
  if (!D?.dailyBar) return L ? { ...L, feed: FEED.live } : D ? { ...D, feed: FEED.delayed } : null;
  if (!L) return { ...D, feed: FEED.delayed };
  const tl = Date.parse(L.latestTrade?.t || 0), td = Date.parse(D.latestTrade?.t || 0), trade = tl >= td ? L.latestTrade : D.latestTrade;
  const dDay = nyDate(Date.parse(D.dailyBar.t)), lDay = L.dailyBar?.t ? nyDate(Date.parse(L.dailyBar.t)) : '';
  // first ~15 minutes of a session: the delayed feed still shows yesterday, so today's candle is IEX and yesterday's close is the official one
  if (lDay > dDay) return { ...L, latestTrade: trade, prevDailyBar: D.dailyBar, feed: FEED.live };
  const day = { ...D.dailyBar }, p = trade?.p;
  if (p != null && nyDate(Date.parse(trade.t)) === dDay && Date.parse(trade.t) >= td && regularSession(Date.parse(trade.t))) { day.h = Math.max(day.h, p); day.l = Math.min(day.l, p); day.c = p; }
  if (lDay === dDay) { day.h = Math.max(day.h, L.dailyBar.h); day.l = Math.min(day.l, L.dailyBar.l); }
  return { ...L, latestTrade: trade, dailyBar: day, prevDailyBar: D.prevDailyBar || L.prevDailyBar, feed: 'sip+iex' };
}

// Snapshot -> compact quote
export function quoteOf(sym, sn) {
  if (!sn) return null;
  const last = sn.latestTrade?.p ?? sn.minuteBar?.c ?? sn.dailyBar?.c;
  const prev = sn.prevDailyBar?.c;
  const day = sn.dailyBar || {};
  return {
    s: sym, p: last, prev, chg: prev ? last - prev : null, pct: prev ? last / prev - 1 : null,
    o: day.o, h: day.h, l: day.l, v: day.v, vw: day.vw, t: sn.latestTrade?.t || sn.minuteBar?.t || day.t,
    bid: sn.latestQuote?.bp, ask: sn.latestQuote?.ap, ...(sn.feed ? { feed: sn.feed } : {}),
  };
}

// ---------- indicators ----------
export const last = (a, n = 1) => a[a.length - n];
export function sma(a, n) { if (a.length < n) return null; let s = 0; for (let i = a.length - n; i < a.length; i++) s += a[i]; return s / n; }
export function rsi(c, n = 14) {
  if (c.length <= n + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
export function atr(b, n = 14) {
  if (b.length <= n + 1) return null;
  const tr = b.map((x, i) => i ? Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c)) : x.h - x.l);
  let a = tr.slice(1, n + 1).reduce((s, v) => s + v, 0) / n;
  for (let i = n + 1; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n;
  return a;
}
export function stdevRet(c, n) {
  if (c.length < n + 1) return null;
  const r = []; for (let i = c.length - n; i < c.length; i++) r.push(c[i] / c[i - 1] - 1);
  const m = r.reduce((s, v) => s + v, 0) / r.length;
  return Math.sqrt(r.reduce((s, v) => s + (v - m) ** 2, 0) / r.length);
}
export const round = (v, d = 2) => v == null || !isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- swing evaluation (daily bars) ----------
// Transparent rules. Returns null when there is no setup.
export function swingEval(sym, b, benchRet63 = 0, { riskDollars = 1000 } = {}) {
  if (!b || b.length < 210) return null;
  const c = b.map(x => x.c), v = b.map(x => x.v);
  const px = last(c), s20 = sma(c, 20), s50 = sma(c, 50), s200 = sma(c, 200), r = rsi(c), a = atr(b);
  if (!a || !s200) return null;
  const prior = b.slice(-21, -1);
  const hi20 = Math.max(...prior.map(x => x.h)), lo20 = Math.min(...prior.map(x => x.l));
  const avgV = prior.reduce((s, x) => s + x.v, 0) / prior.length;
  const volR = avgV ? last(v) / avgV : 1;
  const ret63 = c.length > 64 ? px / c[c.length - 64] - 1 : 0;
  const rs = ret63 - benchRet63;
  const hi52 = Math.max(...b.slice(-252).map(x => x.h));
  const trendUp = px > s50 && s50 > s200, trendDn = px < s50 && s50 < s200;
  const atrPct = a / px;

  let setup = null, dir = 'long', why = [];
  if (px > hi20 && volR >= 1.3 && px > s50) { setup = 'Breakout'; why.push(`closed above 20-day high ${hi20.toFixed(2)}`, `volume ${volR.toFixed(1)}× average`); }
  else if (trendUp && r >= 38 && r <= 52 && Math.abs(px - s20) <= a) { setup = 'Pullback'; why.push('uptrend: price > 50d > 200d', `RSI cooled to ${r.toFixed(0)}`, 'sitting near 20-day average'); }
  else if (px > s200 && r < 32) { setup = 'Oversold in uptrend'; why.push(`RSI ${r.toFixed(0)} while above 200-day`); }
  else if (px < lo20 && volR >= 1.3 && trendDn) { setup = 'Breakdown'; dir = 'short'; why.push(`closed below 20-day low ${lo20.toFixed(2)}`, `volume ${volR.toFixed(1)}×`, 'downtrend'); }
  if (!setup) return null;

  let score = { Breakout: 55, Pullback: 55, 'Oversold in uptrend': 45, Breakdown: 50 }[setup];
  score += clamp((dir === 'long' ? rs : -rs) * 100, -20, 20);
  if (dir === 'long' && trendUp) score += 10;
  if (dir === 'short' && trendDn) score += 10;
  if (volR > 1.5) score += 5;
  if (atrPct > 0.06) { score -= 10; why.push('very volatile (ATR > 6%)'); }
  if (setup === 'Breakout' && px / hi52 > 0.97) { score += 5; why.push('near 52-week high'); }
  score = clamp(Math.round(score), 0, 100);

  const riskPS = 1.5 * a;
  const stop = dir === 'long' ? px - riskPS : px + riskPS;
  const target = dir === 'long' ? px + 3 * a : px - 3 * a;
  const dp = px >= 1 ? 2 : 6, adp = px >= 20 ? 2 : 6; // keep precision for cheap coins/stocks (DOGE's ATR used to round to 0)
  return {
    s: sym, setup, dir, score, px: round(px, dp), stop: round(stop, dp), target: round(target, dp), rr: 2,
    shares: Math.max(0, Math.floor(riskDollars / riskPS)), units: round(riskDollars / riskPS, 4), atr: round(a, adp), atrPct: round(atrPct * 100, 1),
    rsi: round(r, 0), volR: round(volR, 1), rs63: round(rs * 100, 1), s20: round(s20, dp), s50: round(s50, dp), s200: round(s200, dp),
    why,
  };
}

// ---------- universes ----------
export const SWING_UNIVERSE = ('AAPL MSFT NVDA AMZN GOOGL META AVGO TSLA AMD NFLX ORCL CRM ADBE INTC QCOM MU TXN AMAT LRCX KLAC ' +
  'PANW CRWD SNOW PLTR NOW SHOP UBER ABNB COIN MSTR SMCI ARM ANET DELL ' +
  'JPM BAC WFC GS MS C SCHW V MA AXP PYPL ' +
  'UNH LLY JNJ PFE MRK ABBV TMO ISRG VRTX ' +
  'XOM CVX COP OXY SLB ' +
  'CAT DE BA GE HON LMT RTX UPS ' +
  'WMT COST HD LOW TGT NKE SBUX MCD KO PEP PG ' +
  'DIS CMCSA T VZ ' +
  'SPY QQQ IWM DIA XLK XLF XLE XLV XLI XLY XLP XLU SMH ARKK GLD SLV TLT').split(' ');
export const LONG_UNIVERSE = ('AAPL MSFT NVDA AMZN GOOGL META AVGO LLY V MA COST JPM UNH HD PG KO PEP JNJ XOM ' +
  'ORCL CRM ADBE NFLX ISRG NOW INTU AMD TXN QCOM CAT DE HON LMT MCD WMT ABBV MRK TMO SPGI BLK ' +
  'VOO VTI QQQ SCHD VXUS VIG').split(' ');
export const ETFS = new Set('SPY QQQ IWM DIA XLK XLF XLE XLV XLI XLY XLP XLU XLB XLRE XLC SMH ARKK GLD SLV TLT IEF HYG UUP USO VIXY VOO VTI SCHD VXUS VIG'.split(' '));
export const CRYPTO_UNIVERSE = 'BTC/USD ETH/USD SOL/USD XRP/USD DOGE/USD AVAX/USD LINK/USD LTC/USD BCH/USD DOT/USD UNI/USD AAVE/USD SHIB/USD XTZ/USD'.split(' ');
export const BOARD = {
  indices: ['SPY', 'QQQ', 'DIA', 'IWM'],
  sectors: ['XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLY', 'XLP', 'XLU', 'XLB', 'XLRE', 'XLC', 'SMH'],
  cross: ['TLT', 'IEF', 'HYG', 'UUP', 'GLD', 'SLV', 'USO', 'VIXY'],
  crypto: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'DOGE/USD'],
};
export const NAMES = { SPY: 'S&P 500', QQQ: 'Nasdaq 100', DIA: 'Dow 30', IWM: 'Russell 2000', XLK: 'Tech', XLF: 'Financials', XLE: 'Energy', XLV: 'Health', XLI: 'Industrials', XLY: 'Cons. Disc.', XLP: 'Staples', XLU: 'Utilities', XLB: 'Materials', XLRE: 'Real Estate', XLC: 'Comm.', SMH: 'Semis', TLT: '20Y+ Treasuries', IEF: '7-10Y Treasuries', HYG: 'High Yield', UUP: 'US Dollar', GLD: 'Gold', SLV: 'Silver', USO: 'Oil', VIXY: 'VIX futures', 'BTC/USD': 'Bitcoin', 'ETH/USD': 'Ether', 'SOL/USD': 'Solana', 'XRP/USD': 'XRP', 'DOGE/USD': 'Dogecoin' };

export function marketSession(now = new Date()) {
  // Regular US session in New York time; ignores holidays (clock endpoint covers those when keys exist)
  const ny = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const d = ny.getDay(), m = ny.getHours() * 60 + ny.getMinutes();
  if (d === 0 || d === 6) return { open: false, phase: 'weekend', frac: 1 };
  if (m < 570) return { open: false, phase: m >= 240 ? 'pre-market' : 'closed', frac: 0 };
  if (m >= 960) return { open: false, phase: m < 1200 ? 'after-hours' : 'closed', frac: 1 };
  return { open: true, phase: 'open', frac: (m - 570) / 390 };
}
