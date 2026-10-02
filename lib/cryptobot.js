// Crypto side of the bot. Paper by default; real money only in live mode (every order goes through lib/trade.js and its live guard).
// Alpaca has no bracket/OCO orders for crypto, so the bot protects each coin itself:
//   - right after a buy fills it places a standing good-till-canceled stop-limit sell (the stop),
//   - on every run it sells at market if price reached the target or the trade is past its trained holding time.
// Trained separately from stocks (crypto moves 2-3x more and costs more to trade), at half the stock risk.
import { env, bars, snapshots, quoteOf, swingEval, round } from './core.js';
import { pget, ppost, pdel } from './trade.js';
import { backtest, CRYPTO_BOT, BE, beLevels, peaksSince } from './perf.js';
import { verdict, jevTag, swingState } from './jev.js';

export const CRULES = { riskPct: 0.0025, maxWeight: 0.05, maxCryptoGross: 0.15, maxNewPerDay: 2, maxPositions: 4, chaseAtr: 0.75, minScore: 55, stopSlip: 0.01, minNotional: 10,
  // Probation: while no exit setting is proven profitable, keep collecting live data with tiny trades (paper only).
  probation: { on: true, riskPct: 0.001, maxNewPerDay: 1, minScore: 65 } };
export const flat = (s) => String(s || '').replace('/', '');
// Crypto swing ENTRIES are off unless CRYPTO_SWING=on in Vercel (Eli, 2026-09-28: crypto through the DCA bot only).
// Coins the swing bot already holds keep their stop, target, breakeven and time exit until they close.
export const cryptoSwingOn = () => String(env('CRYPTO_SWING') || '').toLowerCase() === 'on';
const SLUG = (s) => s.replace(/[^A-Za-z]/g, '').toLowerCase();
const wait = (ms) => new Promise(r => setTimeout(r, ms));
export const floorTo = (v, inc) => inc > 0 ? Math.floor(v / inc + 1e-9) * inc : v;
const dec = (inc) => { const s = String(inc); return s.includes('e-') ? +s.split('e-')[1] : (s.split('.')[1] || '').length; };
export const fmt = (v, inc) => (inc > 0 ? floorTo(v, inc) : v).toFixed(Math.min(9, inc > 0 ? dec(inc) : v >= 100 ? 2 : v >= 1 ? 4 : 6));
// Parse the bot's crypto order id: tbcry-YYYYMMDD-SOLUSD-pullback-sc70-h10-s142.51-t160.2
export function parseCry(coid) {
  const m = /^tbcry-(\d{8})-([A-Z0-9]+)-([a-z]+)-sc(\d+)-h(\d+)-s([\d.]+)-t([\d.]+)/.exec(coid || '');
  return m ? { date: m[1], sym: m[2], setup: m[3], score: +m[4], hold: +m[5], stop: +m[6], target: +m[7], probation: /-p$/.test(coid) } : null;
}
export async function assetInfo(sym) {
  const a = await pget('/v2/assets/' + encodeURIComponent(sym)).catch(() => null);
  return { qtyInc: +(a?.min_trade_increment || 0) || 1e-8, pxInc: +(a?.price_increment || 0) || 0, minQty: +(a?.min_order_size || 0) || 0, tradable: a ? a.tradable !== false : true };
}
async function sellAll(sym, qty, coid) {
  return ppost('/v2/orders', { symbol: sym, side: 'sell', type: 'market', qty: String(qty), time_in_force: 'gtc', client_order_id: coid });
}

// ctx: { equity, dry, tag, positions, openAll, recent, allowEntries, blockReason, grossNow, judge }
export async function runCrypto(ctx) {
  const { equity, dry, tag, positions, openAll, recent } = ctx;
  const out = { training: null, exits: [], protect: [], placed: [], skipped: [], note: null, swingOn: cryptoSwingOn() };
  // ---- training (only needed for new entries) ----
  const bm = out.swingOn ? await backtest({ crypto: true }).catch(e => ({ error: e.message })) : null;
  const P = bm?.chosen || { stop: 1.5, target: 2, hold: 5 };
  const minScore = Math.max(CRULES.minScore, bm?.recMinScore || 65);
  const blocked = new Set(Object.entries(bm?.bySetup || {}).filter(([, st]) => st.n >= 20 && st.expR < 0).map(([k]) => k));
  const probation = !bm?.error && !bm?.proven && CRULES.probation.on;
  out.training = { exits: P, minScore: probation ? CRULES.probation.minScore : minScore, proven: probation ? null : !!bm?.proven, probation, blocked: [...blocked], benchWin: bm?.overallLong?.win ?? null, benchExpR: bm?.overallLong?.expR ?? null, benchTrades: bm?.overallLong?.n ?? 0, error: bm?.error };

  // ---- manage bot coins: target, time exit, standing stop ----
  const mineP = positions.filter(p => p.asset_class === 'crypto');
  // a coin is this bot's only if its most recent buy was this bot's entry (the DCA bot or you may hold the same coin later)
  const entryOf = (sym) => { const o = recent.find(x => x.side === 'buy' && +x.filled_qty > 0 && x.filled_at && flat(x.symbol) === flat(sym)); return o && (o.client_order_id || '').startsWith('tbcry') ? o : null; };
  const botHeld = [];
  const held = mineP.map(p => ({ p, e: entryOf(p.symbol) })).filter(x => x.e && parseCry(x.e.client_order_id));
  const peaks = BE.on ? await peaksSince(held.map(x => ({ s: x.e.symbol, t: x.e.filled_at }))).catch(() => ({})) : {};
  for (const p of mineP) {
    const e = entryOf(p.symbol); const meta = parseCry(e?.client_order_id);
    if (!e || !meta) continue;                                                     // your own coins: never touched
    const sym = e.symbol, px = +p.current_price, qty = +p.qty_available || +p.qty;
    botHeld.push(flat(sym));
    const days = (Date.now() - new Date(e.filled_at)) / 864e5;
    const orders = openAll.filter(o => flat(o.symbol) === flat(sym) && o.side === 'sell');
    const stopO = orders.find(o => o.type === 'stop_limit' || o.type === 'stop'), hasStop = !!stopO;
    // breakeven: once price has gone half way to the target, the stop moves up to entry + a cushion for fees
    const lv = BE.on ? beLevels(+p.avg_entry_price, meta.stop, meta.target, true) : null;
    const beOn = lv && Math.max(peaks[sym] || 0, px) >= lv.trigger;
    const stopNow = beOn ? Math.max(meta.stop, lv.stop) : meta.stop;
    const why = px >= meta.target ? 'tgt' : days >= meta.hold ? 'time' : beOn && px <= stopNow ? 'be' : px <= meta.stop && !hasStop ? 'stop' : null;
    if (why) {
      const text = why === 'tgt' ? `target ${meta.target} reached (price ${px})` : why === 'time' ? `time exit after ${days.toFixed(1)} days` : why === 'be' ? `breakeven exit: reached ${fmt(lv.trigger, 0)} (half way to target), then fell back to entry` : `below stop ${meta.stop} with no stop order: sold`;
      if (dry) { out.exits.push({ s: sym, why: text, preview: true }); continue; }
      try {
        for (const o of orders) await pdel('/v2/orders/' + o.id).catch(() => null);
        if (orders.length) await wait(900);
        const fresh = await pget('/v2/positions/' + flat(sym)).catch(() => p);
        await sellAll(sym, fresh.qty_available || fresh.qty, `tbcx-${tag}-${flat(sym)}-${why}-${Date.now() % 1e6}`);
        out.exits.push({ s: sym, why: text });
      } catch (err) { out.exits.push({ s: sym, why: 'exit failed: ' + err.message }); }
      continue;
    }
    const moveUp = beOn && hasStop && +stopO.stop_price < stopNow * 0.9995;
    if (!hasStop || moveUp) {
      const label = beOn ? `stop at breakeven ${fmt(stopNow, 0)}` : 'standing stop';
      if (dry) { out.protect.push({ s: sym, stop: stopNow, why: moveUp ? `would move the stop ${+stopO.stop_price} → ${fmt(stopNow, 0)} (breakeven)` : `would place the ${label}`, preview: true }); continue; }
      try {
        const ai = await assetInfo(sym);
        if (moveUp) { await pdel('/v2/orders/' + stopO.id); await wait(900); }
        const fresh = moveUp ? await pget('/v2/positions/' + flat(sym)).catch(() => p) : p;
        const q = floorTo(+fresh.qty_available || qty, ai.qtyInc);
        await ppost('/v2/orders', { symbol: sym, side: 'sell', type: 'stop_limit', qty: fmt(q, ai.qtyInc), stop_price: fmt(stopNow, ai.pxInc), limit_price: fmt(stopNow * (1 - CRULES.stopSlip), ai.pxInc), time_in_force: 'gtc', client_order_id: `tbcstop-${tag}-${flat(sym)}-${Date.now() % 1e6}${beOn ? '-be' : ''}` });
        out.protect.push({ s: sym, stop: stopNow, why: moveUp ? `stop moved up to breakeven ${fmt(stopNow, ai.pxInc)} (price reached half way to target)` : `${label} placed` });
      } catch (err) { out.protect.push({ s: sym, why: 'stop failed: ' + err.message }); }
    }
  }

  // ---- entries ----
  if (!out.swingOn) { out.training = null; out.note = 'Crypto swing entries are off (CRYPTO_SWING is not "on"): crypto buys go through the DCA bot only. Coins the swing bot still holds keep their stops and targets.'; return out; }
  if (!ctx.allowEntries) { out.note = ctx.blockReason || null; return out; }
  if (bm?.error) { out.note = 'Crypto training failed this run, so no new crypto trades: ' + bm.error; return out; }
  if (!bm.proven && !probation) { out.note = 'No crypto exit setting made money over enough historical trades, so the bot is not opening crypto trades right now.'; return out; }
  const maxNew = probation ? CRULES.probation.maxNewPerDay : CRULES.maxNewPerDay, floor = probation ? CRULES.probation.minScore : minScore, riskPct = probation ? CRULES.probation.riskPct : CRULES.riskPct;
  if (probation) out.note = `Probation: history has not proven a profitable crypto setting yet (best: ${bm.overallLong?.n ?? 0} trades, ${bm.overallLong?.expR ?? '?'}R each), so the bot takes at most ${maxNew} crypto trade a day at ${riskPct * 100}% risk, score ${floor}+, to collect live results.`;
  const placedToday = recent.filter(o => (o.client_order_id || '').startsWith(`tbcry-${tag}-`) && !['canceled', 'rejected', 'expired'].includes(o.status)).length;
  let slots = Math.min(maxNew - placedToday, CRULES.maxPositions - botHeld.length);
  if (slots <= 0) { out.note = (out.note ? out.note + ' ' : '') + (placedToday >= maxNew ? `Already placed ${placedToday} crypto trade${placedToday === 1 ? '' : 's'} today.` : `At the ${CRULES.maxPositions}-coin limit.`); return out; }
  let cryptoGross = mineP.filter(p => botHeld.includes(flat(p.symbol))).reduce((a, p) => a + Math.abs(+p.market_value || 0), 0);   // this bot's coins only (the DCA bot has its own budget)
  let gross = ctx.grossNow;
  const pending = new Set(openAll.filter(o => o.side === 'buy').map(o => flat(o.symbol)));
  const b = await bars(CRYPTO_BOT, { timeframe: '1Day', days: 420 });
  const todayUTC = new Date().toISOString().slice(0, 10);
  for (const k of Object.keys(b)) if (b[k].length && String(b[k].at(-1).t).slice(0, 10) === todayUTC) b[k] = b[k].slice(0, -1);   // completed days only
  const btc = b['BTC/USD'] || []; const bench = btc.length > 64 ? btc.at(-1).c / btc.at(-64).c - 1 : 0;
  const cands = [];
  for (const s of CRYPTO_BOT) {
    if (botHeld.includes(flat(s)) || pending.has(flat(s)) || mineP.some(p => flat(p.symbol) === flat(s))) continue;
    const r = swingEval(s, b[s], s === 'BTC/USD' ? 0 : bench);
    if (r && r.dir === 'long' && r.score >= floor && !blocked.has(r.setup)) cands.push(r);
  }
  cands.sort((a, z) => z.score - a.score);
  if (!cands.length) { out.note = (out.note ? out.note + ' ' : '') + `No coin passes the rules right now (score ${floor}+).`; return out; }
  const look = cands.slice(0, slots + 4);
  const [sn, J] = await Promise.all([snapshots(look.map(c => c.s)), ctx.judge ? ctx.judge(look.map(c => ({ s: c.s, state: swingState(c, 'crypto', bench, b[c.s]) }))) : { mode: 'off', results: {}, failed: 0 }]);
  out.jev = { mode: J.mode, asked: Object.keys(J.results).length, failed: J.failed };
  for (const c of look) {
    if (slots <= 0) break;
    const q = quoteOf(c.s, sn[c.s]); const px = q?.ask || q?.p;
    if (!px) { out.skipped.push({ s: c.s, why: 'no live quote' }); continue; }
    if (px - c.px > CRULES.chaseAtr * c.atr) { out.skipped.push({ s: c.s, why: `already up more than ${CRULES.chaseAtr} ATR since the daily close` }); continue; }
    const ai = await assetInfo(c.s);
    if (!ai.tradable) { out.skipped.push({ s: c.s, why: 'not tradable on Alpaca right now' }); continue; }
    const stop = +fmt(px - P.stop * c.atr, ai.pxInc), target = +fmt(px + P.target * c.atr, ai.pxInc);
    if (!(stop > 0 && stop < px)) { out.skipped.push({ s: c.s, why: 'stop would be at or below zero' }); continue; }
    const jr = J.results[c.s], v = verdict(jr, J.mode);
    if (v.act === 'skip') { out.skipped.push({ s: c.s, why: v.why }); continue; }
    let qty = (equity * riskPct * v.size) / (px - stop);
    qty = Math.min(qty, (equity * CRULES.maxWeight) / px, Math.max(0, equity * CRULES.maxCryptoGross - cryptoGross) / px, Math.max(0, equity - gross) / px);
    qty = floorTo(qty, ai.qtyInc);
    if (qty * px < CRULES.minNotional || qty < ai.minQty) { out.skipped.push({ s: c.s, why: 'no room under the crypto (15%) or no-margin cap' }); continue; }
    const coid = `tbcry-${tag}-${flat(c.s)}-${SLUG(c.setup)}-sc${c.score}-h${P.hold}-s${stop}-t${target}${jevTag(jr)}${probation ? '-p' : ''}`;
    const plan = { s: c.s, setup: c.setup + (probation ? ' (probation, 0.1% risk)' : ''), score: c.score, qty: +fmt(qty, ai.qtyInc), entry: round(px, px < 1 ? 6 : 2), stop, target, risk: round(qty * (px - stop)), why: c.why + (v.why ? ` · ${v.why}` : ''), jev: jr && !jr.error ? jr : null };
    if (dry) { out.placed.push({ ...plan, preview: true }); slots--; cryptoGross += qty * px; gross += qty * px; continue; }
    try {
      const o = await ppost('/v2/orders', { symbol: c.s, side: 'buy', type: 'market', qty: fmt(qty, ai.qtyInc), time_in_force: 'gtc', client_order_id: coid });
      slots--; cryptoGross += qty * px; gross += qty * px;
      let filled = o.status === 'filled' ? o : null;
      for (let i = 0; i < 6 && !filled; i++) { await wait(600); const x = await pget('/v2/orders/' + o.id).catch(() => null); if (x?.status === 'filled') filled = x; }
      let stopNote = 'stop will be placed on the next run';
      if (filled) {
        const pos = await pget('/v2/positions/' + flat(c.s)).catch(() => null);
        const sq = floorTo(+(pos?.qty_available || filled.filled_qty), ai.qtyInc);
        await ppost('/v2/orders', { symbol: c.s, side: 'sell', type: 'stop_limit', qty: fmt(sq, ai.qtyInc), stop_price: fmt(stop, ai.pxInc), limit_price: fmt(stop * (1 - CRULES.stopSlip), ai.pxInc), time_in_force: 'gtc', client_order_id: `tbcstop-${tag}-${flat(c.s)}-${Date.now() % 1e6}` })
          .then(() => { stopNote = 'standing stop placed'; }).catch(err => { stopNote = 'stop failed (next run retries): ' + err.message; });
      }
      out.placed.push({ ...plan, status: filled ? 'filled' : o.status, fill: filled ? +filled.filled_avg_price : null, stopNote });
    } catch (err) { out.skipped.push({ s: c.s, why: 'rejected: ' + err.message }); }
  }
  return out;
}
