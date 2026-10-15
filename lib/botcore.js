// The paper bot. Since v0.14.0 /api/tick (every 15 minutes from cron-job.org on the free setup, 5 on Vercel Pro) calls it and
// lib/schedule.js picks the job (slots below). Stocks: 'watch' (LIGHT, every tick while open: open trades only), 'morning' (9:45 AM:
// new trades from yesterday's finished candle, tagged -om), 'scan' (every 30 min from 10:00 AM on the free setup, 15 on Pro: new
// trades from today's candle so far, tagged -oi). Crypto (lib/cryptobot.js): 'chk' every tick, 'cx' the 7 PM evening run.
// DCA bot (lib/dca.js, 3Commas-style deals on crypto + ETFs): on every scheduled run, next to the swing bots.
// Crypto check (slot 'chk', every tick since v0.14.0; hourly before): crypto only: swing-coin stops/targets, DCA dip buys,
// take profits and trailing floors, new crypto deals. LIGHT runs ('chk', 'watch'): no training, no hold review, no last-run save; the
// $100 plan's virtual accounts (lib/small.js) step on heavy runs and once an hour on light ones.
// Manual runs from the Bot tab: ?run=1 [&max=N] [&only=stocks|crypto|dca], ?run=1&check=1 (crypto check), or ?dry=1 to preview.
// Every run: one run at a time (lock), then the fallback ladder (lib/control.js) decides whether NEW trades are allowed;
// managing open trades (exits, breakeven, re-arm, DCA take profits) always runs. Optional AI second opinion: lib/jev.js.
// Paper by default (paper-api.alpaca.markets); real money only when lib/trade.js live mode is fully set up (tradingMode), with the LIVE_MAX_USD guard on every buy.
//
// Training: the swing rules replayed over ~16 months under 16 exit settings, keeping the steadiest profit per trade (lib/perf.js),
// cached once per finished session since v0.14.0 (retrained at 4:20 PM ET). Heavy runs trade the setups that pass its score bar.
import { json, fail, authorized, hasAlpaca, bars, snapshots, quoteOf, swingEval, round, SWING_UNIVERSE, ETFS, cronOk as isCron } from './core.js';
import { pget, ppost, pdel, ppatch, compactOrder, ordersSince, realPositions, recentlyOrdered, timedOut, ppostSure, tradingMode } from './trade.js';
import { stockTraining, liveTrades, summarize, BUCKETS, BOT_UNIVERSE, BE, beLevels, peaksSince } from './perf.js';
import { runCrypto } from './cryptobot.js';
import { botNotify } from './notify.js';
import { runDca, dcaSpare, dcaTraining } from './dca.js';
import { runSmall } from './small.js';
import { acquireLock, checkLock, releaseLock, ladder, saveLastRun } from './control.js';
import { makeJudge, verdict, jevTag, swingState, ENTRY_NEWS_Q, oncePerDay } from './jev.js';
import { newsFeatures, newsVerdict, newsTag, newsState, newsMode } from './news.js';
import { gapToday } from './gap.js';
import { dailySnapshot, saveDaily } from './history.js';
import { holdReview, saveJevLog } from './review.js';
import { JLOG } from './jev.js';
import { VERSION } from './version.js';
import { ledgerRows, candAdd } from './ledger.js';

// minTrades (Eli 2026-09-30, v0.13.3): 0 = no daily minimum. The bot only trades setups that clear its trained score bar; a day with no
// qualifying setup has no stock trades. Filler trades (below the bar, half risk) only happen when minTrades > 0.
export const RULES = { minTrades: 0, maxNewPerDay: 6, maxPositions: 15, riskPct: 0.005, fillerRiskPct: 0.0025, maxWeight: 0.10, dailyStop: -0.02, chaseAtr: 0.75, floorScore: 50, minPrice: 5, maxGross: 1.0 }; // maxGross 1.0 = never use margin
export const nyDate = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
export const weekdaysBetween = (a, b) => { let n = 0; const d = new Date(a); d.setUTCHours(12); const end = new Date(b); while (d < end) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w && w !== 6 && d <= end) n++; } return n; };
const bucketOf = (score) => { const b = BUCKETS.find(([lo, hi]) => score >= lo && score <= hi); return b ? `${b[0]}–${b[1]}` : '<50'; };
const SLUG = (s) => s.replace(/[^A-Za-z]/g, '').toLowerCase();
const LIVE = new Set(['new', 'accepted', 'pending_new', 'partially_filled', 'held', 'accepted_for_bidding', 'pending_replace', 'calculated']);
// Open orders with bracket/OCO legs pulled out to the top level (a filled parent can still have live legs).
export const flatOpen = (orders) => { const out = [], seen = new Set(); for (const o of orders) for (const x of [o, ...(o.legs || [])]) if (LIVE.has(x.status) && !seen.has(x.id)) { seen.add(x.id); out.push(x); } return out; };
// Original stop the bot set at entry, kept in the order id ("-s95.12"), so R stays honest after the stop moves to breakeven.
export const origStop = (o) => { const m = /-s(\d+(?:\.\d+)?)(?:-|$)/.exec(o?.client_order_id || ''); return m ? +m[1] : null; };
// Stop and target the bot set for an entry order (from its bracket legs).
export const exitsOf = (o) => { const legs = o?.legs || []; const st = legs.find(l => l.type === 'stop' || l.type === 'stop_limit'); const tp = legs.find(l => l.type === 'limit');
  return { stop: st ? +st.stop_price : o?.stop_loss?.stop_price ? +o.stop_loss.stop_price : null, target: tp ? +tp.limit_price : o?.take_profit?.limit_price ? +o.take_profit.limit_price : null }; };

// opts.free (v0.17.1): a free-mode tick (Vercel Hobby): read-only lock check instead of writing a lock.
export async function runBot(req, slot, { free = false } = {}) {
  const u = new URL(req.url).searchParams;
  const cronOk = isCron(req);
  const manual = authorized(req, { strict: true }) && (u.get('run') === '1' || u.get('dry') === '1');
  if (!cronOk && !manual) return json({ error: 'locked', message: 'The bot runs on its schedule, or from the Bot tab with your passcode.' }, { status: 401 });
  if (!hasAlpaca()) return json({ error: 'no_keys', message: 'Alpaca keys are not set.' });
  const dry = u.get('dry') === '1';
  const only = u.get('only'); // manual: stocks | crypto | dca
  const chk = slot === 'chk' || (manual && u.get('check') === '1'), watch = slot === 'watch', light = chk || watch;
  // stock mode: manage = open trades only; open = entries from yesterday's finished candle; intraday = entries from today's candle so far
  const stockMode = slot === 'cx' || chk ? null : watch ? 'manage' : slot === 'scan' ? 'intraday' : 'open';
  const doS = !!stockMode && (!only || only === 'stocks'), doC = !only || only === 'crypto', doD = !only || only === 'dca';
  const runStart = Date.now();
  const lock = dry ? null : free && !manual ? await checkLock() : await acquireLock();
  if (!dry && lock === null) return json({ ok: true, slot, skipped: 'Another bot run is in progress, so this one stood down.' }, { priv: true });
  try {
    JLOG.length = 0; // this run's Jev calls only
    const [clock, acct, positions, open, recent] = await Promise.all([pget('/v2/clock'), pget('/v2/account'), pget('/v2/positions').then(realPositions), pget('/v2/orders?status=open&limit=500&nested=true'), ordersSince(40)]);
    const today = nyDate(Date.now()), tag = today.replace(/-/g, '');
    const equity = +acct.equity, last = +acct.last_equity, tm = tradingMode();
    const sizeEq = tm.live ? Math.min(equity, tm.cap) : equity; // v0.20.0 (audit #7): live trades are sized from LIVE_MAX_USD, not the whole account
    const openAll = flatOpen(open);
    const spare = dcaSpare({ positions, openAll, recent }); // unused DCA budget stays free for the DCA bot
    const grossNow = positions.reduce((a, p) => a + Math.abs(+p.market_value || 0), 0) + spare;
    const safety = await ladder({ dry, clock, equity, last, lockUnconfirmed: !!lock?.unconfirmed }); // fallback ladder: may block NEW trades, never management
    const allow = safety.entries, blockReason = `Level ${safety.level} ${safety.label}: ${safety.reasons.join('; ')}`;
    const judge = dry ? makeJudge() : oncePerDay(makeJudge(), 'entry'); // v0.14.0: one Jev answer per symbol per day
    const ctx = { u, slot, manual, dry, clock, equity: sizeEq, last, positions, openAll, recent, today, tag, spare, allow, blockReason, judge, mode: stockMode };
    if (doD && !light) dcaTraining().catch(() => null); // warm the DCA training while the swing bots run
    const [stocks, crypto] = await Promise.all([
      doS ? runStocks(ctx).catch(e => ({ error: 'upstream', message: e.message })) : null,
      doC ? runCrypto({ equity: sizeEq, dry, tag, positions, openAll, recent, grossNow, allowEntries: allow.crypto, blockReason, judge })
        .catch(e => ({ error: 'upstream', message: e.message })) : null,
    ]);
    // DCA runs after the swing bots so both never buy the same coin in one run
    const taken = new Set((crypto?.placed || []).map(p => String(p.s).replace('/', '')));
    const dca = doD ? await runDca({ dry, positions, openAll, recent, clock, taken, allowNew: allow.dca, paused: safety.level >= 4, blockReason, judge, markets: light ? ['crypto'] : undefined }).catch(e => ({ error: 'upstream', message: e.message })) : null;
    // $100 plan (v0.12.0): virtual accounts on real prices, no orders. Light ticks step it once an hour (its signals use finished hourly and 4-hour candles).
    const small = doD && !dry && (!light || new Date().getUTCMinutes() < 5) ? await runSmall().catch(e => ({ error: e.message })) : null;
    const jevFailed = [stocks, crypto, dca].reduce((a, r) => a + (r?.jev?.failed || 0), 0), jevMode = [stocks, crypto, dca].find(r => r?.jev)?.jev?.mode;
    if (jevFailed && jevMode === 'gate') { safety.level = Math.max(safety.level, 2); safety.label = { 1: 'Normal', 2: 'Caution', 3: 'Hold', 4: 'Stopped' }[safety.level]; safety.reasons.push(`AI filter unavailable for ${jevFailed} check(s): rules only`); }
    // AI hold review (shadow): once in the morning, once in the evening, and on manual runs (not every 15 minutes)
    const review = !dry && !light && (slot === 'morning' || slot === 'am' || slot === 'cx' || manual) && (stocks || crypto) ? await holdReview({ positions, recent, openAll }).catch(e => ({ error: e.message })) : null;
    if (!dry && !light) await saveLastRun({ ...safety, slot }, runStart); // the evening marker uses the day the run started
    const daily = !dry && slot === 'cx' ? await dailySnapshot({ version: VERSION, safety }).then(saveDaily).then(h => ({ saved: h.days.at(-1)?.d })).catch(e => ({ error: e.message })) : null; // daily scoreboard (evening run)
    if (!dry) { // Jev tab: what each AI call saw and what the bot did
      const bought = [...(stocks?.placed || []), ...(crypto?.placed || []), ...(dca?.started || [])], passed = [...(Array.isArray(stocks?.skipped) ? stocks.skipped : []), ...(crypto?.skipped || []), ...(dca?.skipped || [])];
      await saveJevLog((x) => { if (x.kind === 'review') return 'hold review (shadow: no action)'; const b = bought.find(p => p.s === x.s), ai = b ? b.ai || (/AI filter/.test(b.why || '') ? String(b.why).split(' · ').pop() : '') : ''; if (b) return 'bought' + (ai ? ` (${ai})` : '');
        const k = passed.find(p => p.s === x.s); return k ? 'passed: ' + k.why : 'not taken (rules, limits or no room)'; }).catch(() => null);
    } else JLOG.length = 0;
    const pushed = dry ? null : await botNotify({ stocks: stocks?.error ? null : stocks, crypto: crypto?.error ? null : crypto, dca: dca?.error ? null : dca, recent, runStart }).catch(e => ({ error: e.message })); // phone notifications
    return json({ ok: true, slot: chk ? 'chk' : slot, stockMode, dry, only: only || 'all', ranAt: new Date().toISOString(), equity, safety, review, ...(stocks?.error ? { stocksError: stocks.message } : stocks || {}), stocksRan: !!stocks, crypto, dca, small: small && { notes: small.notes, saved: small.saved, error: small.error }, pushed, daily }, { priv: true });
  } catch (e) { return fail(e, 'bot'); }
  finally { await releaseLock(lock); }
}

async function runStocks({ u, slot, manual, dry, clock, equity, last, positions, openAll, recent, today, tag, spare, allow, blockReason, judge, mode = 'open' }) {
  {
    if (!clock.is_open && !dry) return { skipped: 'Stock market is closed', next_open: clock.next_open };
    const entering = mode !== 'manage';

    // ---- training (v0.14.0: cached once per finished session, see stockTraining) ----
    // A light 'manage' run only needs the trained hold time for positions without one in their id, so it never retrains.
    const [bm, live] = await Promise.all([trainingFor(entering).catch(e => ({ error: e.message })), entering ? liveTrades().then(summarize).catch(() => null) : null]);
    const P = bm?.chosen || { stop: 1.5, target: 3, hold: 10 };
    const minScore = Math.max(55, bm?.recMinScore || 65);
    const blocked = new Set();
    for (const [k, st] of Object.entries(bm?.bySetup || {})) if (st.n >= 30 && st.expR < 0) blocked.add(k);
    for (const [k, st] of Object.entries(live?.bySetup || {})) if (st.n >= 20 && st.expR != null && st.expR < 0) blocked.add(k);
    const goodBucket = (score) => { const st = bm?.byScore?.[bucketOf(score)]; return st && st.n >= 30 && st.expR > 0; };
    const training = { exits: P, minScore, blocked: [...blocked], benchWin: bm?.overallLong?.win ?? null, benchExpR: bm?.overallLong?.expR ?? null, benchTrades: bm?.overallLong?.n ?? 0, liveTrades: live?.overall?.n ?? 0, error: bm?.error, trainedAt: bm?.cachedAt || null, lastBar: bm?.lastBar || null };

    // ---- manage: time exits for bot positions held past the holding period they were ENTERED with ----
    // v0.12.1 (audit fixes): the limit comes from the entry's own order id (-h<days>), so retraining can't shorten or stretch an open
    // trade; and the most recent buy of the symbol must be the bot's, so a later manual buy of the same stock is never sold for you.
    const exits = [], protect = [];
    for (const p of positions) {
      if (p.asset_class === 'crypto') continue;
      const buys = recent.filter(o => o.symbol === p.symbol && o.side === 'buy' && o.filled_at).sort((a, z) => String(z.filled_at).localeCompare(String(a.filled_at)));
      const entry = buys[0]; if (!entry) continue;
      if (!(entry.client_order_id || '').startsWith('tbbot')) { if (buys.some(o => (o.client_order_id || '').startsWith('tbbot'))) exits.push({ s: p.symbol, held: null, why: 'not touched: you bought this stock after the bot did, so the bot cannot tell which shares are its own' }); continue; }
      const hm = /-sc\d+-h(\d+)-/.exec(entry.client_order_id || ''), hold = hm ? +hm[1] : P.hold; // manual positions are yours: the bot never touches them
      const held = weekdaysBetween(entry.filled_at, new Date());
      if (held < hold) continue;
      if (dry) { exits.push({ s: p.symbol, held, why: `held ${held} days (limit ${hold}${hm ? ', set at entry' : ''})`, preview: true }); continue; }
      try {
        for (const o of openAll.filter(o => o.symbol === p.symbol)) await pdel('/v2/orders/' + o.id).catch(() => null);
        await new Promise(r => setTimeout(r, 800)); // let the cancels release the shares
        const qty = Math.abs(+p.qty);
        await ppostSure('/v2/orders', { symbol: p.symbol, side: +p.qty > 0 ? 'sell' : 'buy', type: 'market', qty: String(qty), time_in_force: 'day', client_order_id: `tbexit-${tag}-${p.symbol}` })
          .catch(async (e) => timedOut(e) ? null : pdel('/v2/positions/' + encodeURIComponent(p.symbol))); // v0.20.0: a timed-out sell may have gone through
        exits.push({ s: p.symbol, held, why: `time exit after ${held} days` });
      } catch (e) { exits.push({ s: p.symbol, held, why: 'close failed: ' + e.message }); }
    }

    // ---- breakeven: once price has gone half way to the target, the stop moves up to entry (+ a cost cushion) ----
    const botPos = positions.map(p => ({ p, entry: recent.find(o => o.symbol === p.symbol && o.side === 'buy' && o.filled_at && (o.client_order_id || '').startsWith('tbbot')) }))
      .filter(x => x.entry && x.p.asset_class !== 'crypto' && +x.p.qty > 0 && !exits.some(e => e.s === x.p.symbol));
    const peaks = BE.on ? await peaksSince(botPos.map(x => ({ s: x.p.symbol, t: x.entry.filled_at }))) : {};
    const beOf = {}; // SYM -> breakeven stop, once triggered
    for (const { p, entry } of botPos) {
      const ex = exitsOf(entry), avg = +p.avg_entry_price, px = +p.current_price, stop0 = origStop(entry) ?? ex.stop;
      if (!BE.on || !stop0 || !ex.target) continue;
      const lv = beLevels(avg, stop0, ex.target, false), peak = Math.max(peaks[p.symbol] || 0, px);
      if (peak < lv.trigger) continue;
      const beStop = round(lv.stop); beOf[p.symbol] = beStop;
      const stopO = openAll.find(o => o.symbol === p.symbol && o.side === 'sell' && (o.type === 'stop' || o.type === 'stop_limit'));
      if (stopO && +stopO.stop_price >= beStop - 0.005) continue; // already at breakeven
      if (px <= beStop) { // it got half way, then fell back to entry: close now
        if (dry) { protect.push({ s: p.symbol, stop: beStop, why: `would close at market: reached ${round(lv.trigger)} (half way to target) then fell back to entry`, preview: true }); continue; }
        try {
          for (const o of openAll.filter(o => o.symbol === p.symbol)) await pdel('/v2/orders/' + o.id).catch(() => null);
          await new Promise(r => setTimeout(r, 800));
          await ppostSure('/v2/orders', { symbol: p.symbol, side: 'sell', type: 'market', qty: String(Math.abs(+p.qty)), time_in_force: 'day', client_order_id: `tbexit-${tag}-${p.symbol}-be` })
            .catch(async (e) => timedOut(e) ? null : pdel('/v2/positions/' + encodeURIComponent(p.symbol))); // v0.20.0: a timed-out sell may have gone through
          exits.push({ s: p.symbol, why: 'breakeven exit: got half way to target, then fell back to entry', be: true });
          protect.push({ s: p.symbol, stop: beStop, why: `closed at market (breakeven rule): reached ${round(lv.trigger)} then fell back to ${px}` });
        } catch (e) { protect.push({ s: p.symbol, why: 'breakeven close failed: ' + e.message }); }
        continue;
      }
      if (!stopO) continue; // no stop at all: the re-arm step below places it at breakeven
      if (dry) { protect.push({ s: p.symbol, stop: beStop, why: `would move stop ${+stopO.stop_price} → ${beStop} (breakeven)`, preview: true }); continue; }
      try {
        const body = { stop_price: beStop.toFixed(2), ...(stopO.type === 'stop_limit' ? { limit_price: (beStop * 0.995).toFixed(2) } : {}) };
        await ppatch('/v2/orders/' + stopO.id, { ...body, client_order_id: `tbbe-${tag}-${p.symbol}-${Date.now() % 1e6}` }).catch(() => ppatch('/v2/orders/' + stopO.id, body));
        stopO.stop_price = String(beStop);
        protect.push({ s: p.symbol, stop: beStop, why: `stop moved up to breakeven ${beStop} (price reached ${round(lv.trigger)}, half way to target)` });
      } catch (e) { protect.push({ s: p.symbol, why: `could not move the stop (${e.message}); re-arming at breakeven` }); stopO.stop_price = '0'; stopO.time_in_force = 'day'; }
    }

    // ---- protect: every bot position keeps a good-till-canceled stop + target (older 'day' brackets expire at the close) ----
    for (const p of positions) {
      if (exits.some(x => x.s === p.symbol)) continue;
      const entry = recent.find(o => o.symbol === p.symbol && o.side === 'buy' && o.filled_at && (o.client_order_id || '').startsWith('tbbot'));
      if (!entry || +p.qty <= 0) continue;
      const mine = openAll.filter(o => o.symbol === p.symbol && o.side === 'sell');
      const hasStop = mine.some(o => o.type === 'stop' || o.type === 'stop_limit'), allGtc = mine.every(o => o.time_in_force === 'gtc');
      if (hasStop && allGtc) continue;
      const lv = mine.length ? { stop: +(mine.find(o => o.stop_price)?.stop_price || 0) || null, target: +(mine.find(o => o.type === 'limit')?.limit_price || 0) || null } : {};
      const ex = exitsOf(entry); const stop = Math.max(lv.stop || ex.stop || 0, beOf[p.symbol] || 0) || null, target = lv.target || ex.target;
      if (!stop || !target) { protect.push({ s: p.symbol, why: 'could not find the original stop/target' }); continue; }
      const px = +p.current_price;
      if (px <= stop || px >= target) { protect.push({ s: p.symbol, why: `price ${px} is already past the ${px <= stop ? 'stop' : 'target'}; left for the time exit / next run` }); continue; }
      if (dry) { protect.push({ s: p.symbol, stop, target, why: 'would re-arm stop + target as good-till-canceled', preview: true }); continue; }
      try {
        const qty = Math.abs(+p.qty), cid = `${tag}-${p.symbol}-${Date.now() % 1e6}`;
        for (const o of mine) await pdel('/v2/orders/' + o.id).catch(() => null);
        for (let i = 0; i < 8 && mine.length; i++) { // wait until the cancels release the shares
          await new Promise(r => setTimeout(r, 700));
          const pos = await pget('/v2/positions/' + encodeURIComponent(p.symbol)).catch(() => null);
          if (!pos || +pos.qty_available >= qty) break;
        }
        try {
          await ppost('/v2/orders', { symbol: p.symbol, side: 'sell', type: 'limit', qty: String(qty), time_in_force: 'gtc', order_class: 'oco',
            take_profit: { limit_price: (+target).toFixed(2) }, stop_loss: { stop_price: (+stop).toFixed(2) }, client_order_id: `tbprot-${cid}` });
          protect.push({ s: p.symbol, stop, target, why: mine.length ? 'replaced day-only stop/target with good-till-canceled' : 'stop/target were missing: re-armed' });
        } catch (e1) { // at minimum keep a stop on it
          await ppost('/v2/orders', { symbol: p.symbol, side: 'sell', type: 'stop', stop_price: (+stop).toFixed(2), qty: String(qty), time_in_force: 'gtc', client_order_id: `tbprot-${cid}-s` });
          protect.push({ s: p.symbol, stop, target, why: `stop re-armed good-till-canceled (target order failed: ${e1.message})` });
        }
      } catch (e) { protect.push({ s: p.symbol, why: 're-arm failed: ' + e.message }); }
    }

    // ---- entries ----
    if (!entering) return { mode, training, exits, protect };
    if (!allow.stocks) return { mode, training, exits, protect, skipped: `No new stock trades. ${blockReason}` };
    const todays = recent.filter(o => (o.client_order_id || '').startsWith(`tbbot-${tag}-`) && o.side === 'buy' && !['canceled', 'rejected', 'expired'].includes(o.status));
    const placedToday = todays.length;
    const heldSet = new Set(positions.map(p => p.symbol).filter(s => !exits.some(x => x.s === s && !x.preview)));
    const pending = new Set(openAll.filter(o => o.side === 'buy').map(o => o.symbol));
    let gross = positions.filter(p => !exits.some(x => x.s === p.symbol && !x.preview)).reduce((a, p) => a + Math.abs(+p.market_value || 0), 0)
      + openAll.filter(o => o.side === 'buy').reduce((a, o) => a + (+o.qty || 0) * (+o.limit_price || 0), 0) + (spare || 0); // no-margin cap: bot + your positions + the DCA budget stay within equity
    const capacity = RULES.maxPositions - heldSet.size - pending.size;
    const goal = slot === 'am' || manual || !RULES.minTrades ? RULES.maxNewPerDay : RULES.minTrades; // every run may take strong setups up to the daily cap (with a minimum set, later runs only top up to it)
    const maxReq = manual && +u.get('max') > 0 ? Math.min(RULES.maxNewPerDay, Math.floor(+u.get('max'))) : null; // "Run bot now: N trades"
    let slots = Math.min(capacity, maxReq ?? (goal - placedToday), RULES.maxNewPerDay - placedToday);
    if (slots <= 0) return { training, exits, protect, placedToday, skipped: capacity <= 0 ? `At the ${RULES.maxPositions}-position limit` : `Already placed ${placedToday} trades today` };

    const universe = BOT_UNIVERSE.filter(s => !ETFS.has(s) || s === 'SPY');
    const b = await bars(universe, { timeframe: '1Day', days: 420 });
    // open (9:45 AM morning run, manual runs): finished candles only, like training. intraday (v0.14.0 scans): today's candle so far
    // (full-market day 15 minutes delayed + the newest trade), with its volume scaled to a full day by the usual intraday volume curve.
    const frac = volumeShare(minutesIntoSession(Date.now()) - 15), boughtToday = new Set(recent.filter(o => (o.client_order_id || '').startsWith(`tbbot-${tag}-`)).map(o => o.symbol));
    for (const k of Object.keys(b)) {
      if (!b[k].length || nyDate(b[k].at(-1).t) !== today) continue;
      if (mode === 'intraday' && !b[k].at(-1).f && frac > 0.05) { const L = b[k].at(-1); b[k] = [...b[k].slice(0, -1), { ...L, v: L.v / frac, partial: true }]; }
      else b[k] = b[k].slice(0, -1); // completed bars only (and: no today's candle yet from the full market → no intraday signal)
    }
    const spy = b.SPY || []; const spyRet = spy.length > 64 ? spy.at(-1).c / spy.at(-64).c - 1 : 0;
    const gap = await gapToday({ fresh: true }), gapSkip = gap?.skip || {}, gapSkipped = [];
    const all = [], blockedHits = []; // v0.16.0: paused setups are kept aside for the candidate ledger
    for (const s of universe) {
      if (s === 'SPY' || heldSet.has(s) || pending.has(s) || boughtToday.has(s)) continue; // v0.14.0: never re-buy a stock the bot already traded today
      if (gapSkip[s]) { gapSkipped.push({ s, why: gapSkip[s] }); continue; }
      const x = b[s]; if (mode === 'intraday' && !x?.at(-1)?.partial) continue; // intraday scans only look at today's candle
      const r = swingEval(s, x, spyRet); if (!r || r.dir !== 'long' || r.px < RULES.minPrice) continue;
      if (blocked.has(r.setup)) { blockedHits.push(r); continue; }
      // chase reference: yesterday's close (a breakout: the 20-day high it broke), so "already ran 0.75 ATR" means the same thing in both modes
      if (mode === 'intraday') { const prior = x.slice(-21, -1), prev = x.at(-2).c; r.px = r.setup === 'Breakout' ? Math.max(prev, ...prior.map(k => k.h)) : prev; }
      all.push(r);
    }
    all.sort((a, z) => z.score - a.score);
    const strong = all.filter(r => r.score >= minScore);
    const filler = all.filter(r => r.score < minScore && r.score >= RULES.floorScore && goodBucket(r.score));
    let queue = [...strong.map(r => ({ ...r, filler: false }))];
    const need = RULES.minTrades - placedToday;
    const want = Math.max(need, maxReq || 0);
    if (RULES.minTrades > 0 && queue.length < want) queue.push(...filler.slice(0, want - queue.length + 3).map(r => ({ ...r, filler: true })));
    queue = queue.slice(0, slots + 6);
    // News layer (v0.10.0): headlines + SEC filings per candidate. NEWS_MODE = shadow (default: recorded, trades unchanged) | gate | off.
    const nm = newsMode(), NF = nm === 'off' ? {} : await newsFeatures(queue.map(q => q.s)).catch(() => ({}));
    const nj = judge.mode === 'off' ? judge : dry ? makeJudge(ENTRY_NEWS_Q) : oncePerDay(makeJudge(ENTRY_NEWS_Q), 'entry+news');
    // v0.16.0 candidate ledger: live prices for the setups that did not make the queue too (same snapshot call)
    const extra = dry ? [] : [...all.filter(r => !queue.some(q => q.s === r.s)).slice(0, 20), ...blockedHits.slice(0, 10)].map(r => r.s);
    const [sn, J] = await Promise.all([snapshots([...new Set([...queue.map(q => q.s), ...extra])]), nj(queue.map(c => ({ s: c.s, state: { ...swingState(c, 'stock', spyRet, b[c.s]), ...(NF[c.s] ? { news: newsState(NF[c.s]) } : {}) } })))]); // AI second opinion (if on)
    const placed = [], skipped = [...gapSkipped.slice(0, 8)];
    for (const c of queue) {
      if (slots <= 0) break;
      if (c.filler && placedToday + placed.length >= RULES.minTrades && !maxReq) break;
      const q = quoteOf(c.s, sn[c.s]); const px = q?.ask || q?.p;
      if (!px) { skipped.push({ s: c.s, why: 'no live quote' }); continue; }
      if (px - c.px > RULES.chaseAtr * c.atr) { skipped.push({ s: c.s, why: `already up ${(px - c.px).toFixed(2)} since ${mode === 'intraday' && c.setup === 'Breakout' ? 'the breakout level' : "yesterday's close"} (more than ${RULES.chaseAtr} ATR)` }); continue; }
      if (px < c.px - P.stop * c.atr) { skipped.push({ s: c.s, why: 'already below where the stop would be' }); continue; }
      const jr = J.results[c.s], v = verdict(jr, J.mode), nv = newsVerdict(NF[c.s]);
      if (v.act === 'skip') { skipped.push({ s: c.s, why: v.why }); continue; }
      if (nm === 'gate' && nv.act === 'skip') { skipped.push({ s: c.s, why: 'news: ' + nv.why }); continue; }
      const stop = round(px - P.stop * c.atr), target = round(px + P.target * c.atr);
      const riskPct = (c.filler ? RULES.fillerRiskPct : RULES.riskPct) * v.size * (nm === 'gate' && nv.act === 'half' ? 0.5 : 1);
      let qty = Math.floor((equity * riskPct) / (px - stop)); qty = Math.min(qty, Math.floor((equity * RULES.maxWeight) / px));
      const room = Math.floor((equity * RULES.maxGross - gross) / px);
      if (room < qty) qty = room;
      if (qty < 1) { skipped.push({ s: c.s, why: room < 1 ? 'no room left without using margin' : 'size rounds to 0 shares' }); continue; }
      const coid = `tbbot-${tag}-${c.s}-${SLUG(c.setup)}-sc${c.score}-h${P.hold}-s${stop}${jevTag(jr)}${nm === 'off' ? '' : newsTag(NF[c.s], jr && !jr.error ? jr.nws : null)}${c.filler ? '-f' : ''}-o${mode === 'intraday' ? 'i' : 'm'}`; // -om morning (finished candle) / -oi intraday scan
      const plan = { s: c.s, setup: c.setup, score: c.score, filler: c.filler, when: mode === 'intraday' ? 'intraday' : 'morning', qty, entry: round(px), stop, target, risk: round(qty * (px - stop)), why: c.why,
        jev: jr && !jr.error ? { q: jr.q, conf: jr.conf, regime: jr.regime, down: jr.down, nws: jr.nws ?? null } : null, ai: v.why || null,
        news: NF[c.s] ? { n24: NF[c.s].n24, cats: NF[c.s].cats, earnIn: NF[c.s].earnIn, rule: nv.act, why: nv.why, mode: nm } : null };
      if (dry) { placed.push({ ...plan, preview: true }); slots--; gross += qty * px; continue; }
      if (await recentlyOrdered(c.s, `tbbot-${tag}-${c.s}-`).catch(() => true)) { skipped.push({ s: c.s, why: 'another bot run just ordered it (or Alpaca did not answer the check), so this run stood down' }); continue; } // v0.20.0 (audit #4)
      try {
        const o = await ppost('/v2/orders', { symbol: c.s, side: 'buy', type: 'market', qty: String(qty), time_in_force: 'gtc', order_class: 'bracket', // gtc: 'day' would let the stop/target legs expire at the close
          stop_loss: { stop_price: stop.toFixed(2) }, take_profit: { limit_price: target.toFixed(2) }, client_order_id: coid });
        placed.push({ ...plan, order: compactOrder(o) }); slots--; gross += qty * px;
      } catch (e) { skipped.push({ s: c.s, why: 'rejected: ' + e.message }); }
    }
    const ledger = dry ? null : await candAdd(ledgerRows({ at: new Date().toISOString(), mode: mode === 'intraday' ? 'intraday' : 'morning', P, minScore, all: all.map(r => ({ ...r })), placed, skipped, blockedHits: blockedHits.sort((a, z) => z.score - a.score), gapSkipped,
      price: (s) => { const q = quoteOf(s, sn[s]); return q?.ask || q?.p || null; } })).catch(e => ({ error: e.message }));
    const short = RULES.minTrades > 0 && placedToday + placed.length < RULES.minTrades;
    return { mode, rules: RULES, training, exits, protect, placedToday, candidates: { strong: strong.length, filler: filler.length }, ledger, placed, skipped, jev: { mode: J.mode, asked: Object.keys(J.results).length, failed: J.failed }, news: { mode: nm, checked: Object.keys(NF).length, wouldSkip: Object.entries(NF).map(([s, f]) => ({ s, ...newsVerdict(f) })).filter(x => x.act !== 'ok').map(x => ({ s: x.s, act: x.act, why: x.why })) },
      note: short ? `Only ${placedToday + placed.length} stock trades qualified so far today. Later runs will try again; the bot will not force trades that the benchmark says lose money.` : null };
  }
}

// ---- v0.14.0 helpers ----
// The cached training is current when it covers the newest finished candle, or was computed after that day's close (after a
// market holiday the newest candle is older than lastFinishedDay, so the date alone would retrain on every scan).
async function trainingFor(entering) {
  const c = await stockTraining({ cacheOnly: true });
  if (!entering) return c;
  const done = lastFinishedDay();
  if (c && ((c.lastBar && c.lastBar >= done) || Date.parse(c.cachedAt) >= Date.parse(`${done}T21:15:00Z`))) return c;
  return stockTraining({ fresh: true });
}
// Newest finished daily candle's New York date: today after 4:15 PM ET, else the last weekday before today (a holiday is not
// known here; trainingFor handles it).
export function lastFinishedDay(ms = Date.now()) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms));
  const min = (+p.find(x => x.type === 'hour').value % 24) * 60 + +p.find(x => x.type === 'minute').value;
  let d = new Date(nyDate(ms) + 'T12:00:00Z'); const wd0 = d.getUTCDay();
  if (min >= 16 * 60 + 15 && wd0 !== 0 && wd0 !== 6) return nyDate(ms);
  do d = new Date(d.getTime() - 864e5); while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}
export function minutesIntoSession(ms = Date.now()) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms));
  return (+p.find(x => x.type === 'hour').value % 24) * 60 + +p.find(x => x.type === 'minute').value - 570;
}
// Share of a normal day's volume that has usually traded m minutes after the 9:30 open (US stocks trade most at the open and
// the close: a U-shaped curve). A rough public rule of thumb, used only to compare today's volume so far with a full day.
const VCURVE = [[0, 0], [30, 0.14], [60, 0.22], [120, 0.35], [180, 0.46], [240, 0.56], [300, 0.66], [360, 0.8], [390, 1]];
export function volumeShare(m) {
  if (m <= 0) return 0; if (m >= 390) return 1;
  for (let i = 1; i < VCURVE.length; i++) if (m <= VCURVE[i][0]) { const [a, fa] = VCURVE[i - 1], [z, fz] = VCURVE[i]; return fa + (fz - fa) * (m - a) / (z - a); }
  return 1;
}
