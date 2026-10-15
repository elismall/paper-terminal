// Makes tests/fx-catalyst.json (a Catalyst Scenario answer + the saved/graded list) and tests/fx-optcall.json (a long call idea
// with the earnings flag) from the mocks, for the Options-tab UI test (uiopt.mjs).
import { M, blob } from './mock.mjs';
import { subsHistory } from './optmock.mjs';
import fs from 'node:fs';
process.env.SEC_USER_AGENT = 'ELI Terminal test test@example.com';
const T = new URL('../', import.meta.url).href;
const C = await import(T + 'lib/catalyst.js'), core = await import(T + 'lib/core.js');
M.subsOverride = subsHistory(12);
const run = await C.runScenario({ symbol: 'AAPL', text: 'Apple beats earnings and raises guidance, iPhone demand strong', horizon: 5 });
const L = JSON.parse(blob['catalyst/log-v1.json']);
L.items.push({ id: 'old1', at: '2026-08-01T15:00:00Z', s: 'NVDA', text: 'rumored new chip launch', kind: 'rumor', dir: 'up', horizon: 5, px: 120, band: { lo: -4, hi: 6 }, grade: { movePct: 3.2, dirHit: true, inBand: true, swing: 'target' } },
  { id: 'old2', at: '2026-08-05T15:00:00Z', s: 'MRNA', text: 'FDA decision', kind: 'regulatory', dir: 'down', horizon: 1, px: 40, band: { lo: -8, hi: 8 }, grade: { movePct: 9.1, dirHit: false, inBand: false, swing: 'stop' } });
const list = { items: L.items, score: C.scorecard(L.items), kinds: C.KINDS, horizons: C.CAT.horizons, jev: 'off', at: new Date().toISOString() };
fs.writeFileSync(new URL('./fx-catalyst.json', import.meta.url), JSON.stringify({ run, list }));
const R = await import(T + 'routes/options.js'), px = run.px;
const oc = await (await R.GET(new Request(`http://x/api/options?k=${core.tokenFor('pw')}&symbol=AAPL&strategy=call&dte=60&target=${(px * 1.1).toFixed(2)}`))).json();
fs.writeFileSync(new URL('./fx-optcall.json', import.meta.url), JSON.stringify(oc));
console.log('fx-catalyst.json', run.counted, 'events;', 'fx-optcall.json', oc.idea?.strikes?.length, 'strikes, earn', !!oc.idea?.earn);
