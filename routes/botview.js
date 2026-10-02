import { json, authorized, hasAlpaca, needKeys, fail, bars, swingEval, round } from '../lib/core.js';
import { pget, ordersSince, realPositions } from '../lib/trade.js';
import { nyDate, weekdaysBetween, flatOpen, exitsOf, origStop, RULES } from '../lib/botcore.js';
import { parseCry, flat } from '../lib/cryptobot.js';
import { lastReview } from '../lib/review.js';
import { dcaDeals, dcaTraining, trainingSummary, parseDca, lastBuyOf, DCA, budgetOf, FILTERS, trailPlan, isMeme, tradableSyms, bullState, minExitPx } from '../lib/dca.js';
import { parseNewsTag, newsTagText } from '../lib/news.js';
const rp = (v) => round(v, Math.abs(v) < 0.01 ? 12 : 6);   // prices: keep meme-coin precision (PEPE trades around $0.00001)
import { cryptoSwingOn } from '../lib/cryptobot.js';
import { SEASON } from '../lib/season.js';
// Bot tab: open bot trades with the reasoning behind each entry, live stop/target, a chart since entry,
// and an event feed (sent, filled, stop hit, target hit, time exit, re-armed); plus the DCA bot's open deals. Passcode required; never cached.

const SETUPS = { breakout: 'Breakout', pullback: 'Pullback', oversoldinuptrend: 'Oversold in uptrend', breakdown: 'Breakdown' };
const memo = new Map();                                   // per-instance cache so 20-second polling stays light
async function cached(key, ttl, fn) { const m = memo.get(key); if (m && Date.now() - m.t < ttl) return m.v; const v = await fn(); memo.set(key, { t: Date.now(), v }); if (memo.size > 200) memo.delete(memo.keys().next().value); return v; }
const utcDate = (t) => new Date(t).toISOString().slice(0, 10);
const nyMin = (t) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(t)); const h = +p.find(x => x.type === 'hour').value % 24, m = +p.find(x => x.type === 'minute').value; return h * 60 + m; };
const addWeekdays = (d0, n) => { const d = new Date(d0); d.setUTCHours(12); let k = 0; while (k < n) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w && w !== 6) k++; } return d.toISOString().slice(0, 10); };
const kindOf = (coid = '') => coid.startsWith('tbbot') ? 'entry' : coid.startsWith('tbcry') ? 'centry' : coid.startsWith('tbexit') ? 'exit' : coid.startsWith('tbprot') ? 'prot' : coid.startsWith('tbcx') ? 'cexit' : coid.startsWith('tbcstop') ? 'cstop' : coid.startsWith('tbbe') ? 'be' : null;

function parseStock(coid) {
  const p = (coid || '').split('-'); if (p[0] !== 'tbbot') return null;
  const rest = p.slice(4);
  return { date: p[1], sym: p[2], setup: SETUPS[p[3]] || p[3], score: +(rest.find(x => /^sc\d+$/.test(x)) || 'sc0').slice(2) || null, hold: +(rest.find(x => /^h\d+$/.test(x)) || 'h0').slice(1) || 10, filler: rest.includes('f'),
    when: rest.includes('om') ? 'morning' : rest.includes('oi') ? 'intraday' : null }; // v0.14.0: which run bought it
}

export async function GET(req) {
  if (!authorized(req, { strict: true })) return json({ error: 'locked', message: 'Enter your passcode in Settings to see the bot.' }, { status: 401 });
  if (!hasAlpaca()) return needKeys('the bot view');
  try {
    const [clock, acct, positions, open, orders, dcaT, rev] = await Promise.all([pget('/v2/clock'), pget('/v2/account'), pget('/v2/positions').then(realPositions),
      pget('/v2/orders?status=open&limit=500&nested=true'), ordersSince(40), cached('dcaT', 6e5, () => dcaTraining({ cacheOnly: true }).catch(() => null)), cached('jevReview', 6e4, () => lastReview())]);
    const openAll = flatOpen(open);
    const now = new Date();

    // ---- open bot trades ----
    const trades = [];
    for (const p of positions) {
      const crypto = p.asset_class === 'crypto';
      const entry = lastBuyOf(orders, p.symbol);                                 // the swing bot's trade only if its entry was the latest buy
      if (!entry || !(crypto ? /^tbcry/ : /^tbbot/).test(entry.client_order_id || '')) continue;
      const meta = crypto ? parseCry(entry.client_order_id) : parseStock(entry.client_order_id); if (!meta) continue;
      const sells = openAll.filter(o => o.side === 'sell' && flat(o.symbol) === flat(p.symbol));
      const stopO = sells.find(o => o.type === 'stop' || o.type === 'stop_limit'), tgtO = sells.find(o => o.type === 'limit');
      const ex = crypto ? { stop: meta.stop, target: meta.target } : exitsOf(entry), stop0 = crypto ? meta.stop : origStop(entry) ?? ex.stop;
      const stop = stopO ? +stopO.stop_price : Math.max(ex.stop || 0, stop0 || 0) || null, target = tgtO ? +tgtO.limit_price : ex.target;
      const avg = +p.avg_entry_price, px = +p.current_price;
      const held = crypto ? (now - new Date(entry.filled_at)) / 864e5 : weekdaysBetween(entry.filled_at, now);
      const exitBy = crypto ? new Date(new Date(entry.filled_at).getTime() + meta.hold * 864e5).toISOString() : addWeekdays(nyDate(entry.filled_at), meta.hold);
      trades.push({
        s: crypto ? entry.symbol : p.symbol, kind: crypto ? 'crypto' : 'stock', coid: entry.client_order_id, qty: +p.qty, avg, px, mv: +p.market_value,
        pl: +p.unrealized_pl, plpc: round(+p.unrealized_plpc * 100, 2), day: round(+p.unrealized_intraday_plpc * 100, 2),
        when: crypto ? null : meta.when || null, entryAt: entry.filled_at, sentAt: entry.submitted_at, setup: crypto ? (SETUPS[meta.setup] || meta.setup) + (meta.probation ? ' · probation' : '') : meta.setup, score: meta.score, filler: !!meta.filler, probation: !!meta.probation,
        hold: meta.hold, holdUnit: crypto ? 'calendar days' : 'trading days', held: round(held, crypto ? 1 : 0), exitBy,
        stop, target, stopLive: !!stopO, targetLive: !!tgtO, gtc: sells.length ? sells.every(o => o.time_in_force === 'gtc') : null,
        r: stop0 && avg !== stop0 ? round((px - avg) / (avg - stop0), 2) : null,             // R against the ORIGINAL risk
        progress: stop && target && target !== stop ? round((px - stop) / (target - stop), 3) : null,
        riskUsd: stop ? round(Math.max(0, avg - stop) * +p.qty) : null, rewardUsd: target ? round((target - avg) * +p.qty) : null,
        breakeven: !!(stop && stop >= avg), lockedUsd: stop && stop > avg ? round((stop - avg) * +p.qty) : 0,
        ai: rev?.items?.[entry.client_order_id] ? { ...rev.items[entry.client_order_id], at: rev.at } : null,
      });
    }

    // ---- why it took each trade: re-run the rules on the daily bars it saw that morning ----
    const stockSyms = trades.filter(t => t.kind === 'stock').map(t => t.s), cryptoSyms = trades.filter(t => t.kind === 'crypto').map(t => t.s);
    const [dS, dC] = await Promise.all([
      stockSyms.length ? cached('dS:' + stockSyms.sort().join(','), 36e5, () => bars([...new Set([...stockSyms, 'SPY'])], { timeframe: '1Day', days: 460 })) : {},
      cryptoSyms.length ? cached('dC:' + cryptoSyms.sort().join(','), 36e5, () => bars([...new Set([...cryptoSyms, 'BTC/USD'])], { timeframe: '1Day', days: 460 })) : {},
    ]);
    for (const t of trades) {
      const d = t.kind === 'stock' ? dS : dC, bench = t.kind === 'stock' ? 'SPY' : 'BTC/USD';
      const cutDay = t.kind === 'stock' ? nyDate(t.entryAt) : utcDate(t.entryAt);
      const dayOf = t.kind === 'stock' ? (x) => nyDate(x.t) : (x) => utcDate(x.t);
      const cut = (d[t.s] || []).filter(x => dayOf(x) < cutDay), bc = (d[bench] || []).filter(x => dayOf(x) < cutDay);
      const br = bc.length > 64 ? bc.at(-1).c / bc.at(-64).c - 1 : 0;
      const r = cut.length ? swingEval(t.s, cut, t.s === bench ? 0 : br) : null;
      t.why = r?.why?.length ? r.why : [`${t.setup} setup on the daily chart`];
      t.facts = r ? { close: r.px, rsi: r.rsi, volR: r.volR, rs63: r.rs63, atr: r.atr, atrPct: r.atrPct, s20: r.s20, s50: r.s50, s200: r.s200, trendUp: r.s50 > r.s200 && r.px > r.s50, bench: t.kind === 'stock' ? 'the S&P 500' : 'Bitcoin' } : null;
      t.story = [
        t.probation ? `Probation trade at 0.1% risk: crypto history has not proven a profitable setting yet, so the bot takes one small trade a day to collect live results (score ${t.score}).` : t.filler ? `Taken as a lower-score "filler" trade at half size to reach the daily minimum of that time (score ${t.score}; no minimum since v0.13.3).` : `Score ${t.score ?? '—'} cleared the trained bar.`,
        t.when ? (t.when === 'morning' ? 'Bought by the 9:45 AM morning run, from the finished daily candle (the way training tests it).' : "Bought by an intraday scan, from today's candle so far (graded separately from morning entries).") : null,
        r ? `Before entry: closed ${r.px}, RSI ${r.rsi}, volume ${r.volR}× its 20-day average, ${r.rs63 >= 0 ? '+' : ''}${r.rs63}% vs ${t.facts.bench} over 3 months.` : null,
        t.breakeven ? `Stop moved up to breakeven (${t.stop}) after price got half way to the target: this trade can no longer turn into a real loss (a gap through the stop is the exception).` : null,
        t.stop && t.target && !t.breakeven ? `Plan: stop ${t.stop}, target ${t.target} (${round((t.target - t.avg) / Math.max(1e-9, t.avg - t.stop), 2)}R), max ${t.hold} ${t.holdUnit}. The stop moves up to entry once price gets half way to the target.` : null,
        newsTagText(parseNewsTag(t.coid)),
      ].filter(Boolean);
    }

    // ---- DCA bot: open deals (rebuilt from positions + order ids, same as the bot does) ----
    const dv = dcaDeals({ positions, openAll, recent: orders });
    const [bull, actCrypto] = await Promise.all([bullState().catch(e => ({ on: false, use: false, share: 0, tb: 0, why: 'bull-run check failed: ' + e.message })), tradableSyms('crypto').catch(() => DCA.crypto.syms)]);
    const act = { crypto: actCrypto, etf: DCA.etf.syms }, dealBudget = (m) => budgetOf(m) * (m === 'crypto' && bull.on ? 1 - bull.share : 1);
    const dca = dv.deals.map(d => {
      const S = d.market === 'crypto' && bull.tb > d.P.S.tr ? { ...d.P.S, tr: bull.tb } : d.P.S,   // bull-run mode widens the trailing take profit
        next = d.lv.find(L => L.j > d.k && !L.filled), tpLive = d.tpOrder ? +d.tpOrder.limit_price : null,
        fee = DCA[d.market].fee, minPx = minExitPx(d.qty, d.qty * d.avg * (1 + fee), fee), tpCalc = Math.max(d.avg * (1 + d.P.S.tp / 100), minPx); // same rule as the bot (v0.13.1)
      return { key: `dca:${d.deal}:${d.f}`, s: d.sym, market: d.market, meme: isMeme(d.sym), kind: d.market === 'crypto' ? 'crypto' : 'stock', deal: d.deal, S, start: d.P.b, dips: d.k, n: S.n, qty: d.qty, avg: d.avg, px: d.px,
        pl: round(d.pl), plpc: round(+d.pos.unrealized_plpc * 100, 2), invested: round(d.invested), reserved: round(d.reserved), tp: tpLive ?? rp(tpCalc), tpLive: !!tpLive, minPx: rp(minPx),
        tpAway: round(((tpLive ?? tpCalc) / d.px - 1) * 100, 2), next: next ? { j: next.j, px: rp(next.px), usd: round(next.usd), live: !!next.order } : null,
        levels: d.lv.map(L => ({ j: L.j, px: rp(L.px), usd: round(L.usd), dev: L.dev, filled: L.filled, live: !!L.order })), exitPx: d.exitPx ? rp(d.exitPx) : null, entryAt: d.started || now.toISOString(),
        filter: FILTERS[S.f], sessionOnly: d.market === 'etf', lastFill: d.lastFill, tsLive: d.tsOrder ? +d.tsOrder.stop_price : null };
    });
    const dcaSum = { training: trainingSummary(dcaT), budget: DCA.budget, split: DCA.split, deals: dca, bull: { use: bull.use, on: bull.on, share: bull.share, tb: bull.tb, why: bull.why },
      markets: Object.fromEntries(['crypto', 'etf'].map(m => { const l = dca.filter(d => d.market === m); return [m, { budget: budgetOf(m), maxDeals: DCA[m].maxDeals, perDeal: round(dealBudget(m) / DCA[m].maxDeals), firstPct: DCA.firstPct, minNetPct: DCA.minNetPct, syms: act[m].filter(s => !isMeme(s)).map(s => s.replace('/USD', '')), meme: act[m].filter(isMeme).map(s => s.replace('/USD', '')), memeMax: DCA[m].memeMax || 0, memeOpen: l.filter(d => d.meme).length, resting: DCA[m].active, open: l.length, reserved: round(l.reduce((a, d) => a + d.reserved, 0)), invested: round(l.reduce((a, d) => a + d.invested, 0)), pl: round(l.reduce((a, d) => a + d.pl, 0)) }]; })) };

    // ---- price since entry for the live chart ----
    const groups = {};
    for (const t of [...trades, ...dca]) {
      const ageH = (now - new Date(t.entryAt)) / 36e5;
      const tf = t.kind === 'crypto' ? (ageH < 36 ? '15Min' : '1Hour') : (ageH < 30 ? '5Min' : ageH < 24 * 8 ? '15Min' : '1Hour');
      const start = new Date(new Date(t.entryAt).getTime() - (t.kind === 'crypto' ? 12 : 30) * 36e5).toISOString();
      (groups[t.kind + tf] ||= { tf, kind: t.kind, start, syms: [] }).syms.push(t.s);
      if (start < groups[t.kind + tf].start) groups[t.kind + tf].start = start;
      t.tf = tf;
    }
    const intr = {};
    await Promise.all(Object.values(groups).map(async g => {
      const key = `i:${g.tf}:${g.syms.sort().join(',')}:${g.start.slice(0, 13)}`;
      const b = await cached(key, g.tf === '5Min' ? 45e3 : 12e4, () => bars(g.syms, { timeframe: g.tf, start: g.start }).catch(() => ({})));
      Object.assign(intr, b);
    }));
    for (const t of [...trades, ...dca]) {
      let b = t.tf ? intr[t.s] || [] : [];
      if (t.kind === 'stock') b = b.filter(x => { const m = nyMin(x.t); return m >= 570 && m < 960; });   // regular session only
      t.bars = b.slice(-400).map(x => ({ t: x.t, o: x.o, h: x.h, l: x.l, c: x.c }));
    }

    // ---- trailing take profit state (best price since the last buy, from the chart bars) ----
    for (const d of dca) {
      if (!(d.S.tr > 0)) continue;
      const t0 = d.lastFill ? Date.parse(d.lastFill) : 0, peak = Math.max(d.px, ...d.bars.filter(x => Date.parse(x.t) >= t0).map(x => x.h));
      const T = trailPlan(d.avg, d.S, peak, d.px, d.minPx);
      d.trail = { tr: d.S.tr, act: rp(T.act), minF: rp(T.minF), peak: rp(T.peak), on: T.on, floor: T.floor ? rp(T.floor) : null, live: d.tsLive };
    }

    // ---- event feed ----
    const entriesBySym = {};
    for (const o of [...orders].reverse()) { const k = kindOf(o.client_order_id); if ((k === 'entry' || k === 'centry') && o.filled_at) (entriesBySym[flat(o.symbol)] ||= []).push({ t: o.filled_at, px: +o.filled_avg_price }); }
    const entryBefore = (sym, t) => { const l = entriesBySym[flat(sym)] || []; let e = null; for (const x of l) if (x.t <= t) e = x; return e; };
    const ev = [];
    const exitEv = (o, type, text) => { const e = entryBefore(o.symbol, o.filled_at); const q = +o.filled_qty, px = +o.filled_avg_price; ev.push({ t: o.filled_at, type, s: o.symbol, qty: q, px, pnl: e ? round((px - e.px) * q) : null, text, bot: String(o.symbol).includes('/') ? 'Crypto swing' : 'Stock swing', entry: e?.px ?? null }); };
    for (const o of orders) {
      const k = kindOf(o.client_order_id); if (!k) continue;
      if (k === 'entry' || k === 'centry') {
        const m = k === 'entry' ? parseStock(o.client_order_id) : parseCry(o.client_order_id);
        const setup = m ? (SETUPS[m.setup] || m.setup) : '';
        ev.push({ t: o.submitted_at, type: 'sent', s: o.symbol, qty: +o.qty, text: `Bot sent BUY ${+o.qty} ${o.symbol} · ${setup}${m?.score ? ' · score ' + m.score : ''}${m?.filler ? ' · filler' : ''}` });
        if (o.filled_at) ev.push({ t: o.filled_at, type: 'fill', s: o.symbol, qty: +o.filled_qty, px: +o.filled_avg_price, bot: k === 'entry' ? 'Stock swing' : 'Crypto swing', setup, text: `Filled ${+o.filled_qty} ${o.symbol} @ ${+o.filled_avg_price}` });
        else if (['canceled', 'rejected', 'expired'].includes(o.status)) ev.push({ t: o.updated_at || o.submitted_at, type: 'cancel', s: o.symbol, text: `Entry ${o.status}: ${o.symbol}` });
        if (k === 'entry') for (const l of o.legs || []) if (l.status === 'filled') exitEv(l, l.type === 'limit' ? 'target' : 'stop', l.type === 'limit' ? `Target hit: sold ${+l.filled_qty} ${o.symbol} @ ${+l.filled_avg_price}` : `Stop hit: sold ${+l.filled_qty} ${o.symbol} @ ${+l.filled_avg_price}`);
      } else if (k === 'prot' || k === 'cstop' || k === 'be') {
        const beMove = k === 'be' || /-be$/.test(o.client_order_id || '');
        ev.push({ t: o.submitted_at, type: 'rearm', s: o.symbol, text: beMove ? `Stop moved up to breakeven on ${o.symbol} at ${+o.stop_price}` : k === 'cstop' ? `Standing stop placed on ${o.symbol} at ${+o.stop_price}` : `Stop/target re-armed good-till-canceled on ${o.symbol}` });
        for (const x of [o, ...(o.legs || [])]) if (x.status === 'filled') exitEv({ ...x, symbol: o.symbol }, x.type === 'limit' ? 'target' : 'stop', `${x.type === 'limit' ? 'Target' : beMove ? 'Breakeven stop' : 'Stop'} hit: sold ${+x.filled_qty} ${o.symbol} @ ${+x.filled_avg_price}`);
      } else if ((k === 'exit' || k === 'cexit') && o.filled_at) {
        const tgt = /-tgt/.test(o.client_order_id), stp = /-stop/.test(o.client_order_id), be = /-be(-|$)/.test(o.client_order_id);
        exitEv(o, tgt ? 'target' : stp || be ? 'stop' : 'time', `${tgt ? 'Target reached' : be ? 'Breakeven exit' : stp ? 'Stop level broken' : 'Time exit'}: sold ${+o.filled_qty} ${o.symbol} @ ${+o.filled_avg_price}`);
      }
    }
    const dealCost = {};                                                          // DCA: running cost per deal, oldest first
    for (const o of [...orders].reverse()) {
      const m = parseDca(o.client_order_id); if (!m || !(+o.filled_qty > 0) || !o.filled_at) continue;
      const q = +o.filled_qty, px = +o.filled_avg_price, c = (dealCost[m.deal + m.f] ||= { q: 0, usd: 0 });
      if (o.side === 'buy') { c.q += q; c.usd += q * px; ev.push({ t: o.filled_at, type: 'fill', s: o.symbol, qty: q, px, bot: 'DCA', dca: m.kind, text: m.kind === 'b' ? `DCA deal started: bought $${(q * px).toFixed(2)} ${o.symbol} @ ${px}` : `DCA dip buy #${m.kind.slice(1)} filled: ${q} ${o.symbol} @ ${px}` }); continue; }
      const avg = c.q ? c.usd / c.q : null, pnl = avg ? round((px - avg) * q) : null; c.q -= q; c.usd -= avg ? avg * q : 0;
      ev.push({ t: o.filled_at, type: m.kind === 'hx' ? 'stop' : 'target', s: o.symbol, qty: q, px, pnl, bot: 'DCA', entry: avg ? rp(avg) : null, text: `${m.kind === 'hx' ? 'DCA hard exit' : m.kind === 'ts' ? 'DCA trailing take profit' : 'DCA take profit'}: sold ${q} ${o.symbol} @ ${px}` });
    }
    const core = {};                                                              // bull-run core (v0.11.0, tbhodl-...): holds BTC/ETH during BTC uptrends
    for (const o of [...orders].reverse()) {
      if (!String(o.client_order_id || '').startsWith('tbhodl-') || !(+o.filled_qty > 0) || !o.filled_at) continue;
      const q = +o.filled_qty, px = +o.filled_avg_price, c = (core[o.symbol] ||= { q: 0, usd: 0 });
      if (o.side === 'buy') { c.q += q; c.usd += q * px; ev.push({ t: o.filled_at, type: 'fill', s: o.symbol, qty: q, px, bot: 'Bull-run core', text: `Bull-run core bought $${(q * px).toFixed(2)} ${o.symbol} @ ${px} (BTC in an uptrend)` }); continue; }
      const avg = c.q ? c.usd / c.q : null, pnl = avg ? round((px - avg) * q) : null; c.q -= q; c.usd -= avg ? avg * q : 0;
      ev.push({ t: o.filled_at, type: 'target', s: o.symbol, qty: q, px, pnl, bot: 'Bull-run core', entry: avg ? rp(avg) : null, text: `Bull-run core sold ${q} ${o.symbol} @ ${px} (BTC left its uptrend)` });
    }
    ev.sort((a, z) => String(z.t).localeCompare(String(a.t)));

    const tag = nyDate(now).replace(/-/g, ''), todayNY = nyDate(now);
    const placed = (pre) => orders.filter(o => (o.client_order_id || '').startsWith(`${pre}-${tag}-`) && !['canceled', 'rejected', 'expired'].includes(o.status)).length;
    const closedToday = ev.filter(e => ['stop', 'target', 'time'].includes(e.type) && nyDate(e.t) === todayNY);
    const bought = ev.filter(e => e.type === 'fill' && nyDate(e.t) === todayNY);
    const pick = (e) => ({ t: e.t, s: e.s, bot: e.bot || '', type: e.type, text: e.text, qty: e.qty ?? null, px: e.px ?? null, entry: e.entry ?? null, pnl: e.pnl ?? null });
    const lists = { closed: closedToday.map(pick), stocks: bought.filter(e => !String(e.s).includes('/')).map(pick), crypto: bought.filter(e => String(e.s).includes('/')).map(pick) };
    return json({
      at: now.toISOString(), market: { open: clock.is_open, next_open: clock.next_open, next_close: clock.next_close }, equity: +acct.equity,
      today: { stocks: placed('tbbot'), crypto: placed('tbcry'), cryptoBuys: lists.crypto.length, dca: orders.filter(o => parseDca(o.client_order_id)?.kind === 'b' && +o.filled_qty > 0 && nyDate(o.filled_at) === todayNY).length, goal: RULES.minTrades, cap: RULES.maxNewPerDay, season: { n: SEASON.n, label: SEASON.label, since: SEASON.since, start: SEASON.start }, closed: closedToday.length, closedPnl: round(closedToday.reduce((a, e) => a + (e.pnl || 0), 0)), lists },
      cryptoSwing: cryptoSwingOn(), dcaOpenPnl: round(dca.reduce((a, d) => a + (d.pl || 0), 0)),
      openPnl: round(trades.reduce((a, t) => a + t.pl, 0)), trades, dca: dcaSum, events: ev.slice(0, 80),
    }, { priv: true });
  } catch (e) { return fail(e, 'botview'); }
}
