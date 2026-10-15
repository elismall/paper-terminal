// Daily scoreboard (v0.10.0): one dated snapshot a day, saved after the evening crypto run (23:00 UTC ≈ 7 pm ET), so the
// project keeps its own record of what each strategy earned and which settings were live. One Blob file,
// stats/history.json (one put a day). /api/history returns it as JSON plus a Markdown table (to paste into notes or hand to another LLM).
import { round } from './core.js';
import { pget, ordersSince, realPositions } from './trade.js';
import { liveTrades, backtest, stockTraining } from './perf.js';
import { dcaLive, statsOf, lastBuyOf, dcaTraining, trainingSummary, isMeme, labLatest, bullState, parseDca } from './dca.js';
import { seasonOrders, SEASON } from './season.js';
import { blobGet, blobUpdate } from './notify.js';
import { parseNewsTag, newsMode } from './news.js';
import { jevStatus } from './jev.js';
import { cryptoSwingOn } from './cryptobot.js';
import { VERSION } from './version.js';
import { feeMode } from './fees.js';

export const HISTORY_KEY = 'stats/history.json';
const nyDay = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const st = (list) => { const s = statsOf(list); return { n: s.n, win: s.win ?? null, pnl: s.realized ?? 0, avg: s.avg ?? null, worst: s.worst ?? null }; };

export async function dailySnapshot({ version = VERSION, safety = null } = {}) {
  const [acct, positions, orders, trades, dcaT, bm, lab, bull] = await Promise.all([pget('/v2/account'), pget('/v2/positions').then(realPositions), ordersSince(120, 8), liveTrades(),
    dcaTraining({ cacheOnly: true }).catch(() => null), stockTraining({ cacheOnly: true }).then(x => x || backtest()).catch(e => ({ error: e.message })), labLatest().catch(() => null), bullState().catch(() => null)]);
  const d = nyDay(Date.now()), equity = +acct.equity, last = +acct.last_equity;
  const swing = trades.filter(t => t.setup !== 'DCA' && t.setup !== 'Manual'), dca = dcaLive(seasonOrders(orders, parseDca), positions, { charged: (await feeMode().catch(() => ({})))?.charged }); // v0.14.0: this season's deals (liveTrades is season-only too); v0.16.0: after estimated costs
  const today = (x) => x.out && nyDay(x.out) === d;
  const owner = (p) => { const c = lastBuyOf(orders, p.symbol)?.client_order_id || ''; return c.startsWith('tbdca') ? (p.asset_class === 'crypto' ? (isMeme(p.symbol) ? 'dcaMeme' : 'dcaCrypto') : 'dcaEtf') : c.startsWith('tbbot') ? 'stock' : c.startsWith('tbcry') ? 'cryptoSwing' : c.startsWith('tbhodl') ? 'cryptoCore' : 'manual'; };
  const open = { stock: 0, cryptoSwing: 0, dcaCrypto: 0, dcaMeme: 0, dcaEtf: 0, cryptoCore: 0, manual: 0 }; let openPnl = 0;
  for (const p of positions) { open[owner(p)]++; openPnl += +p.unrealized_pl || 0; }
  // closed stock-bot trades with the news tag they were bought with (news scorecard)
  const nb = orders.filter(o => o.side === 'buy' && +o.filled_qty > 0 && String(o.client_order_id || '').startsWith('tbbot-')).map(o => ({ s: o.symbol, t: Date.parse(o.filled_at), tag: parseNewsTag(o.client_order_id) })).filter(x => x.tag);
  const tagged = swing.map(t => { const m = nb.find(x => x.s === t.s && Math.abs(x.t - Date.parse(t.in)) < 36e5); return m ? { ...t, tag: m.tag } : null; }).filter(Boolean);
  const jevScored = [...swing.filter(t => t.jev != null), ...dca.closed.filter(x => x.jev != null)].map(x => ({ pnl: x.pnl, q: x.jev }));
  const T = trainingSummary(dcaT) || {};
  return {
    d, at: new Date().toISOString(), v: version, season: SEASON.n, equity: round(equity), dayPnl: round(equity - last), dayPct: last ? round((equity / last - 1) * 100, 2) : null, cash: round(+acct.cash),
    open: { ...open, openPnl: round(openPnl) },
    closedToday: { swing: st(swing.filter(today)), dca: st(dca.closed.filter(today)), dcaMeme: st(dca.closed.filter(x => today(x) && isMeme(x.s))), dcaEtf: st(dca.closed.filter(x => today(x) && x.market === 'etf')) },
    toDate: { swingStocks: st(swing.filter(t => !String(t.setup).startsWith('Crypto'))), swingCrypto: st(swing.filter(t => String(t.setup).startsWith('Crypto'))), dcaCrypto: st(dca.closed.filter(x => x.market === 'crypto' && !isMeme(x.s))),
      dcaMeme: st(dca.closed.filter(x => isMeme(x.s))), dcaEtf: st(dca.closed.filter(x => x.market === 'etf')) },
    scorecards: { jevStrong: st(jevScored.filter(x => x.q >= 2)), jevWeak: st(jevScored.filter(x => x.q < 1)), newsWouldSkip: st(tagged.filter(x => x.tag.veto)), newsClean: st(tagged.filter(x => !x.tag.veto && !x.tag.caution)), macroDay: st(tagged.filter(x => x.tag.flags.includes('C'))), insiderBuy: st(tagged.filter(x => x.tag.flags.includes('I'))),
      dcaFundHot: st(dca.closed.filter(x => x.lev === '1' || x.lev === '2')), dcaFundNormal: st(dca.closed.filter(x => x.lev === '0')), dcaLiqEasing: st(dca.closed.filter(x => x.liq === 'e')), dcaLiqTight: st(dca.closed.filter(x => x.liq === 't')) },
    settings: {
      stocks: bm?.error ? { error: bm.error } : { stop: bm?.chosen?.stop, target: bm?.chosen?.target, hold: bm?.chosen?.hold, minScore: Math.max(55, bm?.recMinScore || 65), benchWin: bm?.overallLong?.win ?? null, benchExpR: bm?.overallLong?.expR ?? null, benchN: bm?.overallLong?.n ?? 0 },
      dcaCrypto: T.crypto?.S ? { text: T.crypto.text, ret: T.crypto.ret, dd: T.crypto.dd, win: T.crypto.win, n: T.crypto.n, test: T.crypto.test } : T.crypto || null,
      dcaEtf: T.etf?.S ? { text: T.etf.text, ret: T.etf.ret, dd: T.etf.dd, win: T.etf.win, n: T.etf.n, test: T.etf.test } : T.etf || null,
      dcaLab: lab ? { at: lab.at, pickUse: lab.pick?.use, coins: lab.pick?.active, bullUse: lab.bull?.use, bull: lab.bull?.chosen } : null,
    },
    modes: { jev: jevStatus().mode, news: newsMode(), cryptoSwing: cryptoSwingOn(), bullRun: bull ? { on: bull.on, why: bull.why } : null }, safety: safety ? { level: safety.level, label: safety.label } : null,
  };
}
export async function saveDaily(snap) {
  // v0.20.0 (audit #3): a failed read throws instead of starting over from an empty scoreboard (which wiped up to 800 days)
  return blobUpdate(HISTORY_KEY, (h) => ({ ...(h || {}), days: [...(h?.days || []).filter(x => x.d !== snap.d), snap].sort((a, z) => a.d.localeCompare(z.d)).slice(-800) }), 300);
}
export const readHistory = () => blobGet(HISTORY_KEY).catch(() => null);
// Markdown for notes and for any assistant reading the project: newest day first.
const cell = (s) => !s || s.n == null ? '—' : s.n ? `${s.n} · ${s.win ?? '—'}% win · $${s.pnl}` : '0';
export function historyMarkdown(h) {
  const days = [...(h?.days || [])].reverse();
  if (!days.length) return '_No daily snapshots yet. The first one is saved after the evening crypto run (about 7 pm ET)._\n';
  const rows = days.map(x => `| ${x.d} | ${x.v || ''} | $${x.equity} | ${x.dayPnl >= 0 ? '+' : ''}$${x.dayPnl} (${x.dayPct ?? '—'}%) | ${x.open.stock} / ${x.open.dcaCrypto} / ${x.open.dcaMeme} / ${x.open.dcaEtf} / ${x.open.cryptoCore ?? 0} | $${x.open.openPnl} | ${cell(x.closedToday.swing)} | ${cell(x.closedToday.dca)} | ${cell(x.closedToday.dcaMeme)} |`);
  const L = days[0], S = L.settings || {};
  return `| Day (ET) | Version | Equity | Day P&L | Open: stock / DCA crypto / meme / ETF / bull core | Open P&L | Swing closed today | DCA closed today | …of which meme |\n|---|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n\n` +
    `**Results to date (as of ${L.d})**: stock swing ${cell(L.toDate.swingStocks)}; crypto swing ${cell(L.toDate.swingCrypto)}; DCA crypto ${cell(L.toDate.dcaCrypto)}; DCA meme ${cell(L.toDate.dcaMeme)}; DCA ETFs ${cell(L.toDate.dcaEtf)}.\n\n` +
    `**Scorecards**: Jev strong (2+) ${cell(L.scorecards.jevStrong)}; Jev weak (<1) ${cell(L.scorecards.jevWeak)}; news rule would have skipped ${cell(L.scorecards.newsWouldSkip)}; news clean ${cell(L.scorecards.newsClean)}; entered on a CPI / jobs / Fed day ${cell(L.scorecards.macroDay)}; insiders had bought ${cell(L.scorecards.insiderBuy)}; DCA deals started with hot funding ${cell(L.scorecards.dcaFundHot)} vs normal funding ${cell(L.scorecards.dcaFundNormal)}; money conditions easing ${cell(L.scorecards.dcaLiqEasing)} vs tightening ${cell(L.scorecards.dcaLiqTight)}.\n\n` +
    `**Live settings ${L.d}**: stocks stop ${S.stocks?.stop} ATR / target ${S.stocks?.target} ATR / hold ${S.stocks?.hold}, score bar ${S.stocks?.minScore}, benchmark ${S.stocks?.benchN} trades ${S.stocks?.benchWin}% win ${S.stocks?.benchExpR}R per trade; DCA crypto: ${S.dcaCrypto?.text || S.dcaCrypto?.error || '—'} (backtest ${S.dcaCrypto?.ret ?? '—'}%, walk-forward ${S.dcaCrypto?.test ?? '—'}%); DCA ETFs: ${S.dcaEtf?.text || S.dcaEtf?.error || '—'} (backtest ${S.dcaEtf?.ret ?? '—'}%, walk-forward ${S.dcaEtf?.test ?? '—'}%). Modes: Jev ${L.modes?.jev}, news ${L.modes?.news}, crypto swing ${L.modes?.cryptoSwing ? 'on' : 'off'}, bull-run mode ${L.modes?.bullRun ? (L.modes.bullRun.on ? 'ON' : 'off') + ` (${L.modes.bullRun.why})` : '—'}. DCA coins: ${S.dcaLab?.pickUse ? (S.dcaLab.coins || []).map(x => x.replace('/USD', '')).join(', ') + ' (picked by the DCA lab)' : 'hand-picked list'}.\n`;
}
