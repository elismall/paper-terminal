# Test log

Every check run on this project, newest last, with date stamps (Eastern time). Two kinds:

- **Automated runs**: `node tests/run-all.mjs` (add `--ui` for page-layout checks). The runner appends one row to the table at the bottom and saves the full output in `docs/test-runs/`. Every outside service (Alpaca, Vercel Blob, SEC, press wires, Jev) is faked in `tests/mock.mjs` and `tests/newsmock.mjs`, so tests never touch the real account.
- **Live checks**: probes against the deployed site (`/api/health?probe=...`), written here by hand with the date and what came back.

What each suite covers is listed in `tests/run-all.mjs` (SUITES) and in `tests/README.md`.

## History before the automated log (from HANDOFF.md; full output was not kept)

| Date | Version | What was checked | Result |
|---|---|---|---|
| 2026-09-25 | 0.3.0 to 0.4.3 | Manual checks of each feature against the live site (crypto board, order ticket preview, bot runs, charts) | Worked; crypto training bug found and fixed in 0.4.1 (DOGE ATR rounded to 0) |
| 2026-09-26 | 0.6.0 | Live `/api/health?probe=dca`: DCA training on real hourly history | Crypto 122 deals +5.5%, ETFs 57 deals +5.9% (see RESULTS-LOG.md) |
| 2026-09-28 | 0.7.0 | Local mocked tests: run lock, safety ladder levels, dust fix, Jev tags, emergency stop | All passed (counts not recorded) |
| 2026-09-28 | 0.8.0 | Local mocked tests: Jev request format, gap check, hold review, Jev log, `/api/jev` ask, locked routes; UI desktop + phone | All passed; live Jev probe OK in 189 ms |
| 2026-09-28 | 0.9.0 | t6 24/24, t1 37, t4 18, t5 9; UI at 1400/390/320 px (no overlaps, no page overflow) | All passed |

## Live checks

| When (ET) | Version | Check | Result |
|---|---|---|---|
| 2026-09-28 1:51 PM | 0.9.0 | `/api/health?probe=store` | version 0.9.0, cryptoSwing false, store ok, direct Blob reads work |
| 2026-09-28 1:51 PM | 0.9.0 | `/api/bot-check` without the cron secret | 401 (correct) |
| 2026-09-28 1:52 PM | 0.9.0 | DCA retrain under the new grid (`dca/train-v2.json`) | Completed (see RESULTS-LOG.md) |
| 2026-09-28 4:09 PM | 0.10.0 | `/api/health` version + `?probe=dca` (retrain `dca/train-v3.json`) | version 0.10.0; retrain finished in under 5 min (see RESULTS-LOG.md) |
| 2026-09-28 4:11 PM | 0.10.0 | `?probe=news` | Benzinga 50, SEC 8-K 85 (timed out once on a cold start), Fed 20; GlobeNewswire times out from Vercel; PR Newswire 20 once, 404 once |
| 2026-09-28 6:59 PM | 0.11.0 | Production deploy (66 files by SHA-1) + `?probe=signals` | version 0.11.0. Hyperliquid reachable from Vercel with no key: 234 perp coins; BTC funding −7.1%/yr, ETH +11, SOL +11, PEPE +11. FRED money conditions: mixed (dollar −0.56, M2 growth +0.27, real yield +0.65) |
| 2026-09-28 6:59 PM | 0.11.0 | `?probe=lab` | lab null (not run yet, expected). BTC regime: uptrend (close 84,457.95 over 200-day 71,075.35, 50-day 76,105.75). Bull-run mode off because there is no lab run yet (correct) |
| 2026-09-28 7:00 PM | 0.11.0 | `?probe=news` calendar | **Problem:** FRED's all-releases date list timed out from Vercel twice ("Fed meeting dates only"), and the error was cached 6 hours. SEC 8-K and GlobeNewswire timed out; Benzinga 50, PR Newswire 20, Fed 20 |
| 2026-09-28 7:02 PM | 0.11.1 | Fix deployed: one small FRED request per release, errors cached 15 min | Calendar filled, but found a second problem: FRED's "FOMC Press Release" (rid 101) lists every day as a release date, so every day looked like a Fed day. One 502 from FRED for PCE (kept the rest) |
| 2026-09-28 7:04 PM | 0.11.2 | Fix deployed: FOMC days only from the built-in Fed list | Calendar correct: GDP 9/30 8:30 AM, PCE inflation 9/30 8:30 AM, Jobs report 10/2 8:30 AM (top), no errors. SSO set back to `all_except_custom_domains` |
| 2026-09-29 9:52 AM | 0.12.0 | Production deploy (68 files by SHA-1; a preview with the same list built first) + `/api/health` | version 0.12.0, cron on, Jev shadow, cryptoSwing false |
| 2026-09-29 9:52 AM | 0.12.0 | `?probe=small` ($100 plan, dry: nothing saved) | Works on real prices. Uses the starting defaults because the lab hasn't run since 0.12.0. Concentrated DCA opened ARB, ADA, AVAX at $4.17 each (cash $87.50 left for dip buys); Momentum bought AAVE $33.33 at 173.087 with its 12% trailing floor at 152.32. Both show −0.1% (fees) |
| 2026-09-29 9:52 AM | 0.12.0 | `?probe=lab` | Last lab run 9/28 7:17 PM ET (before 0.12.0, so `small: null`, expected). **Problem found:** that run only had usable history for 5 coins (GRT, AAVE, AVAX, DOGE, BONK) out of ~32 candidates, 3,439 bars. Cause not found from here (no Alpaca or runtime-log access); see HANDOFF next steps |
| 2026-09-29 9:52 AM | 0.12.0 | `/js/3i-dca.js` served (DCA tab); `/api/dcalab` without the passcode | Served, `dcaTabShell` present; 401 without the passcode (correct). SSO set back to `all_except_custom_domains` |
| 2026-09-29 2:02 PM | 0.13.0 | Production deploy (74 files by SHA-1, `dpl_49YvzsRgVqqNqZ7yxyddxFavEUWJ`) + `/api/health` + `/js/3j-catalyst.js` served | version 0.13.0; Catalyst panel script served |
| 2026-09-29 2:03 PM | 0.13.0 | `?probe=hist` (background history download) | Ran ~4 min (WebFetch timed out, the function finished): hourly file 18 coins, 0 complete yet (expected: ~50 pages per coin at 2 requests/s = 2–3 runs) |
| 2026-09-29 2:08 PM | 0.13.0 | Read `hist/status.json` + history files | **Problem found:** the daily training's save at 2:08:15 replaced the background download's save from 2:07:34 (each run saved only its own view), so the download's progress was lost. Fixed in 0.13.1 (re-read and merge on save) |
| 2026-09-29 2:46 PM | 0.13.1 | Production deploy (74 files by SHA-1, `dpl_Hdnrz54nKXHDK7FKWH3XnTSe8Bvn`) + `/api/health` | version 0.13.1 |
| 2026-09-29 2:48 PM | 0.13.1 | `?probe=dca` (retrain `dca/train-v6.json`: 3 dip buys, 15% first buy, 0.5% minimum) | Completed and saved: crypto 432 settings, 18 coins, 90–150 days of history each (still downloading, so "not proven"); ETFs 144 settings, proven (see RESULTS-LOG.md). SSO set back to `all_except_custom_domains` |
| 2026-09-29 3:18 PM | 0.13.2 | Production deploy (74 files by SHA-1, `dpl_2jqTqLRuyYD2WcGBtWVsxAHC9xoo`) + `/api/health` + `/js/4-search-init.js` served | version 0.13.2; ticker suggestions and company-name code served. SSO set back to `all_except_custom_domains` |

## Automated runs

| When (ET) | Version | Result | Suites | Details |
|---|---|---|---|---|
| 2026-09-28 3:43 PM | 0.10.0 | 166 passed | t1.mjs 37, t4.mjs 18, t5.mjs 9, t6.mjs 24, t7.mjs 16, t8.mjs 32, t9.mjs 7, uibt.mjs 13, uinews.mjs 7, uijev.mjs 3 | [full output](test-runs/2026-09-28-1543-v0.10.0.md) |
| 2026-09-28 4:19 PM | 0.11.0 | **1 FAILED**, 213 passed | t1.mjs 37, t4.mjs 18, t5.mjs 9, t6.mjs 24, t7.mjs 16, t8.mjs 31/1 fail, t9.mjs 7, t10.mjs 24, uibt.mjs 13, uinews.mjs 31, uijev.mjs 3 | [full output](test-runs/2026-09-28-1619-v0.11.0.md) |
| 2026-09-28 6:25 PM | 0.11.0 | 286 passed | t1.mjs 37, t4.mjs 18, t5.mjs 9, t6.mjs 24, t7.mjs 16, t8.mjs 32, t9.mjs 7, t10.mjs 24, t11.mjs 34, t12.mjs 19, uibt.mjs 13, uinews.mjs 31, uijev.mjs 3, uilab.mjs 19 | [full output](test-runs/2026-09-28-1825-v0.11.0.md) |
| 2026-09-28 6:55 PM | 0.11.0 | 220 passed | t1.mjs 37, t4.mjs 18, t5.mjs 9, t6.mjs 24, t7.mjs 16, t8.mjs 32, t9.mjs 7, t10.mjs 24, t11.mjs 34, t12.mjs 19 | [full output](test-runs/2026-09-28-1855-v0.11.0.md) |
| 2026-09-28 7:05 PM | 0.11.2 | 291 passed | t1.mjs 37, t4.mjs 18, t5.mjs 9, t6.mjs 24, t7.mjs 16, t8.mjs 32, t9.mjs 7, t10.mjs 29, t11.mjs 34, t12.mjs 19, uibt.mjs 13, uinews.mjs 31, uijev.mjs 3, uilab.mjs 19 | [full output](test-runs/2026-09-28-1905-v0.11.2.md) |
| 2026-09-29 9:21 AM | 0.12.0 | 347 passed | t1.mjs 37, t4.mjs 18, t5.mjs 9, t6.mjs 24, t7.mjs 16, t8.mjs 32, t9.mjs 7, t10.mjs 29, t11.mjs 34, t12.mjs 19, t13.mjs 23, uibt.mjs 16, uinews.mjs 31, uijev.mjs 3, uilab.mjs 49 | [full output](test-runs/2026-09-29-0921-v0.12.0.md) |
| 2026-09-29 9:44 AM | 0.12.0 | 347 passed | t1.mjs 37, t4.mjs 18, t5.mjs 9, t6.mjs 24, t7.mjs 16, t8.mjs 32, t9.mjs 7, t10.mjs 29, t11.mjs 34, t12.mjs 19, t13.mjs 23, uibt.mjs 16, uinews.mjs 31, uijev.mjs 3, uilab.mjs 49 | [full output](test-runs/2026-09-29-0944-v0.12.0.md) |
| 2026-09-29 11:36 AM | 0.12.1 | **1 FAILED**, 355 passed | t1.mjs 37, t4.mjs 18, t5.mjs 9, t6.mjs 10/1 fail, t7.mjs 16, t8.mjs 32, t9.mjs 7, t10.mjs 29, t11.mjs 34, t12.mjs 19, t13.mjs 23, t14.mjs 22, uibt.mjs 16, uinews.mjs 31, uijev.mjs 3, uilab.mjs 49 | [full output](test-runs/2026-09-29-1136-v0.12.1.md) |
| 2026-09-29 11:47 AM | 0.12.1 | 369 passed | t1.mjs 37, t4.mjs 18, t5.mjs 9, t6.mjs 24, t7.mjs 16, t8.mjs 32, t9.mjs 7, t10.mjs 29, t11.mjs 34, t12.mjs 19, t13.mjs 23, t14.mjs 22, uibt.mjs 16, uinews.mjs 31, uijev.mjs 3, uilab.mjs 49 | [full output](test-runs/2026-09-29-1147-v0.12.1.md) |
| 2026-09-29 12:04 PM | 0.12.1 | 369 passed | t1.mjs 37, t4.mjs 18, t5.mjs 9, t6.mjs 24, t7.mjs 16, t8.mjs 32, t9.mjs 7, t10.mjs 29, t11.mjs 34, t12.mjs 19, t13.mjs 23, t14.mjs 22, uibt.mjs 16, uinews.mjs 31, uijev.mjs 3, uilab.mjs 49 | [full output](test-runs/2026-09-29-1204-v0.12.1.md) |
| 2026-09-29 1:08 PM | 0.13.0 | **2 FAILED**, 455 passed | t1.mjs 37, t4.mjs 18, t5.mjs 9, t6.mjs 23/1 fail, t7.mjs 16, t8.mjs 32, t9.mjs 7, t10.mjs 29, t11.mjs 34, t12.mjs 19, t13.mjs 22/1 fail, t14.mjs 21, t15.mjs 24, t16.mjs 37, uiopt.mjs 28, uibt.mjs 16, uinews.mjs 31, uijev.mjs 3, uilab.mjs 49 | [full output](test-runs/2026-09-29-1308-v0.13.0.md) |
| 2026-09-29 1:22 PM | 0.13.0 | 458 passed | t1.mjs 37, t4.mjs 18, t5.mjs 9, t6.mjs 24, t7.mjs 16, t8.mjs 32, t9.mjs 7, t10.mjs 29, t11.mjs 34, t12.mjs 19, t13.mjs 23, t14.mjs 21, t15.mjs 25, t16.mjs 37, uiopt.mjs 28, uibt.mjs 16, uinews.mjs 31, uijev.mjs 3, uilab.mjs 49 | [full output](test-runs/2026-09-29-1322-v0.13.0.md) |
| 2026-09-29 2:25 PM | 0.13.1 | **10 FAILED**, 342 passed | t1.mjs 37, t4.mjs 18, t5.mjs 9, t6.mjs 22/2 fail, t7.mjs 14/2 fail, t8.mjs 32, t9.mjs 7, t10.mjs 29, t11.mjs 33/2 fail, t12.mjs 19, t13.mjs 19/4 fail, t14.mjs 21, t15.mjs 27, t16.mjs 37, t17.mjs 18 | [full output](test-runs/2026-09-29-1425-v0.13.1.md) |
| 2026-09-29 2:34 PM | 0.13.1 | 479 passed | t1.mjs 37, t4.mjs 18, t5.mjs 9, t6.mjs 24, t7.mjs 16, t8.mjs 32, t9.mjs 7, t10.mjs 29, t11.mjs 35, t12.mjs 19, t13.mjs 23, t14.mjs 21, t15.mjs 27, t16.mjs 37, t17.mjs 18, uiopt.mjs 28, uibt.mjs 16, uinews.mjs 31, uijev.mjs 3, uilab.mjs 49 | [full output](test-runs/2026-09-29-1434-v0.13.1.md) |
| 2026-09-29 3:06 PM | 0.13.2 | 513 passed | t1.mjs 37, t4.mjs 18, t5.mjs 9, t6.mjs 24, t7.mjs 16, t8.mjs 32, t9.mjs 7, t10.mjs 29, t11.mjs 35, t12.mjs 19, t13.mjs 23, t14.mjs 21, t15.mjs 27, t16.mjs 37, t17.mjs 18, uiac.mjs 34, uiopt.mjs 28, uibt.mjs 16, uinews.mjs 31, uijev.mjs 3, uilab.mjs 49 | [full output](test-runs/2026-09-29-1506-v0.13.2.md) |
| 2026-09-29 3:11 PM | 0.13.2 | 513 passed | t1.mjs 37, t4.mjs 18, t5.mjs 9, t6.mjs 24, t7.mjs 16, t8.mjs 32, t9.mjs 7, t10.mjs 29, t11.mjs 35, t12.mjs 19, t13.mjs 23, t14.mjs 21, t15.mjs 27, t16.mjs 37, t17.mjs 18, uiac.mjs 34, uiopt.mjs 28, uibt.mjs 16, uinews.mjs 31, uijev.mjs 3, uilab.mjs 49 | [full output](test-runs/2026-09-29-1511-v0.13.2.md) |
