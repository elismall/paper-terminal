import { blob, posted, deleted, closedPos, jevCalls, M } from './mock.mjs';
const T = new URL('../', import.meta.url).href;
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const C = await import(T + 'lib/control.js');
// 1 lock
const a = await C.acquireLock(); const b2 = await C.acquireLock(); ok(a && a.url && b2 === null, 'second run stands down while a lock is held');
await C.releaseLock(a); const c = await C.acquireLock(); ok(!!c?.url, 'lock free again after release'); await C.releaseLock(c);
// 2 mode + ladder
let mode = await C.getMode(); ok(mode.mode === 'run', 'default mode is run');
let L = await C.ladder({ dry: false, clock: { is_open: false }, equity: 100000, last: 100000 }); ok(L.level === 1 && L.entries.crypto, 'ladder level 1 normally: ' + JSON.stringify(L.reasons));
await C.setMode('pause', 'you', 'test'); mode = await C.getMode(); ok(mode.mode === 'pause' && mode.reason === 'test' && 'control/mode.json' in blob, 'pause saved, only one mode file');
L = await C.ladder({ dry: false, clock: { is_open: false }, equity: 100000, last: 100000 }); ok(L.level === 4 && !L.entries.stocks && !L.entries.crypto && !L.entries.dca, 'paused -> level 4, no entries');
await C.setMode('run', 'you', 'resumed');
M.lastEquity = 103000; L = await C.ladder({ dry: false, clock: { is_open: false }, equity: 100000, last: 103000 }); ok(L.level === 3 && !L.entries.dca, 'down 2.9% today -> level 3: ' + L.reasons[0]); M.lastEquity = 100000;
M.snapAgeMin = 60; L = await C.ladder({ dry: false, clock: { is_open: true }, equity: 100000, last: 100000 }); ok(L.level === 3 && !L.entries.stocks && !L.entries.crypto, 'stale prices -> hold: ' + L.reasons.join(' | ')); M.snapAgeMin = 0;
M.hist = { equity: [110000, 109000, 100500] }; L = await C.ladder({ dry: true, clock: { is_open: false }, equity: 100000, last: 100000 }); ok(L.level === 4 && (await C.getMode()).mode === 'run', 'drawdown 9.1% -> level 4 (dry run does not persist)');
L = await C.ladder({ dry: false, clock: { is_open: false }, equity: 100000, last: 100000 }); mode = await C.getMode(); ok(mode.mode === 'pause' && mode.by === 'auto', 'drawdown auto-pauses (persisted): ' + mode.reason);
M.hist = null; await C.setMode('run', 'you', 'resumed');
// 3 full bot run while paused: management runs, no new entries
const { tokenFor } = await import(T + 'lib/core.js'); const k = tokenFor('pw');
const bot = await import(T + 'routes/bot.js');
await C.setMode('pause', 'you', 'kill switch');
posted.length = 0; deleted.length = 0;
let r = await bot.GET(new Request(`http://x/api/bot?k=${k}&run=1&only=dca`)); let j = await r.json();
ok(j.safety?.level === 4, 'run while paused reports level 4');
ok(!j.dca.started.length && j.dca.notes.some(n => /no new deals/.test(n)), 'DCA: no new deals while paused: ' + j.dca.notes.filter(n => /no new/.test(n)).join(' | '));
ok(deleted.includes('o-xrp-s1') && deleted.includes('o-xrp-s2'), 'XRP dust: leftover dip buys canceled');
ok(!j.dca.deals.some(d => d.s === 'XRP/USD'), 'XRP dust is not an open deal');
ok(j.dca.actions.some(a => a.s === 'SOL/USD'), 'SOL deal still managed while paused: ' + j.dca.actions.filter(a => a.s === 'SOL/USD').map(a => a.why).join(' | '));
ok('control/last.json' in blob, 'last run safety saved');
ok(!('control/lock.json' in blob), 'lock released after run');
// 4 resume + Jev shadow: entries allowed, AI tag recorded in ids, no size change
await C.setMode('run', 'you', 'resumed'); process.env.TYPESAFE_API_KEY = 'test-key';
posted.length = 0; deleted.length = 0; jevCalls.length = 0;
r = await bot.GET(new Request(`http://x/api/bot?k=${k}&run=1&only=dca`)); j = await r.json();
const base = posted.filter(p => /^tbdca-.*-b-/.test(p.client_order_id || ''));
ok(j.safety.level === 1, 'resumed: level 1');
ok(j.dca.jev?.mode === 'shadow' && jevCalls.length > 0, `Jev shadow asked ${jevCalls.length} time(s)`);
ok(base.length > 0 && base.every(p => /-j\d{1,2}(e\dr\dd\d)?-z/.test(p.client_order_id)), 'new DCA deals carry the AI score in the order id: ' + base.map(p => p.client_order_id).slice(0, 2).join(' , '));
ok(base.every(p => p.client_order_id.length <= 128), 'order ids under 128 chars (max ' + Math.max(...base.map(p => p.client_order_id.length)) + ')');
const lad = posted.filter(p => /^tbdca-.*-s\d-/.test(p.client_order_id || '')); ok(lad.every(p => !/-j\d/.test(p.client_order_id)), 'dip-buy orders have no AI tag (only the base order)');
console.log('state sample', JSON.stringify(jevCalls[0]?.state));
// 5 gate mode + failure: rules only, level 2
process.env.JEV_MODE = 'gate'; M.jevFail = true; posted.length = 0;
for (const kk of Object.keys(blob)) if (kk.startsWith('control/lock-')) delete blob[kk];
r = await bot.GET(new Request(`http://x/api/bot?k=${k}&run=1&only=dca`)); j = await r.json();
ok(j.dca.jev?.failed >= 0 && (j.dca.jev.failed === 0 || j.safety.level === 2), `gate + Jev down -> level ${j.safety.level}: ${j.safety.reasons.join(' | ')}`);
M.jevFail = false;
// verdict policy
const J = await import(T + 'lib/jev.js');
ok(J.verdict({ q: 0.4, conf: 0.8, down: 0.2 }, 'gate').act === 'skip', 'gate: weak + confident -> skip');
ok(J.verdict({ q: 1.2, conf: 0.7, down: 0.2 }, 'gate').size === 0.5, 'gate: doubtful -> half');
ok(J.verdict({ q: 2.5, conf: 0.7, down: 0.8 }, 'gate').act === 'skip', 'gate: high drop risk -> skip');
ok(J.verdict({ q: 0.1, conf: 0.9 }, 'shadow').size === 1, 'shadow never changes trades');
ok(J.jevOf('tbcry-20260925-LINKUSD-breakout-sc70-h5-s95-t110-j18') === 1.8 && J.jevOf('tbdca-x-j5-zq') === 0.5, 'score read back from order ids');
delete process.env.JEV_MODE;
// 6 control route + emergency stop
const ctl = await import(T + 'routes/control.js');
r = await ctl.GET(new Request(`http://x/api/control?k=${k}`)); j = await r.json(); ok(j.mode === 'run' && j.last?.level && j.jev.key === true, 'GET /api/control: ' + JSON.stringify({ mode: j.mode, level: j.last?.level, jev: j.jev.mode }));
r = await ctl.GET(new Request(`http://x/api/control`)); ok(r.status === 401, 'control locked without passcode');
deleted.length = 0; closedPos.length = 0;
r = await ctl.POST(new Request(`http://x/api/control?k=${k}`, { method: 'POST', body: JSON.stringify({ action: 'stop' }) })); j = await r.json();
ok(closedPos.includes('SOLUSD') && closedPos.includes('LINKUSD') && !closedPos.includes('XRPUSD'), 'emergency stop closed bot positions only: ' + closedPos.join(','));
ok(!deleted.includes('o-snow') && deleted.includes('o-link-stop') && deleted.includes('o-tp'), 'emergency stop canceled bot orders, left your SNOW order');
ok((await C.getMode()).mode === 'pause', 'emergency stop leaves the bots paused');
r = await ctl.POST(new Request(`http://x/api/control?k=${k}`, { method: 'POST', body: JSON.stringify({ action: 'resume' }) })); ok((await C.getMode()).mode === 'run', 'resume works');
// 7 health + performance
const h = await import(T + 'routes/health.js'); j = await (await h.GET(new Request('http://x/api/health'))).json(); const V = (await import(T + 'lib/version.js')).VERSION; ok(j.version === V && j.jev.mode === 'shadow' && j.cryptoSwing === false, `health ${V} + jev status + crypto swing off`);
const pf = await import(T + 'routes/performance.js'); j = await (await pf.GET(new Request(`http://x/api/performance?k=${k}`))).json();
ok(!j.error && j.jev && j.jev.buckets.length === 3, 'performance has Jev scorecard: ' + JSON.stringify(j.jev?.buckets?.map(b => [b.label, b.n])) + (j.error ? JSON.stringify(j) : ''));
const bv = await import(T + 'routes/botview.js'); j = await (await bv.GET(new Request(`http://x/api/botview?k=${k}`))).json();
ok(!j.error && !j.dca.deals.some(d => d.s === 'XRP/USD') && j.dca.markets.crypto.syms?.length === 12 && j.dca.markets.crypto.meme?.length === 6, 'botview: no XRP dust deal, markets carry syms');
import('fs').then(fs => fs.writeFileSync('fx-botview.json', JSON.stringify(j)));
