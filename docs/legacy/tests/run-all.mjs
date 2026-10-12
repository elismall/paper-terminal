// Runs every automated test and records the result in the project docs with a date stamp:
//   docs/test-runs/<YYYY-MM-DD-HHMM>-v<version>.md   full output of every check
//   docs/TEST-LOG.md                                   one summary row per run (appended)
// Usage (from the project root):  node tests/run-all.mjs            unit + integration tests (mocked Alpaca, Blob, SEC, wires, Jev)
//                                  node tests/run-all.mjs --ui       also the page-layout tests (needs Playwright + a local server:
//                                                                     python -m http.server 8767   in the project root)
// Nothing here touches the real paper account or Vercel: every outside service is faked in tests/mock.mjs + tests/newsmock.mjs.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.join(HERE, '..');
const version = (/VERSION = '([\d.]+)'/.exec(readFileSync(path.join(ROOT, 'lib/version.js'), 'utf8')) || [])[1] || '?';
export const SUITES = [
  ['t1.mjs', 'Core bot safety: run lock, safety ladder (levels 1–4, drawdown auto-pause), kill switch, emergency stop, DCA dust fix, Jev shadow/gate policy, control + health routes, bot view'],
  ['t4.mjs', 'Pre-market gap check (skip list, alerts, window), Jev hold review, AI view on trade cards, Jev probe format'],
  ['t5.mjs', 'Jev tab: log saved per run with state + what the bot did, /api/jev ask (stocks + crypto), passcode'],
  ['t6.mjs', 'v0.9.0: Blob storage migration + op budget, create-only lock, trailing take profit rule + orders, hourly crypto check, tile lists, crypto swing off, DCA training grid'],
  ['t7.mjs', 'v0.10.0: DCA 10 crypto deals with 2 meme-coin slots (caps, simulator never exceeds them, live slots), unlisted coins dropped, $1,400 per deal, meme price precision, meme results counted separately'],
  ['t8.mjs', 'v0.10.0: news sources (Benzinga, SEC 8-K, GlobeNewswire, PR Newswire, Fed), tagging, law-firm noise, Market Brief, bot news features (earnings estimate, offerings, downgrades), order-id news tag, daily history snapshot + Markdown, performance news scorecard, health probe'],
  ['t9.mjs', 'v0.10.0: a real stock entry with the news layer: shadow records "would skip", tag in the order id, gate mode skips, off mode, Jev news question passes the API format check'],
  ['t10.mjs', 'v0.11.0: economic calendar (FRED release dates + Fed meeting dates, CPI/jobs/Fed day = half size in gate mode), insider buying from SEC Form 4 (recorded only), SEC 10-a-second spacing, feed pause after errors, new scorecards'],
  ['t11.mjs', 'v0.11.0 crypto DCA: the DCA lab (every coin alone, picking checked on the unseen last third, bull runs vs holding BTC/ETH, 12 bull-run mixes), lab-picked coin list, bull-run core (buys BTC/ETH in a BTC uptrend, sells when it ends, waits for DCA deals, safety pause), wider trailing in bull runs, history + bot view'],
  ['t12.mjs', 'v0.11.0 crypto signals (shadow): Hyperliquid perp funding (no key) + FRED money conditions on new DCA deals, LEVERAGE_MODE gate/off, signal scorecard, Macro tab series, live chart mode of /api/bars'],
  ['t13.mjs', 'v0.12.0 $100 plan: account math (3 slots, 75% of profits traded again / 25% to the vault, $1 minimum, $60 floor, Alpaca crypto fees), concentrated DCA + momentum bar logic, backtest + walk-forward pick in the DCA lab, live virtual ledger (Blob write only on change), /api/dcalab + health ?probe=small'],
  ['t14.mjs', 'v0.12.1 audit fixes: per-coin price history + coverage, chronological DCA backtest (no same-candle restart), honest "proven", lab settings and coin list from its first two thirds only, lock outlasts a run + unconfirmed lock blocks entries, emergency stop covers the bull-run core and reports leftovers, missing BTC/news data = unknown, time exits keep the entry-time hold and skip later manual buys, $100 plan entry candle'],
  ['t15.mjs', 'v0.12.2 crypto price history: request pacer (2/s), stored history in Blob (new candles each run, older ones filled backwards with no holes, time budget, failed read never overwrites), crypto bars() gets every coin, never "proven" / lab not used while history is still downloading, /api/hist background job + route + 6 crons'],
  ['t16.mjs', 'v0.13.0 options + Catalyst Scenario: long calls/puts at three strikes (breakeven, move needed, decay, value at target), implied move from the straddle, earnings flag on option ideas, past earnings dates with before-open/after-close timing, scenarios for earnings / product / macro (right reaction session, clusters merged, earnings weeks left out, SEC full-text search, starred own words, volatility fallback), Jev or keywords classify, swing plan math, past events cleared per strike, log + grading + scorecard, /api/catalyst'],
  ['t17.mjs', 'v0.13.1 DCA rules for real money: 3 dip buys in training, first buy 15% of the deal (dip buys share the rest), old deals keep their old sizing via the -p tag in order ids, every take profit (plain and trailing) nets at least 0.5% after costs in the live rules and the backtest, the same rules in the $100 plan'],
];
const UI = [['uiac.mjs', 'Ticker suggestions as you type (v0.13.2) in Option ideas, Catalyst scenario and Ask Jev: stocks-only fields leave crypto out, company names match, arrow + Enter or a tap fills the field (and the Catalyst draft), list stays on screen at 1400/390/320 px'], ['uiopt.mjs', 'Options tab (v0.13.0): Catalyst scenario panel (form survives refreshes, answer boxes, long-call strikes with past events cleared, saved + graded scenarios), long call idea with the earnings flag, no sideways scroll at 1400/390/320 px'], ['uibt.mjs', 'Bot tab tiles and lists at 1400/390/320 px: no overlaps, no page overflow'], ['uinews.mjs', 'News tab (Market Brief dropdown: Top Gainers / Top Decliners rows, click a row for its card; sources, filters) and Benchmark daily history at 3 widths'], ['uijev.mjs', 'Jev tab layout'], ['uilab.mjs', 'DCA tab (key D): deal cards with the dip-buy ladder, resting orders, DCA activity with cents, closed deals, $100 plan, DCA lab + bull-run line; Bot tab one-line DCA summary; cleanup (Home, Swing, Account, Benchmark); live chart drawer, at 3 widths']];
const ui = process.argv.includes('--ui'), list = [...SUITES, ...(ui ? UI : [])];
const stamp = new Date(), et = stamp.toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const [mdy, hm] = et.split(', '), [mm, dd, yyyy] = mdy.split('/'), id = `${yyyy}-${mm}-${dd}-${hm.replace(':', '')}`;
const [H, Mi] = hm.split(':').map(Number), shown = `${yyyy}-${mm}-${dd} ${H % 12 || 12}:${String(Mi).padStart(2, '0')} ${H < 12 ? 'AM' : 'PM'}`;   // 12-hour Eastern for people; the file name keeps 24-hour so runs sort in order
let out = `# Test run ${shown} ET · v${version}\n\nNode ${process.version}. Every outside service is faked (tests/mock.mjs, tests/newsmock.mjs); nothing touches the real account.\n\n`;
const rows = []; let totalPass = 0, totalFail = 0;
for (const [file, what] of list) {
  const t0 = Date.now(), r = spawnSync(process.execPath, [file], { cwd: HERE, encoding: 'utf8', timeout: 900e3 });
  const text = `${r.stdout || ''}${r.stderr || ''}`, pass = (text.match(/^PASS /gm) || []).length, fail = (text.match(/^FAIL /gm) || []).length + (r.status && !/^FAIL /m.test(text) ? 1 : 0);
  totalPass += pass; totalFail += fail; const secs = ((Date.now() - t0) / 1000).toFixed(0);
  rows.push({ file, pass, fail, secs }); console.log(`${fail ? 'FAIL' : 'ok  '} ${file}: ${pass} passed, ${fail} failed (${secs} s)`);
  out += `## ${file} — ${pass} passed, ${fail} failed (${secs} s)\n\n${what}\n\n\`\`\`\n${text.trim().slice(0, 20000)}\n\`\`\`\n\n`;
}
mkdirSync(path.join(ROOT, 'docs/test-runs'), { recursive: true });
writeFileSync(path.join(ROOT, `docs/test-runs/${id}-v${version}.md`), out);
const log = path.join(ROOT, 'docs/TEST-LOG.md');
if (!existsSync(log)) writeFileSync(log, '# Test log\n\n| When (ET) | Version | Result | Suites | Details |\n|---|---|---|---|---|\n');
appendFileSync(log, `| ${shown} | ${version} | ${totalFail ? `**${totalFail} FAILED**, ` : ''}${totalPass} passed | ${rows.map(r => `${r.file} ${r.pass}${r.fail ? '/' + r.fail + ' fail' : ''}`).join(', ')} | [full output](test-runs/${id}-v${version}.md) |\n`);
console.log(`\n${totalPass} passed, ${totalFail} failed. Written: docs/test-runs/${id}-v${version}.md and a row in docs/TEST-LOG.md`);
process.exitCode = totalFail ? 1 : 0;
