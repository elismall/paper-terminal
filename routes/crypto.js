import { json, denied, fail, authorized, hasAlpaca, alpaca, paced, bars, snapshots, quoteOf, swingEval, sma, rsi, round, CRYPTO_UNIVERSE } from '../lib/core.js';
import { pget } from '../lib/trade.js';
// Crypto board + swing scan + 24h momentum. Works without API keys.
// v0.19.0: ?all=1 is the whole market for the Crypto tab's search: every tradable Alpaca USD pair (the list needs your keys;
// without them it is the 14 coins the bot watches). Swing plays stay on the bot's coins only.
export async function GET(req) {
  if (!authorized(req)) return denied();
  const u = new URL(req.url).searchParams;
  if (u.get('all') === '1') {
    if ([...u.keys()].some(k => k !== 'all')) return json({ error: 'bad_request', message: 'Use ?all=1 on its own.' }, { status: 400 }); // no cache-busting copies
    if (!M.p || Date.now() - M.at > 6e4) Object.assign(M, { at: Date.now(), p: market() }); // one download a minute per instance, shared by every caller
    return (await M.p).clone();
  }
  try {
    const risk = Math.min(10000, Math.max(50, +u.get('risk') || 1000));
    const [sn, d1, h1] = await Promise.all([
      snapshots(CRYPTO_UNIVERSE),
      bars(CRYPTO_UNIVERSE, { timeframe: '1Day', days: 420 }),
      bars(CRYPTO_UNIVERSE, { timeframe: '1Hour', days: 4 }),
    ]);
    const btc = d1['BTC/USD'] || [];
    const bench = btc.length > 64 ? btc.at(-1).c / btc.at(-64).c - 1 : 0;
    const board = [], plays = [];
    for (const s of CRYPTO_UNIVERSE) {
      const q = quoteOf(s, sn[s]); const d = d1[s] || [], h = h1[s] || [];
      if (!q?.p) continue;
      const c = d.map(x => x.c);
      board.push({ ...move(q, c, h), above200: c.length >= 200 ? q.p > sma(c, 200) : null });
      const p = swingEval(s, d, bench, { riskDollars: risk }); if (p) { p.spark = c.slice(-40); plays.push(p); }
    }
    plays.sort((a, z) => z.score - a.score);
    return json({ board, plays, note: 'Alpaca crypto feed. Markets trade 24/7; daily bars close at 00:00 UTC.', at: new Date().toISOString() }, { cache: 30, swr: 120 });
  } catch (e) { return fail(e, 'crypto'); }
}

// One board row: price, 24h / day / 7d / 30d change, RSI, 24h volume (dollars) and its trend, 48h sparkline.
// c = daily closes, h = hourly bars (at least the last 48 hours).
function move(q, c, h) {
  const h24 = h.length > 24 ? h.at(-25).c : null, last24 = h.slice(-24);
  const hv = last24.reduce((a, x) => a + x.v, 0), hvPrev = h.slice(-48, -24).reduce((a, x) => a + x.v, 0);
  return { s: q.s, p: q.p, chg24: h24 ? round((q.p / h24 - 1) * 100, 2) : null, chgDay: round(q.pct * 100, 2),
    d7: c.length > 8 ? round((q.p / c.at(-8) - 1) * 100, 1) : null, d30: c.length > 31 ? round((q.p / c.at(-31) - 1) * 100, 1) : null,
    rsi: round(rsi(c), 0), vol: round(last24.reduce((a, x) => a + x.v * x.c, 0), 0), volTrend: hvPrev ? round(hv / hvPrev, 2) : null,
    spark: h.slice(-48).map(x => round(x.c, 6)) };
}

// Every coin in one request per page (the per-coin download the board uses would be ~120 requests for the whole market).
// Pages are followed to the end, because Alpaca splits a page across coins and a capped download drops coins (see lib/core.js bars).
// If the 60-page cap or the 20-second deadline stops it early, done is false and the coins after the last page are not trusted.
async function allBars(syms, timeframe, days) {
  const out = {}, start = new Date(Date.now() - days * 864e5).toISOString(), stop = Date.now() + 2e4; let token = '', pages = 0;
  do {
    if (pages && Date.now() > stop) break;
    await paced();
    const d = await alpaca(`/v1beta3/crypto/us/bars?${new URLSearchParams({ symbols: syms.join(','), timeframe, start, limit: '10000', ...(token ? { page_token: token } : {}) })}`);
    for (const [s, b] of Object.entries(d.bars || {})) (out[s] ||= []).push(...b);
    token = d.next_page_token || '';
  } while (token && ++pages < 60);
  return { bars: out, done: !token };
}

// The list of coins changes rarely: keep it 6 hours per server instance (a failed read is retried after 5 minutes, not every call).
const LIST = { at: 0, coins: null, failAt: 0 }, M = { at: 0, p: null };
export const _resetMarket = () => { Object.assign(LIST, { at: 0, coins: null, failAt: 0 }); Object.assign(M, { at: 0, p: null }); }; // tests
async function coinList() {
  if (LIST.coins && Date.now() - LIST.at < 6 * 36e5) return LIST.coins;
  if (Date.now() - LIST.failAt < 3e5) return LIST.coins || [];
  const a = await pget('/v2/assets?status=active&asset_class=crypto').catch(e => { LIST.failAt = Date.now(); throw e; });
  const coins = (Array.isArray(a) ? a : []).filter(x => x.tradable && /^[A-Z0-9]{1,15}\/USD$/.test(x.symbol))
    .map(x => [x.symbol, String(x.name || '').replace(/\s*\/\s*US Dollar$/i, '').slice(0, 40) || x.symbol.replace('/USD', '')]).slice(0, 150);
  if (coins.length) Object.assign(LIST, { at: Date.now(), coins });
  return coins;
}

async function market() {
  try {
    const listed = hasAlpaca() ? await coinList().catch(() => []) : [];
    const names = Object.fromEntries(listed), syms = [...new Set([...CRYPTO_UNIVERSE, ...listed.map(x => x[0])])];
    const [sn, d1, h1] = await Promise.all([snapshots(syms), allBars(syms, '1Day', 35), allBars(syms, '1Hour', 2.1)]);
    // A download stopped early can cut a coin partway (its newest bars missing) or leave it out. Then only coins whose newest
    // bars are recent count as whole; the rest show just the price and day change. partial tells the page.
    const whole = (r, s, ms) => r.done || (r.bars[s]?.length && Date.now() - Date.parse(r.bars[s].at(-1).t) < ms);
    const board = []; let partial = false;
    syms.forEach((s) => {
      const q = quoteOf(s, sn[s]); if (!q?.p) return;
      const ok = whole(d1, s, 2 * 864e5) && whole(h1, s, 3 * 36e5); if (!ok) partial = true;
      const row = ok ? move(q, (d1.bars[s] || []).map(x => x.c), h1.bars[s] || []) : { ...move(q, [], []), chg24: null, vol: null, spark: null, rsi: null };
      board.push({ ...row, n: names[s] || null, bot: CRYPTO_UNIVERSE.includes(s) });
    });
    board.sort((a, z) => (z.vol || 0) - (a.vol || 0));
    let note = listed.length ? `Every coin Alpaca trades against the dollar (${board.length}). Biggest 24-hour trading volume first.`
      : 'Showing the coins the bot watches. Add your Alpaca keys to see every coin Alpaca trades.';
    if (partial) note += ' Some coins show only their price this minute (the download was cut short).';
    return json({ board, note, ...(partial ? { partial: true } : {}), at: new Date().toISOString() }, { cache: 60, swr: 300 });
  } catch (e) { return fail(e, 'crypto market'); }
}
