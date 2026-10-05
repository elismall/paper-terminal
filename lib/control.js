// Kill switch + fallback ladder for all three bots (paper, or live mode via lib/trade.js).
// Kill switch: "pause" stops NEW trades for every bot (stops, targets, breakeven moves, DCA take profits keep working);
// "emergency stop" also cancels the bots' orders and closes every position a bot opened. Your own positions are never touched.
// The state lives in Vercel Blob as control/mode.json. Bot runs read it fresh (bypassing the CDN); the page may see it up to
// 60 s late, so the app shows the result of your own Pause/Resume right away. No list calls (Hobby: 2,000 put/list a month).
// Fallback ladder, checked at the start of every run:
//   1 Normal   everything on
//   2 Caution  something degraded but safe (AI filter unavailable -> rules only)
//   3 Hold     no new trades THIS run (daily loss limit, stale market data); open trades still managed
//   4 Stopped  no new trades until you resume (you paused, BOT_PAUSED, or the drawdown limit auto-paused it)
import { env, snapshots, quoteOf, round } from './core.js';
import { pget, pdel, realPositions } from './trade.js';
import { blobPut, blobList, blobDel, blobCreate, blobGet, blobUrl, notify } from './notify.js';
import { lastBuyOf } from './dca.js';
import { flat } from './cryptobot.js';

export const RISK = { maxDrawdown: 0.08, dailyStop: -0.02, staleStockMin: 20, staleCryptoMin: 45, lockSec: 320 }; // lockSec > the 300 s function limit (vercel.json), so a live run's lock never expires under it
const LABEL = { 1: 'Normal', 2: 'Caution', 3: 'Hold', 4: 'Stopped' };
// Every bot's order-id prefixes (v0.12.1: tbhodl = bull-run core added; the emergency stop missed it before).
export const BOT_BUY = /^tb(bot|cry|dca|hodl)/, BOT_ANY = /^tb(bot|cry|dca|hodl|prot|cstop|be|exit|cx)/;
const botOwned = (orders, sym) => BOT_BUY.test(lastBuyOf(orders, sym)?.client_order_id || '');

const MODE = 'control/mode.json', LOCK = 'control/lock.json', LAST = 'control/last.json';
// Throws when the state cannot be read (v0.17.3): an unreadable kill switch must never look like "run".
export async function getMode({ fresh = false } = {}) {
  let j = await blobGet(MODE, { fresh, strict: true });
  if (!j) j = await migrateMode();
  return { mode: j?.mode === 'pause' ? 'pause' : 'run', by: j?.by || 'you', at: j?.at || null, reason: j?.reason || null };
}
// Older builds kept the state in file names (control/mode-*, control/last-*, control/lock-*). Moved once, then removed.
let migrated = false;
async function migrateMode() {
  if (migrated) return null; migrated = true;
  const now = await blobGet(MODE, { fresh: true, strict: true }); if (now) return now; // a CDN copy can lag: never overwrite a real state; a read error throws, so only a confirmed-missing file is migrated
  const files = await blobList('control/').catch(() => null); if (!files) return null;
  const m = files.map(f => { const x = /^control\/mode-(run|pause)-(you|auto)-(\d+)\.json$/.exec(f.pathname); return x ? { mode: x[1], by: x[2], at: +x[3], url: f.url } : null; }).filter(Boolean).sort((a, z) => z.at - a.at)[0];
  let reason = null; if (m) { const r = await fetch(`${m.url}?v=${Date.now()}`, { cache: 'no-store' }).catch(() => null); reason = r?.ok ? (await r.json().catch(() => ({}))).reason || null : null; }
  const j = { mode: m?.mode || 'run', by: m?.by || 'you', at: m ? new Date(m.at).toISOString() : null, reason };
  await blobPut(MODE, JSON.stringify(j), { maxAge: 60 }).catch(() => null);
  const old = files.filter(f => /^control\/(mode|last|lock)-/.test(f.pathname)).map(f => f.url);
  if (old.length) await blobDel(old).catch(() => null);
  return j;
}
export async function setMode(mode, by, reason) {
  const j = { mode, by, at: new Date().toISOString(), reason: reason || null };
  await blobPut(MODE, JSON.stringify(j), { maxAge: 60 });
  return j;
}

// One run at a time (Vercel can deliver the same scheduled run twice, and a manual or hourly run can overlap another).
// control/lock.json is created only if absent (1 put); a lock older than lockSec is treated as abandoned.
export async function acquireLock() {
  const now = Date.now(), body = JSON.stringify({ at: now });
  let r = await blobCreate(LOCK, body).catch(() => null);
  if (r === 'exists') {
    const cur = await blobGet(LOCK, { fresh: true, strict: true }).catch(() => undefined);
    if (cur === undefined) return { name: LOCK, url: null, unconfirmed: true }; // can't read the holder's lock: never delete it
    if (cur?.at && now - cur.at < RISK.lockSec * 1000) return null;
    await blobDel([blobUrl(LOCK)]).catch(() => null);
    r = await blobCreate(LOCK, body).catch(() => null);
    if (r === 'exists') return null;
  }
  if (!r) return { name: LOCK, url: null, unconfirmed: true }; // store down (v0.12.1): exits still run, but the ladder blocks new trades
  return { name: LOCK, url: r.url };
}
export const releaseLock = (lock) => lock?.url ? blobDel([lock.url]).catch(() => null) : null;
// Free mode (v0.17.1, Vercel Hobby: 2,000 Blob writes a month): scheduled ticks come every 15 minutes and a run ends within the
// 300 s function limit, so two scheduled runs can never overlap. They only READ the lock (a simple operation) and stand down if a
// manual run holds it; they never write one. Manual runs still take the real lock.
export async function checkLock() {
  const cur = await blobGet(LOCK, { fresh: true, strict: true }).catch(() => undefined);
  if (cur === undefined) return { name: LOCK, url: null, unconfirmed: true }; // read error: the ladder blocks new trades
  return cur?.at && Date.now() - cur.at < RISK.lockSec * 1000 ? null : { name: LOCK, url: null, checked: true };
}

// ctx: { dry, clock, equity, last } -> { level, label, reasons[], entries: { stocks, crypto, dca }, mode }
export async function ladder({ dry, clock, equity, last, lockUnconfirmed }) {
  const reasons = [], entries = { stocks: true, crypto: true, dca: true }; let level = 1;
  const bump = (l, why, which = ['stocks', 'crypto', 'dca']) => { level = Math.max(level, l); reasons.push(why); if (l >= 3) for (const k of which) entries[k] = false; };
  if (lockUnconfirmed) bump(3, 'the one-run-at-a-time lock could not be confirmed (storage unreachable), so no new trades this run; exits and protection still run');
  let mode = await getMode({ fresh: true }).catch(() => null);
  if (!mode) { bump(3, 'the kill switch state could not be read (storage unreachable), so no new trades this run; exits and protection still run'); mode = { mode: 'unknown' }; }
  if (env('BOT_PAUSED') === 'true') bump(4, 'BOT_PAUSED is true in Vercel settings');
  if (mode.mode === 'pause') bump(4, mode.by === 'auto' ? `Auto-paused: ${mode.reason || 'risk limit'}` : 'Paused by you (kill switch)');
  // drawdown from the best close of the last month
  const hist = await pget('/v2/account/portfolio/history?period=1M&timeframe=1D').catch(() => null);
  const peak = Math.max(equity, ...((hist?.equity || []).filter(v => v > 0)));
  const dd = peak > 0 ? (peak - equity) / peak : 0;
  if (dd >= RISK.maxDrawdown && mode.mode !== 'pause') {
    const why = `account is ${(dd * 100).toFixed(1)}% below its 1-month high (limit ${RISK.maxDrawdown * 100}%)`;
    bump(4, `Auto-paused: ${why}`);
    if (!dry) { await setMode('pause', 'auto', why).catch(() => null); await notify({ title: 'Bot auto-paused', body: `No new trades: ${why}. Open trades keep their stops. Resume from the Bot tab when ready.`, url: '/#bot', tag: 'killswitch' }).catch(() => null); }
    mode = { ...mode, mode: 'pause', by: 'auto' };
  }
  if (last > 0 && equity / last - 1 <= RISK.dailyStop) bump(3, `down ${((equity / last - 1) * 100).toFixed(2)}% today (limit ${RISK.dailyStop * 100}%): no new trades today`);
  // stale data: never trade on old prices
  const sn = await snapshots(['SPY', 'BTC/USD']).catch(() => ({}));
  const age = (s) => { const t = quoteOf(s, sn[s])?.t; return t ? (Date.now() - Date.parse(t)) / 6e4 : Infinity; };
  const spyAge = age('SPY'), btcAge = age('BTC/USD');
  if (clock?.is_open && spyAge > RISK.staleStockMin) bump(3, `stock prices look stale (SPY last trade ${Number.isFinite(spyAge) ? Math.round(spyAge) + ' min' : 'unknown'} ago)`, ['stocks', 'dca']);
  if (btcAge > RISK.staleCryptoMin) bump(3, `crypto prices look stale (BTC last trade ${Number.isFinite(btcAge) ? Math.round(btcAge) + ' min' : 'unknown'} ago)`, ['crypto', 'dca']);
  return { level, label: LABEL[level], reasons, entries, mode: mode.mode, drawdown: round(dd * 100, 2) };
}
export async function saveLastRun(safety) {
  await blobPut(LAST, JSON.stringify({ ...safety, at: new Date().toISOString() }), { maxAge: 120 }).catch(() => null);
}
export const lastRun = () => blobGet(LAST).catch(() => null);

// Emergency stop: pause, cancel the bots' orders, close every bot-opened position at market.
export async function emergencyStop(ordersRecent) {
  await setMode('pause', 'you', 'emergency stop');
  const [positions, open] = await Promise.all([pget('/v2/positions').then(realPositions), pget('/v2/orders?status=open&limit=500&nested=false')]);
  const closed = [], canceled = [], errors = [];
  for (const o of open) if (BOT_ANY.test(o.client_order_id || '') || positions.some(p => flat(p.symbol) === flat(o.symbol) && botOwned(ordersRecent, p.symbol)))
    await pdel('/v2/orders/' + o.id).then(() => canceled.push(o.symbol)).catch(e => errors.push(`${o.symbol}: ${e.message}`));
  if (canceled.length) await new Promise(r => setTimeout(r, 1200));
  for (const p of positions) {
    if (!botOwned(ordersRecent, p.symbol)) continue; // your own positions stay
    await pdel('/v2/positions/' + encodeURIComponent(flat(p.symbol))).then(() => closed.push({ s: p.symbol, pl: round(+p.unrealized_pl) })).catch(e => errors.push(`${p.symbol}: ${e.message}`));
  }
  const pl = round(closed.reduce((a, c) => a + (c.pl || 0), 0));
  // v0.12.1: check what is really left (a close can fail or fill partly) and say so instead of assuming it worked
  if (closed.length) await new Promise(r => setTimeout(r, 1500));
  const after = closed.length || errors.length ? await pget('/v2/positions').then(realPositions).catch(() => null) : positions.filter(p => botOwned(ordersRecent, p.symbol));
  const left = after ? after.filter(p => botOwned(ordersRecent, p.symbol)).map(p => ({ s: p.symbol, qty: +p.qty, value: round(+p.market_value) })) : null;
  await notify({ title: 'Emergency stop', body: `Closed ${closed.length} bot position${closed.length === 1 ? '' : 's'} (${pl >= 0 ? '+' : '−'}$${Math.abs(pl).toFixed(2)} open P&L), canceled ${canceled.length} order${canceled.length === 1 ? '' : 's'}. Bots paused until you resume.${left?.length ? ` Still open: ${left.map(l => l.s).join(', ')}.` : left === null ? ' Could not re-check positions.' : ''}`, url: '/#bot', tag: 'killswitch' }).catch(() => null);
  return { closed, canceled: canceled.length, errors, pl, left, checked: left !== null };
}
