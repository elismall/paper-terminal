// The bot's day (v0.14.0, Eli 2026-09-30 on Vercel Pro: "middle with crypto 5 mins. scans every 15"). One Vercel cron calls
// /api/tick every 5 minutes, all day, every day (vercel.json). The tick asks Alpaca's clock + calendar what kind of day it is and
// picks the job from the New York time, so daylight saving, market holidays and 1 PM early closes need no cron changes.
//
// Weekdays with a US stock session (times ET; the close comes from Alpaca's calendar, normally 4:00 PM):
//   8:00–9:15 AM every 15 min + 9:25   pre     pre-market gap check / watchlist (never trades; Alpaca allows only limit orders then)
//   9:30 AM → close, every 5 min       watch   LIGHT: open trades only (time exits, break-even stops, missing stops); no new trades
//   9:45 AM                            morning HEAVY: new swing trades from yesterday's finished daily candle (what training tests)
//   10:00 AM → close − 15 min, every 15 scan    HEAVY: new swing trades from today's candle so far (live, tagged, graded separately)
//   close + 20 min (4:20 PM)           wrap    retrain the stock settings on the finished candle (cached for tomorrow)
// Every tick, every day: crypto check (swing-coin stops/targets, DCA dip buys, take profits, trailing exits, hard exits, new deals).
// 7:00 PM daily: the evening crypto run (hold review + the daily scoreboard).
// LIGHT vs HEAVY is decided only by the clock (this table). One guard: a tick that finds another run still working stands down.
export const SCHED = { tick: 5, pre: [480, 495, 510, 525, 540, 555, 565], morning: 585, scanFrom: 600, scanEvery: 15, scanStopBeforeClose: 15, wrapAfterClose: 20, evening: 1140 };

const parts = (ms) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(new Date(ms)); const g = (k) => p.find(x => x.type === k)?.value;
  return { day: `${g('year')}-${g('month')}-${g('day')}`, min: (+g('hour') % 24) * 60 + +g('minute'), wd: g('weekday') }; };
export const etNow = (ms = Date.now()) => parts(ms);
const hm = (s) => { const [h, m] = String(s || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };
export const fmt12 = (min) => { const h = Math.floor(min / 60) % 24, m = min % 60; return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

// session: Alpaca calendar row for today ({ date, open: '09:30', close: '16:00' }) or null (weekend/holiday).
// step (v0.17.1): minutes between ticks. 5 = Vercel Pro cron (the default); free mode (Vercel Hobby + an outside scheduler such as
// cron-job.org calling /api/tick?every=15) passes 15. A tick covers [slot, slot + step): any job whose minute falls in that window
// runs on it, so a 15-minute tick at 4:15 PM still does the 4:20 PM wrap-up. Free mode also scans every 30 minutes (fewer writes).
// Returns { et, slot, step, stocks: 'morning'|'scan'|'watch'|null, pre, wrap, crypto: 'check'|'evening', why }
export const scanEveryFor = (step) => step >= 15 ? 30 : SCHED.scanEvery;
export function planTick(ms, session, { step = SCHED.tick } = {}) {
  step = Math.max(SCHED.tick, Math.min(60, Math.round(+step) || SCHED.tick));
  const et = parts(ms), slot = Math.floor(et.min / step) * step, inWin = (m) => m >= slot && m < slot + step;
  const open = session ? hm(session.open) : null, close = session ? hm(session.close) : null, market = !!(session && open != null && close != null);
  const every = scanEveryFor(step), last = close - SCHED.scanStopBeforeClose;
  let stocks = null, pre = false, wrap = false;
  if (market) {
    if (slot >= open && slot < close) {
      if (inWin(SCHED.morning)) stocks = 'morning';
      else if (Array.from({ length: Math.max(0, Math.floor((last - SCHED.scanFrom) / every) + 1) }, (_, i) => SCHED.scanFrom + i * every).some(inWin)) stocks = 'scan';
      else stocks = 'watch';
    }
    pre = slot < open && SCHED.pre.some(inWin);
    wrap = inWin(close + SCHED.wrapAfterClose);
  }
  const crypto = inWin(SCHED.evening) ? 'evening' : 'check';
  const why = [market ? `market day (${fmt12(open)}–${fmt12(close)} ET)` : 'no stock session today', `${fmt12(slot)} ET`, step !== SCHED.tick ? `every ${step} min` : null, stocks ? `stocks: ${stocks}` : null, pre ? 'pre-market check' : null, wrap ? 'wrap-up: retrain' : null, `crypto: ${crypto}`].filter(Boolean).join(' · ');
  return { et, slot, step, time: fmt12(slot), stocks, pre, wrap, crypto, why };
}
// The whole day as a list (Bot tab "Today's schedule" and the docs). Times ET.
export function dayPlan(session, { step = SCHED.tick } = {}) {
  const every = scanEveryFor(step), crypto = `crypto check every ${step} minutes; 7:00 PM evening crypto run`;
  if (!session) return [{ at: 'all day', what: crypto }];
  const open = hm(session.open), close = hm(session.close);
  return [
    { at: `${fmt12(SCHED.pre[0])}–${fmt12(SCHED.pre.at(-1))}`, what: 'pre-market gap check every 15 minutes (no trades)' },
    { at: `${fmt12(open)}–${fmt12(close)}`, what: `watch open trades every ${step} minutes` },
    { at: fmt12(SCHED.morning), what: "morning entries from yesterday's finished candle" },
    { at: `${fmt12(SCHED.scanFrom)}–${fmt12(close - SCHED.scanStopBeforeClose)}`, what: `scan for new trades every ${every} minutes` },
    { at: fmt12(close + SCHED.wrapAfterClose), what: 'wrap-up: retrain on the finished candle' },
    { at: 'all day', what: crypto },
  ];
}
