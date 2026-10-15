// Makes tests/fx-dcalab.json (the /api/dcalab answer the DCA-tab UI test uses) from a lab run on the mock prices, plus the
// $100 plan's virtual accounts after a day of mock hourly prices (v0.12.0).
import { blob, M } from './mock.mjs';
const T = new URL('../', import.meta.url).href;
M.assets = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD', 'AVAX/USD', 'LTC/USD', 'ARB/USD', 'DOGE/USD', 'PEPE/USD'];
const D = await import(T + 'lib/dca.js'), L = await import(T + 'lib/dcalab.js'), Sm = await import(T + 'lib/small.js'), fs = await import('fs');
const lab = await L.runLab({ save: false });
const H = 36e5, t0 = Math.floor(Date.now() / H) * H - 30 * H; await Sm.runSmall({ now: t0 }); const small = await Sm.runSmall({ now: t0 + 30 * H });
const j = { lab: { ...lab, pick: { ...lab.pick, use: true, active: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'LINK/USD', 'AVAX/USD', 'DOGE/USD'], blocked: [{ s: 'LTC/USD', why: 'lost $41.2 over 57 deals' }, { s: 'ARB/USD', why: 'lost $12 over 40 deals' }, { s: 'PEPE/USD', why: 'only 3 deals in the test (needs 8)' }] } },
  bull: { use: true, on: true, share: 0.3, tb: 5, why: 'BTC is in an uptrend (close 112000 over its 200-day 98000, 50-day over 200-day)' },
  signals: { mode: 'shadow', funding: { coins: [{ s: 'BTC/USD', apr: 11 }, { s: 'ETH/USD', apr: 17.5 }, { s: 'SOL/USD', apr: 35 }, { s: 'DOGE/USD', apr: 87.6 }, { s: 'XRP/USD', apr: -4 }] }, liquidity: { state: 'easing', text: 'money conditions easing (broad dollar index, 3 months -3.78, M2 growth rate, 3 months +0.31, 10-year real yield, 3 months -0.38)' } }, ran: false, at: new Date().toISOString() };
j.small = small;
fs.writeFileSync(new URL('./fx-dcalab.json', import.meta.url), JSON.stringify(j));
console.log('fx-dcalab.json', JSON.stringify(j).length, 'bytes,', lab.coins.length, 'coins');
