// v0.10.0 DCA: 10 crypto deals, 2 meme slots
import { blob, posted, M, orders, open, positions } from './mock.mjs';
const T = new URL('../', import.meta.url).href;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
M.assets = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD', 'AVAX/USD', 'LTC/USD', 'BCH/USD', 'ADA/USD', 'DOT/USD', 'AAVE/USD', 'UNI/USD', 'DOGE/USD', 'SHIB/USD', 'PEPE/USD', 'WIF/USD'];   // no BONK, TRUMP
const D = await import(T + 'lib/dca.js');
let c = D.capsOf('crypto', D.DCA.crypto.syms); ok(c.max === 10 && c.meme === 2 && c.reg === 8, 'caps: 10 deals = 8 regular + 2 meme ' + JSON.stringify(c));
c = D.capsOf('crypto', D.DCA.crypto.syms, false); ok(c.max === 5 && c.meme === 1 && c.reg === 4, 'unproven: half = 4 regular + 1 meme ' + JSON.stringify(c));
c = D.capsOf('crypto', ['BTC/USD', 'ETH/USD']); ok(c.meme === 0 && c.reg === 10, 'no meme coin tradable: all 10 slots regular');
c = D.capsOf('etf', D.DCA.etf.syms); ok(c.max === 3 && c.meme === 0 && c.reg === 3, 'ETFs unchanged: 3 deals');
const av = await D.tradableSyms('crypto'); ok(av.length === 16 && !av.includes('BONK/USD') && !av.includes('TRUMP/USD'), 'coins Alpaca does not list are dropped: ' + av.length + ' tradable');
ok(D.isMeme('PEPE/USD') && D.isMeme('PEPEUSD') && !D.isMeme('BTC/USD'), 'isMeme works for BTC/USD and BTCUSD styles');
// simulator never exceeds the caps
const P = await D._sim.prep('crypto'); ok(P.syms.length === 16 && P.caps.meme === 2 && P.caps.reg === 8, 'training uses the 16 tradable coins with the 2-meme cap');
const r = D._sim.simulate(P, { n: 4, d: 1.5, k: 1, v: 1.3, tp: 1, x: 5, f: 'a', tr: 0 });
const ev = []; for (const d of r.deals) { ev.push([d.in, 1, D.isMeme(d.s)], [d.out, -1, D.isMeme(d.s)]); } ev.sort((a, z) => a[0] - z[0] || a[1] - z[1]);
let all = 0, mem = 0, maxAll = 0, maxMem = 0; for (const [, dlt, m] of ev) { all += dlt; if (m) mem += dlt; maxAll = Math.max(maxAll, all); maxMem = Math.max(maxMem, mem); }
ok(maxAll <= 10 && maxMem <= 2 && r.deals.some(d => D.isMeme(d.s)), `simulation: at most ${maxAll} deals open, at most ${maxMem} meme deals; ${r.deals.length} deals, ${r.deals.filter(d => D.isMeme(d.s)).length} in meme coins`);
const t0 = Date.now(), tr = await D.trainMarket('crypto'); const secs = (Date.now() - t0) / 1000;
ok(tr.tested === D.combos(D.GRIDS.crypto).length && tr.meme.length === 4 && tr.caps.meme === 2, `crypto training with 16 coins: ${tr.tested} settings in ${secs.toFixed(1)} s (local), picked ${tr.chosen.text}`);
// live dry run: new deals respect the group slots (SOL + XRP deals from the mock count as regular)
blob['dca/train-v6.json'] = JSON.stringify({ at: new Date().toISOString(), budget: D.DCA.budget, split: D.DCA.split, crypto: { ...tr, chosen: { ...tr.chosen, S: { n: 4, d: 1.5, k: 1, v: 1.3, tp: 1, x: 5, f: 'a', tr: 0 } }, proven: true }, etf: { error: 'skip' } });
const out = await D.runDca({ dry: true, positions: positions(), openAll: open, recent: orders, clock: { is_open: false }, taken: new Set(), allowNew: true, judge: null, markets: ['crypto'] });
const st = out.started.filter(x => x.preview), mm = st.filter(x => x.meme);
const openDeals = out.deals.filter(d => d.market === 'crypto').length;
ok(st.length + openDeals <= 10 && mm.length <= 2 && mm.length >= 1, `dry run: ${openDeals} open + ${st.length} new (${mm.length} meme: ${mm.map(x => x.s).join(', ')})`);
ok(st.every(x => x.usd > 0 && Math.abs(x.usd - 1400 * 0.15) < 0.01), 'each new deal sized from $1,400 ($14k / 10): first buy $210 = 15% (v0.13.1)');
const pepe = st.find(x => x.s === 'PEPE/USD') || st.find(x => x.meme); ok(!pepe || pepe.px > 0, 'meme price kept with full precision: ' + (pepe ? pepe.s + ' ' + pepe.px : 'n/a'));
// order text for sub-cent prices: a real (non-dry) start on PEPE uses the asset's tiny price increment
posted.length = 0;
blob['dca/train-v6.json'] = blob['dca/train-v6.json'];
const out2 = await D.runDca({ dry: false, positions: positions(), openAll: open, recent: orders, clock: { is_open: false }, taken: new Set(), allowNew: true, judge: null, markets: ['crypto'] });
const pp = posted.filter(p => /PEPE|SHIB/.test(p.symbol) && p.side === 'buy');   // (the mock fills every order at $1, so its take-profit price is meaningless)
console.log(pp.map(p=>p.symbol+' '+p.type+' '+(p.limit_price||'')+' '+p.qty).join(' | ')); ok(pp.every(p => !p.limit_price || (+p.limit_price > 0 && +p.limit_price < 0.001)), 'meme dip-buy limit prices keep their decimals: ' + pp.filter(p => p.limit_price).slice(0, 2).map(p => p.symbol + ' ' + p.limit_price).join(', '));
ok(posted.every(p => (p.client_order_id || '').length <= 128), 'all order ids fit Alpaca\'s 128-character limit');
const S = D.statsOf([]); ok(S.n === 0, 'statsOf empty ok');
const L = D.dcaLive([{ client_order_id: 'tbdca-2609010000-PEPEUSD-b-u10.00-b0.00001-n4-d1.5-k1-v1.3-t1-x5-fa-zq1', side: 'buy', symbol: 'PEPE/USD', filled_qty: '1000000', filled_avg_price: '0.00001', filled_at: '2026-09-01T00:00:00Z' },
  { client_order_id: 'tbdca-2609010000-PEPEUSD-tp-u10.00-b0.00001-n4-d1.5-k1-v1.3-t1-x5-fa-zq2', side: 'sell', symbol: 'PEPE/USD', filled_qty: '1000000', filled_avg_price: '0.0000101', filled_at: '2026-09-02T00:00:00Z' }], []);
ok(L.byMarket.meme?.n === 1 && L.byMarket.crypto.n === 1, 'benchmark: meme deals counted separately (and inside crypto)');
