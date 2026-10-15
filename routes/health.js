import { feeMode, FEES } from '../lib/fees.js';
import { json, env, hasAlpaca, authorized, alpaca } from '../lib/core.js';
import { tradingMode } from '../lib/trade.js';
import { pushReady, probeStore } from '../lib/notify.js';
import { dcaTraining, trainingSummary } from '../lib/dca.js';
import { jevStatus, jevProbe } from '../lib/jev.js';
import { cryptoSwingOn } from '../lib/cryptobot.js';
import { mergedNews, newsFeatures, newsVerdict, newsMode } from '../lib/news.js';
import { econCalendar } from '../lib/calendar.js';
import { labSummary, histFill } from '../lib/dcalab.js';
import { runSmall } from '../lib/small.js';
import { labLatest, bullState } from '../lib/dca.js';
import { perpStats, perpOf, levMode } from '../lib/leverage.js';
import { liquidity } from '../lib/macro.js';
import { VERSION, APP_NAME, GUIDE_URL } from '../lib/version.js';
import { lastRun } from '../lib/control.js';
// Reports which settings exist (true/false only, never values). ?probe=store also checks the Blob store answers;
// ?probe=jev makes one tiny Jev call with made-up numbers (proves key + format, returns no secrets);
// ?probe=news reports how many items each news source returned (counts and errors only), AAPL's news features and the
// economic calendar (next 14 days);
// ?probe=dca returns the DCA bot's trained settings and backtest summary (history only, no account data);
// ?probe=lab returns the DCA lab summary (coins picked, bull-run mode) and today's BTC regime;
// ?probe=signals checks the crypto leverage feed (Hyperliquid funding) and the FRED money-conditions read.
// ?probe=hist downloads older crypto price history for up to ~4 minutes (no-op once complete);
// ?probe=small steps the $100 plan's virtual accounts as a preview (reads prices, never writes).
// ?probe=fees (v0.16.0, passcode) says whether the account shows real crypto fee activities (CFEE) and the rates the scorecards use.
// ?probe=feeds (v0.14.0) compares Alpaca's stock feeds for AAPL and SPY: full-market (SIP) bars ending 16 minutes ago, SIP up to now
// (expected to be refused on the free plan), IEX bars, and the IEX / delayed-SIP snapshots. Market prices only.
const bk = (b) => b && { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
async function feedProbe() {
  const now = Date.now(), cut = new Date(now - 16 * 6e4).toISOString(), d5 = new Date(now - 6 * 864e5).toISOString(), m30 = new Date(now - 46 * 6e4).toISOString();
  const S = 'AAPL,SPY', q = (o) => new URLSearchParams({ symbols: S, limit: '10000', adjustment: 'split', ...o }).toString();
  const tryIt = async (name, path, pick) => { try { return [name, pick(await alpaca(path))]; } catch (e) { return [name, { error: String(e.message || e).slice(0, 220) }]; } };
  const lastN = (n) => (d) => Object.fromEntries(Object.entries(d.bars || {}).map(([k, a]) => [k, { n: a.length, last: a.slice(-n).map(bk) }]));
  const snap = (d) => Object.fromEntries(Object.entries(d.snapshots || d).map(([k, x]) => [k, { trade: x.latestTrade && { t: x.latestTrade.t, p: x.latestTrade.p }, day: bk(x.dailyBar), min: bk(x.minuteBar) }]));
  const out = await Promise.all([
    tryIt('sipDayToCut', `/v2/stocks/bars?${q({ timeframe: '1Day', start: d5, end: cut, feed: 'sip' })}`, lastN(2)),
    tryIt('iexDay', `/v2/stocks/bars?${q({ timeframe: '1Day', start: d5, feed: 'iex' })}`, lastN(2)),
    tryIt('sipMinToCut', `/v2/stocks/bars?${q({ timeframe: '1Min', start: m30, end: cut, feed: 'sip' })}`, lastN(2)),
    tryIt('iexMin', `/v2/stocks/bars?${q({ timeframe: '1Min', start: m30, feed: 'iex' })}`, lastN(2)),
    tryIt('sipMinNow', `/v2/stocks/bars?${q({ timeframe: '1Min', start: m30, feed: 'sip' })}`, lastN(1)),
    tryIt('snapIex', `/v2/stocks/snapshots?symbols=${S}&feed=iex`, snap),
    tryIt('snapDelayedSip', `/v2/stocks/snapshots?symbols=${S}&feed=delayed_sip`, snap),
  ]);
  return { cut, at: new Date(now).toISOString(), ...Object.fromEntries(out) };
}
// v0.17.0: every probe needs a signed-in device (several call paid APIs or run for minutes); without one the basic
// true/false fields still answer. passStrong = the passcode is 12+ characters (the length only, never the value).
// v0.20.0 (audit #11): passStrong, botPaused, the AI filter and crypto swing are for signed-in devices only (passStrong told a
// stranger when guessing was worth trying).
const PROBES = ['store', 'jev', 'news', 'dca', 'signals', 'hist', 'feeds', 'fees', 'small', 'lab'];
export async function GET(req) {
  const asked = new URL(req.url).searchParams.get('probe'), signedIn = authorized(req, { strict: true });
  if (asked && PROBES.includes(asked) && !signedIn) return json({ ok: true, locked: !!env('DASH_PASSCODE'), authorized: false, probe: asked, error: 'locked', message: 'Probes need a signed-in device: enter your passcode in Settings.' }, { status: 401, priv: true });
  const probe = asked; // reaching here means signed in, or not a probe
  return json({
    ok: true,
    locked: !!env('DASH_PASSCODE'),
    authorized: signedIn,
    alpaca: hasAlpaca(),
    fred: !!env('FRED_API_KEY'),
    sec: !!env('SEC_USER_AGENT'),
    push: pushReady().ok,
    ...(probe === 'store' ? { store: await probeStore() } : {}),
    ...(probe === 'jev' ? { jevProbe: await jevProbe() } : {}),
    ...(probe === 'news' ? { news: await Promise.all([mergedNews().then(r => r.sources), newsFeatures(['AAPL']).then(F => F.AAPL ? { ...F.AAPL, heads: F.AAPL.heads.length, verdict: newsVerdict(F.AAPL) } : null)]).then(async ([sources, aapl]) => ({ mode: newsMode(), sources, aapl, calendar: await econCalendar().catch(e => ({ error: e.message })) })).catch(e => ({ error: e.message })) } : {}),
    ...(probe === 'dca' ? { dca: await dcaTraining().then(trainingSummary).catch(e => ({ error: e.message })) } : {}),
    ...(probe === 'signals' ? { signals: { mode: levMode(), funding: await perpStats().then(P => ({ coins: Object.keys(P).length, BTC: perpOf(P, 'BTC/USD'), ETH: perpOf(P, 'ETH/USD'), SOL: perpOf(P, 'SOL/USD'), PEPE: perpOf(P, 'PEPE/USD') })).catch(e => ({ error: e.message })), liquidity: await liquidity().catch(e => ({ error: e.message })) } } : {}),
    ...(probe === 'hist' ? { hist: await histFill().catch(e => ({ error: e.message })) } : {}),
    ...(probe === 'feeds' && hasAlpaca() ? { feeds: await feedProbe() } : {}),
    ...(probe === 'fees' && hasAlpaca() ? { fees: signedIn ? { ...(await feeMode({ fresh: true })), rates: FEES, note: 'charged = the account shows crypto fee (CFEE) activities, i.e. Alpaca deducts real fees in paper' } : { error: 'locked', message: 'Account data: needs the passcode.' } } : {}),
    ...(probe === 'small' ? { small: await runSmall({ dry: true }).catch(e => ({ error: e.message })) } : {}),
    ...(probe === 'lab' ? { lab: await labLatest({ fresh: true, any: true }).then(labSummary).catch(e => ({ error: e.message })), bull: await bullState().catch(e => ({ error: e.message })) } : {}),
    cron: !!env('CRON_SECRET'),
    ...(signedIn ? { trading: tradingMode(), store: !!env('BLOB_READ_WRITE_TOKEN'), lastRun: await lastRun().then(l => l?.at ? { at: l.at, slot: l.slot || null } : null).catch(() => null) } : {}), // v0.17.1 setup check: paper or live, storage, last scheduled run (signed-in devices only)
    app: env('APP_NAME') || APP_NAME, guide: GUIDE_URL || null,
    ...(signedIn ? { passStrong: env('DASH_PASSCODE').length >= 12, botPaused: env('BOT_PAUSED') === 'true', jev: jevStatus(), cryptoSwing: cryptoSwingOn() } : {}),
    version: VERSION,
    time: new Date().toISOString(),
  }, { priv: true });
}
