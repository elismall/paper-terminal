// AI hold review (Jev, SHADOW ONLY): after each real bot run, every open swing position (stocks + swing crypto) gets a
// second opinion on whether the move is likely to continue. Saved to Blob and shown on the Bot tab trade cards.
// It never moves a stop or sells anything; the scorecard decides later whether it earns that right.
import { bars, round } from './core.js';
import { lastBuyOf } from './dca.js';
import { flat, parseCry } from './cryptobot.js';
import { makeJudge, REVIEW_Q, chartState, JLOG } from './jev.js';
import { blobReadJson, blobWriteJson, blobUpdate } from './notify.js';

const KEY = 'jev/review.json';
const nyDay = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

export async function holdReview({ positions, recent, openAll }) {
  const judge = makeJudge(REVIEW_Q); if (judge.mode === 'off') return { mode: 'off' };
  const items = [];
  for (const p of positions) {
    const e = lastBuyOf(recent, p.symbol), coid = e?.client_order_id || '';
    if (!/^tb(bot|cry)-/.test(coid)) continue;                                  // swing bot positions only
    const crypto = coid.startsWith('tbcry'), sells = openAll.filter(o => o.side === 'sell' && flat(o.symbol) === flat(p.symbol));
    const stop = +(sells.find(o => o.type === 'stop' || o.type === 'stop_limit')?.stop_price || 0) || (crypto ? parseCry(coid)?.stop : null);
    const target = +(sells.find(o => o.type === 'limit')?.limit_price || 0) || (crypto ? parseCry(coid)?.target : null);
    items.push({ s: crypto ? e.symbol : p.symbol, coid, crypto, avg: +p.avg_entry_price, px: +p.current_price, stop, target, t: e.filled_at });
  }
  if (!items.length) {                                                            // write only when it changes (Blob put budget)
    const prev = await blobReadJson(KEY, { fresh: true }).catch(() => null);
    if (Object.keys(prev?.items || {}).length) await blobWriteJson(KEY, { at: new Date().toISOString(), items: {} }).catch(() => null);
    return { mode: judge.mode, asked: 0 };
  }
  const st = items.filter(i => !i.crypto).map(i => i.s), cr = items.filter(i => i.crypto).map(i => i.s);
  const [bs, bc] = await Promise.all([st.length ? bars(st, { timeframe: '1Day', days: 400 }) : {}, cr.length ? bars(cr, { timeframe: '1Day', days: 400 }) : {}]);
  const today = nyDay(Date.now()), todayUTC = new Date().toISOString().slice(0, 10);
  const done = (i) => (i.crypto ? bc : bs)[i.s]?.filter(x => (i.crypto ? String(x.t).slice(0, 10) < todayUTC : nyDay(x.t) < today)) || [];
  const pct = (a, z) => a && z ? round((a / z - 1) * 100, 2) : null;
  const J = await judge(items.map(i => ({ s: i.s, state: { asset: i.crypto ? 'crypto' : 'stock', position: {
    pnl_pct: pct(i.px, i.avg), pct_to_stop: pct(i.stop, i.px), pct_to_target: pct(i.target, i.px),
    days_held: round((Date.now() - Date.parse(i.t)) / 864e5, 1), price_now_vs_last_close_pct: pct(i.px, done(i).at(-1)?.c) }, chart: chartState(done(i)) } })));
  const out = { at: new Date().toISOString(), mode: J.mode, items: {} };
  for (const i of items) { const r = J.results[i.s]; if (r && !r.error) out.items[i.coid] = { s: i.s, ...r }; }
  await blobWriteJson(KEY, out).catch(() => null);
  return { mode: J.mode, asked: items.length, failed: J.failed };
}
export const lastReview = () => blobReadJson(KEY).catch(() => null);

// Rolling log of the bots' last Jev calls (exact numbers sent, answers, what the bot did) for the Jev tab.
const LOGKEY = 'jev/log.json';
export async function saveJevLog(did) {
  const fresh = JLOG.splice(0).map(x => ({ ...x, did: did(x) }));
  if (!fresh.length) return 0;
  // v0.20.0 (audit #3): an unreadable log is left alone (this run's calls are dropped) instead of being replaced by them alone
  await blobUpdate(LOGKEY, (L) => ({ at: new Date().toISOString(), items: [...fresh.reverse(), ...(L?.items || [])].slice(0, 60) }), 300).catch(() => null);
  return fresh.length;
}
export const readJevLog = () => blobReadJson(LOGKEY).catch(() => null);
