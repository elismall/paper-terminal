import { json, denied, fail, needKeys, authorized, hasAlpaca, isCrypto, bars, snapshots, quoteOf, sma, rsi, atr, round, regularSession, feedStatus } from '../lib/core.js';
// One symbol for the chart views. ?symbol=AAPL&range=M1|M5|M15|1H|1D|5D|1W|1M|3M|6M|YTD|1Y|ALL  (legacy: &tf=1Day|1Hour|5Min)
// M1/M5/M15 = candle size (1, 5, 15 minutes) with a few sessions loaded so you can scroll back.
// Daily ranges fetch ~300 extra days so the 20/50/200-day averages are drawn from the first visible bar;
// "from" tells the chart where the visible window starts.
// &live=1 (v0.11.0, the open chart refreshing itself): short cache (5 s intraday, 15 s daily) and the latest trade folded into
// the last candle, so the chart ticks between bar closes.
// v0.14.0: stock candles are full-market (SIP) up to 16 minutes ago, IEX after that (those bars carry f:'i'); "feed" says which.
const TF = { '1Day': 400, '1Hour': 30, '5Min': 4 };
const RANGES = {
  'M1': { tf: '1Min', days: 4, sessions: 1, ms: 8 * 36e5 },
  'M5': { tf: '5Min', days: 10, sessions: 2, ms: 2 * 864e5 },
  'M15': { tf: '15Min', days: 25, sessions: 5, ms: 5 * 864e5 },
  '1H': { tf: '1Min', days: 4, ms: 36e5 },
  '1D': { tf: '5Min', days: 6, sessions: 1, ms: 864e5 },
  '5D': { tf: '15Min', days: 10, sessions: 5, ms: 5 * 864e5 },
  '1W': { tf: '1Hour', days: 10, ms: 7 * 864e5 },
  '1M': { tf: '1Day', days: 400, cal: 31, ctf: '4Hour', cdays: 33 },
  '3M': { tf: '1Day', days: 400, cal: 92 },
  '6M': { tf: '1Day', days: 490, cal: 183 },
  'YTD': { tf: '1Day', days: 0, ytd: true },
  '1Y': { tf: '1Day', days: 670, cal: 365 },
  'ALL': { tf: '1Week', start: '2015-01-01T00:00:00Z', all: true },
};
const nyDay = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const nyMin = (t) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(t)); return (+p.find(x => x.type === 'hour').value % 24) * 60 + +p.find(x => x.type === 'minute').value; };

export async function GET(req) {
  if (!authorized(req)) return denied();
  const u = new URL(req.url).searchParams;
  const sym = (u.get('symbol') || '').toUpperCase().replace(/[^A-Z./]/g, '');
  if (!sym) return json({ error: 'bad_request', message: 'symbol is required' }, { status: 400 });
  if (!isCrypto(sym) && !hasAlpaca()) return needKeys('stock charts');
  const cr = isCrypto(sym);
  const rk = RANGES[(u.get('range') || '').toUpperCase()] ? (u.get('range') || '').toUpperCase() : null;
  try {
    let tf, opt, R = null;
    if (rk) {
      R = RANGES[rk];
      tf = cr && R.ctf ? R.ctf : R.tf;
      const ytdStart = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
      opt = R.all ? { start: R.start, limitPages: 30 } : R.ytd ? { start: new Date(ytdStart - 320 * 864e5).toISOString() } : { days: cr && R.cdays ? R.cdays : R.days, limitPages: 20 };
      R = { ...R, ytdStart };
    } else { tf = TF[u.get('tf')] ? u.get('tf') : '1Day'; opt = { days: TF[tf] }; }
    const [b, sn] = await Promise.all([bars([sym], { timeframe: tf, ...opt }), snapshots([sym])]);
    let x = (b[sym] || []).map(k => ({ t: k.t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v, ...(k.f ? { f: k.f } : {}) }));
    const intraday = /Min|Hour/.test(tf);
    if (intraday && !cr) x = x.filter(k => { const m = nyMin(k.t); return m >= 570 && m < 960; });   // regular session, like TradingView's default
    if (!x.length) return json({ error: 'not_found', message: `No data for ${sym}. Check the symbol (crypto uses BTC/USD style).` }, { status: 404, cache: 60 });
    let from = null;
    if (R) {
      if (R.sessions && !cr) { const days = [...new Set(x.map(k => nyDay(k.t)))]; const d0 = days[Math.max(0, days.length - R.sessions)]; from = x.find(k => nyDay(k.t) === d0).t; }
      else if (R.ms && intraday) from = new Date(new Date(x.at(-1).t).getTime() - R.ms).toISOString();
      else if (R.ytd) from = R.ytdStart.toISOString();
      else if (R.cal) from = new Date(Date.now() - R.cal * 864e5).toISOString();
      else from = x[0].t;
      if (x.length > 5000) x = x.slice(-5000);
    }
    const q = quoteOf(sym, sn[sym]), live = u.get('live') === '1';
    // v0.14.0: stock trades outside 9:30–4:00 are not folded into candles (TradingView's default session); crypto trades 24/7
    if (live && q?.p && x.length && Date.parse(q.t || 0) >= Date.parse(x.at(-1).t) && (cr || regularSession(Date.parse(q.t)))) { const L = x.at(-1); x[x.length - 1] = { ...L, c: q.p, h: Math.max(L.h, q.p), l: Math.min(L.l, q.p) }; }
    const c = x.map(k => k.c);
    const daily = tf === '1Day';
    const stats = { rsi: daily ? round(rsi(c), 0) : null, atr: daily ? round(atr(x)) : null, s20: daily ? round(sma(c, 20)) : null, s50: daily ? round(sma(c, 50)) : null, s200: daily ? round(sma(c, 200)) : null,
      hi52: daily ? round(Math.max(...x.slice(-252).map(k => k.h))) : null, lo52: daily ? round(Math.min(...x.slice(-252).map(k => k.l))) : null };
    const feed = cr ? 'crypto' : feedStatus().sip ? { candles: 'sip', recent: x.some(k => k.f === 'i') ? 'iex' : null, lagMin: feedStatus().lagMin } : { candles: 'iex', note: 'full-market feed unavailable; IEX only' };
    return json({ s: sym, tf, range: rk, from, intraday, bars: x, quote: q, stats, feed, at: new Date().toISOString() },
      live ? { cache: intraday ? 5 : 15, swr: 5 } : { cache: rk === 'ALL' ? 3600 : daily || tf === '1Week' ? 120 : 20, swr: 300 });
  } catch (e) { return fail(e, 'bars'); }
}
