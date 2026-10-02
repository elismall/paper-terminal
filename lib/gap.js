// Pre-market gap check (weekdays, 8:00-9:25 AM ET; places NO orders). Stocks only: crypto trades 24/7.
//  1) Holdings: phone alert for any stock gapping hard, especially through its stop (stops do not trigger before the open,
//     so they fill near the opening price, which can be worse than planned).
//  2) Skip list: stocks gapping >= 1 ATR either way are skipped by today's stock entries (no chasing, no catching knives).
// Prices: Alpaca free feed = IEX, whose pre-market session starts 8:00 AM ET, so earlier runs would see no prints.
// Result saved to Blob gap/<YYYY-MM-DD>.json; one check per day (Vercel may deliver a scheduled run twice).
import { bars, snapshots, round, SWING_UNIVERSE } from './core.js';
import { pget, realPositions } from './trade.js';
import { BOT_UNIVERSE } from './perf.js';
import { lastBuyOf } from './dca.js';
import { blobReadJson, blobWriteJson, notify } from './notify.js';

export const GAP = { skipAtr: 1.0, alertAtr: 0.75, maxPct: 50 };
const LIVE = new Set(['new', 'accepted', 'pending_new', 'partially_filled', 'held']);
const et = (t = Date.now()) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(new Date(t)); const g = (k) => p.find(x => x.type === k)?.value;
  return { day: `${g('year')}-${g('month')}-${g('day')}`, min: (+g('hour') % 24) * 60 + +g('minute'), wd: g('weekday') }; };
const keyOf = (day) => `gap/${day}.json`;
export const gapToday = (opts) => blobReadJson(keyOf(et().day), opts).catch(() => null);

// refresh (v0.14.0, the 5-minute scheduler runs it every 15 minutes from 8:00 AM, then 9:25): re-check and re-save, but alert only
// about holdings that are newly gapping (and the skip list once), so repeated checks never repeat the same phone alert.
export async function gapCheck({ force = false, refresh = false } = {}) {
  const now = et();
  const prev = await blobReadJson(keyOf(now.day), { fresh: true }).catch(() => null);
  if (!force) {
    if (['Sat', 'Sun'].includes(now.wd)) return { skipped: 'weekend' };
    if (now.min < 8 * 60 || now.min > 9 * 60 + 25) return { skipped: `outside 8:00-9:25 AM ET (now ${Math.floor(now.min / 60)}:${String(now.min % 60).padStart(2, '0')})` };
    if (prev && !refresh) return { skipped: 'already checked today' };
  }
  const clock = await pget('/v2/clock');
  if (!force && et(clock.next_open).day !== now.day) return { skipped: 'no US stock session today' };
  const [positions, open, recent] = await Promise.all([pget('/v2/positions').then(realPositions), pget('/v2/orders?status=open&limit=500&nested=true'), pget('/v2/orders?status=all&limit=500&direction=desc&nested=true')]);
  const held = positions.filter(p => p.asset_class === 'us_equity');
  const syms = [...new Set([...BOT_UNIVERSE.filter(s => s !== 'SPY'), ...SWING_UNIVERSE, ...held.map(p => p.symbol)])];
  const [daily, snap] = await Promise.all([bars(syms, { timeframe: '1Day', days: 45 }), snapshots(syms)]);
  const openAll = open.flatMap(o => [o, ...(o.legs || [])]).filter(o => LIVE.has(o.status));
  const rows = {};
  for (const s of syms) {
    const b = (daily[s] || []).filter(x => et(x.t).day < now.day); if (b.length < 16) continue;
    const prev = b.at(-1).c; let atr = 0; for (let i = b.length - 14; i < b.length; i++) atr += Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)); atr /= 14;
    const sn = snap[s] || {}, tr = sn.latestTrade, q = sn.latestQuote;
    let px = null, src = null;
    if (tr?.p && tr.t && et(tr.t).day === now.day) { px = +tr.p; src = 'trade'; }
    else if (q?.bp > 0 && q?.ap > 0 && q.t && et(q.t).day === now.day && q.ap / q.bp < 1.02) { px = (+q.bp + +q.ap) / 2; src = 'quote'; }
    if (!px) continue;
    const pct = (px / prev - 1) * 100; if (Math.abs(pct) > GAP.maxPct) continue;   // bad print
    rows[s] = { s, prev: round(prev, 2), px: round(px, 2), pct: round(pct, 2), atr: round(atr, 2), atrs: atr > 0 ? round((px - prev) / atr, 2) : null, src };
  }
  const skip = {};
  for (const r of Object.values(rows)) if (r.atrs != null && Math.abs(r.atrs) >= GAP.skipAtr)
    skip[r.s] = r.atrs > 0 ? `gapped up ${r.pct}% (${r.atrs} ATR) pre-market: no chasing today` : `gapped down ${r.pct}% (${Math.abs(r.atrs)} ATR) pre-market: let it settle first`;
  const holdings = held.map(p => {
    const r = rows[p.symbol], owner = lastBuyOf(recent, p.symbol)?.client_order_id || '';
    const stopO = openAll.find(o => o.symbol === p.symbol && o.side === 'sell' && (o.type === 'stop' || o.type === 'stop_limit'));
    const stop = stopO ? +stopO.stop_price : null;
    return { s: p.symbol, owner: /^tbbot/.test(owner) ? 'swing bot' : /^tbdca/.test(owner) ? 'DCA bot' : 'you', qty: +p.qty, prev: r?.prev ?? null, px: r?.px ?? null, pct: r?.pct ?? null, atrs: r?.atrs ?? null, stop,
      throughStop: !!(stop && r?.px && r.px <= stop), estPl: r?.px && stop && r.px <= stop ? round((r.px - +p.avg_entry_price) * +p.qty) : null, noPrint: !r };
  });
  const movers = holdings.filter(h => h.throughStop || (h.atrs != null && Math.abs(h.atrs) >= GAP.alertAtr));
  const out = { at: new Date().toISOString(), day: now.day, forced: force, marketOpen: !!clock.is_open, checked: Object.keys(rows).length, of: syms.length, holdings, movers: movers.map(h => h.s), skip,
    top: Object.values(rows).sort((a, z) => Math.abs(z.atrs || 0) - Math.abs(a.atrs || 0)).slice(0, 12) };
  out.checks = (prev?.checks || 0) + 1;
  await blobWriteJson(keyOf(now.day), out).catch(() => null);
  const fresh = movers.filter(h => !(prev?.movers || []).includes(h.s)), firstSkip = !prev && Object.keys(skip).length;
  if (fresh.length || firstSkip) {
    const lines = fresh.map(h => `${h.s} ${h.pct > 0 ? '+' : ''}${h.pct}%${h.throughStop ? ` (below its stop ${h.stop}: it will fill near the open)` : ''}`);
    await notify({ title: fresh.length ? `Pre-market: ${fresh.length} holding${fresh.length === 1 ? '' : 's'} gapping` : 'Pre-market gap check',
      body: [...lines, firstSkip ? `${Object.keys(skip).length} stock${Object.keys(skip).length === 1 ? '' : 's'} gapping 1+ ATR: the bot skips them today` : ''].filter(Boolean).join(' · ').slice(0, 900), url: '/#bot', tag: 'gap-' + now.day }).catch(() => null);
  }
  return out;
}
