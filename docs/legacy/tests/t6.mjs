import { blob, posted, deleted, jevCalls, M, ops, orders, open } from './mock.mjs';
const T = new URL('../', import.meta.url).href;
const { hourly } = await import('./mockdata.mjs'); { const H = hourly('SOL/USD', 0), f = 147 / H.at(-1).c; for (const b of H) { b.o *= f; b.h *= f; b.l *= f; b.c *= f; } }   // SOL bars on the same scale as the position
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const N = await import(T + 'lib/notify.js'), C = await import(T + 'lib/control.js'), D = await import(T + 'lib/dca.js');
const { tokenFor } = await import(T + 'lib/core.js'); const k = tokenFor('pw');
// ---- 1 migration from the old file-name state (paused must survive) ----
blob['control/mode-pause-you-1700000000000.json'] = JSON.stringify({ reason: 'old pause' }); blob['control/last-1700000000000.json'] = '{}'; blob['control/lock-1700000000000.txt'] = '1';
blob['push/sub-abc.json'] = JSON.stringify({ endpoint: 'https://push.example/x', keys: { p256dh: 'a', auth: 'b' } });
let m = await C.getMode(); ok(m.mode === 'pause' && m.reason === 'old pause', 'old paused state migrated to control/mode.json');
ok(!Object.keys(blob).some(x => /^control\/(mode|last|lock)-/.test(x)), 'old control files removed after migration');
const subs = await N.listSubs(); ok(subs.length === 1 && 'push/subs.json' in blob && !('push/sub-abc.json' in blob), 'push devices migrated into one index file');
await C.setMode('run', 'you', 'test');
// ---- 2 lock: create-only, stale lock replaced ----
const a = await C.acquireLock(); ok(a?.url && (await C.acquireLock()) === null, 'lock: second run stands down');
await C.releaseLock(a);
blob['control/lock.json'] = JSON.stringify({ at: Date.now() - 400e3 }); const b = await C.acquireLock(); ok(b?.url && JSON.parse(blob['control/lock.json']).at > Date.now() - 5e3, 'lock: abandoned lock (400 s old, past the 320 s limit) replaced'); await C.releaseLock(b);
// ---- 3 trailPlan rules ----
const S = { tp: 2, tr: 1 };
let t = D.trailPlan(100, S, 101, 101); ok(!t.on && t.want === null && Math.abs(t.act - 102) < 1e-9, 'trail waits under +tp%');
t = D.trailPlan(100, S, 110, 109.5); ok(t.on && t.want.type === 'stop' && Math.abs(t.floor - 108.9) < 1e-9, 'trail active: stop 1% under the best price (108.9)');
t = D.trailPlan(100, S, 110, 108); ok(t.want.type === 'market', 'fell under the floor but still >= +tp/2: sell at market');
t = D.trailPlan(100, S, 103, 100.5); ok(t.want.type === 'limit' && Math.abs(t.px - 101) < 1e-9 || (t.want.type === 'limit' && Math.abs(t.want.px - 101) < 1e-9), 'fell back under +tp/2: rest a limit at +1%');
t = D.trailPlan(100, S, 102.5, 102.4); ok(t.want.type === 'stop' && Math.abs(t.floor - 101.475) < 1e-9, 'floor never under +tp/2 (101) and never above price');
// ---- 4 check run (cron): crypto only, SOL deal switched to trailing ----
for (const o of [...orders, ...open]) if (o.client_order_id?.includes('SOLUSD')) o.client_order_id = o.client_order_id.replace('-fd-', '-fd-r1-');
const chk = await import(T + 'routes/bot-check.js');
posted.length = 0; deleted.length = 0; jevCalls.length = 0; ops.adv = ops.simple = ops.list = 0; delete blob['control/last.json'];
let r = await chk.GET(new Request('http://x/api/bot-check', { headers: { authorization: 'Bearer cs' } })); let j = await r.json();
ok(j.ok && j.slot === 'chk' && !j.stocksRan, 'hourly check: crypto only (no stocks)');
ok(j.crypto && !j.crypto.placed.length && /off/.test(j.crypto.note || '') && j.crypto.training === null, 'crypto swing entries off: no swing buys, no swing training: ' + (j.crypto.note || '').slice(0, 60));
ok(!j.dca.skipped.some(x => !String(x.s).includes('/')) && !j.dca.notes.some(n => /ETF/.test(n)), 'check run leaves ETF deals to the main runs');
const solA = j.dca.actions.find(x => x.s === 'SOL/USD' && /trailing|bounce|waits/.test(x.why))?.why || '';
ok(deleted.includes('o-tp') && /bounce|waits/.test(solA) && posted.some(p => /-tp-/.test(p.client_order_id || '') && p.type === 'limit' && Math.abs(+p.limit_price - 148.53 * 1.0025 * 1.005 / 0.9975) < 0.02), 'trailing SOL deal: old fixed TP replaced by the rule (peak passed +1.5%, price back under the floor -> limit at the higher of +0.75% and the 0.5%-net-after-costs price, v0.13.1): ' + solA);
ok(!('control/last.json' in blob) && !('control/lock.json' in blob), 'check run: no last-run save, lock released');
console.log('   storage ops for this check run:', JSON.stringify(ops));
ok(ops.list === 0 && ops.adv <= 6, 'check run uses no list calls and at most 6 puts (lock, training, $100 ledger + on the very first training: 2 price-history files and their status)');
// ---- 5 SOL above +tp%: stop-limit trailing sell placed ----
M.posOver.SOLUSD = { current_price: '160', unrealized_pl: '18', unrealized_plpc: '0.077' };
open.splice(open.findIndex(o => o.id === 'o-tp'), 1);
posted.length = 0; deleted.length = 0;
r = await chk.GET(new Request('http://x/api/bot-check', { headers: { authorization: 'Bearer cs' } })); j = await r.json();
const ts = posted.find(p => /-ts-/.test(p.client_order_id || ''));
ok(ts && ts.type === 'stop_limit' && +ts.stop_price >= 148.53 * 1.0075 && +ts.stop_price < 160 && /-r1-/.test(ts.client_order_id), 'trailing stop-limit placed under the price: ' + (ts ? `stop ${ts.stop_price} limit ${ts.limit_price} ${ts.client_order_id}` : 'none'));
// the same run again with that stop resting at the same level: no churn
open.push({ id: 'o-ts', symbol: 'SOL/USD', side: 'sell', type: 'stop_limit', qty: '1.5706', stop_price: ts?.stop_price, limit_price: ts?.limit_price, status: 'new', client_order_id: ts?.client_order_id, submitted_at: new Date().toISOString() });
posted.length = 0; deleted.length = 0;
r = await chk.GET(new Request('http://x/api/bot-check', { headers: { authorization: 'Bearer cs' } })); j = await r.json();
ok(!posted.some(p => /SOL/.test(p.symbol) && /-t[sp]-/.test(p.client_order_id || '')) && !deleted.includes('o-ts'), 'floor unchanged: resting trailing stop left alone');
// ---- 6 manual crypto check from the app ----
r = await (await import(T + 'routes/bot.js')).GET(new Request(`http://x/api/bot?k=${k}&run=1&check=1`)); j = await r.json();
ok(j.slot === 'chk' && !j.stocksRan, 'Run crypto check now = the hourly check');
// ---- 7 bot view: tile lists + trailing state ----
const bv = await import(T + 'routes/botview.js'); j = await (await bv.GET(new Request(`http://x/api/botview?k=${k}`))).json();
const sol = j.dca.deals.find(d => d.s === 'SOL/USD');
ok(j.today.lists && Array.isArray(j.today.lists.closed) && Array.isArray(j.today.lists.crypto), 'bot view returns today lists: closed ' + j.today.lists.closed.length + ', crypto ' + j.today.lists.crypto.length + ', stocks ' + j.today.lists.stocks.length);
ok(sol?.trail?.on && sol.trail.live && sol.trail.floor > sol.avg, 'bot view shows SOL trailing: floor ' + sol?.trail?.floor + ' live ' + sol?.trail?.live);
ok(j.cryptoSwing === false && typeof j.dcaOpenPnl === 'number', 'bot view: crypto swing off flag + DCA open P&L');
// ---- 8 page views read without list calls ----
ops.adv = ops.simple = ops.list = 0;
const ctl = await import(T + 'routes/control.js'); for (let i = 0; i < 5; i++) await ctl.GET(new Request(`http://x/api/control?k=${k}`));
for (let i = 0; i < 5; i++) await bv.GET(new Request(`http://x/api/botview?k=${k}`));
console.log('   storage ops for 5 Safety-panel + 5 Bot-tab refreshes:', JSON.stringify(ops));
ok(ops.adv === 0, 'page refreshes use no put/list operations');
// ---- 9 training with trailing ----
const t0 = Date.now(), tr = await D.trainMarket('crypto');
ok(tr.tested === D.combos(D.GRIDS.crypto).length && tr.chosen.S.n === 3 && 'tr' in tr.chosen.S, `crypto training: ${tr.tested} settings in ${((Date.now() - t0) / 1000).toFixed(1)} s, picked ${tr.chosen.text}`);
const trTop = tr.top.filter(x => x.S.tr > 0).length; console.log('   trailing settings in the top 12:', trTop, '| ETF grid', (await D.trainMarket('etf')).tested);
