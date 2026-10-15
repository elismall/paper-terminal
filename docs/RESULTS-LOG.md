# Results log

What the bot's training and live signals actually produced, dated (Eastern time, 12-hour clock). Paper money only. These are backtest numbers on past data unless a row says "live". Past results don't promise future ones.

Where the numbers come from:

- **DCA training** (`lib/dca.js`, daily, cached in Blob `dca/train-v5.json` since v0.12.2): tests every setting in the grid (864 for crypto, 288 for ETFs) on 365 days of hourly bars, replaying the bot's real run schedule. "Walk-forward" = settings picked on the first 2/3 of the year and judged on the last 1/3 they never saw. That number is the honest one.
- **DCA lab** (`lib/dcalab.js`, weekly on Sundays at 5:10 AM ET, or DCA tab → "Run the lab now"; Blob `dca/lab-v1.json`; read it at `/api/dcalab`): tests every crypto coin Alpaca lists on about 4 years of 4-hour bars, decides which coins the DCA bot trades and whether bull-run mode is used. Both decisions are only switched on if they beat the alternatives on the unseen last third. Since v0.12.0 it also tests the $100 plan.
- **$100 plan** (`lib/small.js`, v0.12.0): two virtual $100 crypto accounts (Concentrated DCA and Momentum), 3 slots, 75% of each profit reinvested and 25% to a vault, new entries stop under $60. Settings are picked in the lab on the first 2/3 of the history and judged on the last 1/3 with a fresh $100. Live, it runs VIRTUAL on real prices at every hourly crypto check (Blob `small/ledger.json`); no orders.
- **Daily scoreboard** (`/api/history`, Blob `stats/history.json`): one snapshot per day of each bot's realized and open P&L plus the scorecards (Jev, news flags, funding, money conditions). The Benchmark tab reads it.

## DCA training snapshots

| When (ET) | Version | Market | Picked setting | Deals | Return on budget | Worst drop | Walk-forward (unseen third) | Typical no-stop 3Commas setup |
|---|---|---|---|---|---|---|---|---|
| 2026-09-26 | 0.6.0 | Crypto ($14k) | 6 dips from −2.5% (gaps ×1.4, size ×1.8), take profit +2.5%, hard exit 5%, start right away | 122 | +5.5% (364 days) | 4.6% | +1.6% | not recorded |
| 2026-09-26 | 0.6.0 | ETFs ($6k) | 4 dips from −1% (×1.4, ×1.8), take profit +1.5%, hard exit 3%, uptrend + hourly dip start | 57 | +5.9% | 0.9% | +0.2% | not recorded |
| 2026-09-28 1:51 PM | 0.9.0 | Crypto | 6 dips from −2.5% (×1.4, ×1.8), trailing take profit from +1% (1% trail), hard exit 5%, uptrend start | 55 | +5.49% | 0.95% | +0.47% | −16.9% |
| 2026-09-28 1:51 PM | 0.9.0 | ETFs | 6 dips from −1% (even gaps, ×1.8), take profit +0.5%, hard exit 3%, start right away | 324 | +3.55% | 0.57% | +0.75% | +14.7% (rising year, no stop) |
| 2026-09-28 4:10 PM | 0.10.0 | Crypto (10 deals, 2 meme slots) | 6 dips from −2.5% (×1.4, ×1.8), trailing take profit from +1.5%, hard exit 5%, uptrend start | 96 | +4.91% | 0.38% | +0.25% | not recorded |
| 2026-09-28 4:10 PM | 0.10.0 | ETFs | 4 dips from −1%, take profit +1%, hard exit 3% | 106 | +7.85% | not recorded | +1.28% | not recorded |

| 2026-09-29 12:15 PM | 0.12.1 | Crypto | not proven: "only 0 deals in the unseen third (needs 6)" | — | — | — | — | — |
| 2026-09-29 12:15 PM | 0.12.1 | ETFs | proven | 107 | — | — | +1.64% | — |

| 2026-09-29 2:48 PM | 0.13.1 | Crypto (3 dip buys, 15% first buy, 0.5% minimum; history still downloading: 90–150 days per coin) | 3 dips from −4% (gaps ×1.5, size ×1.5), trailing take profit from +4% (2% trail), hard exit 15%, uptrend start | 142 (100% win) | +15.65% (150 days) | 3.4% | +10.47% | +29.6% (buy and hold the same coins +32.3%) |
| 2026-09-29 2:48 PM | 0.13.1 | ETFs (3 dip buys, 15% first buy, 0.5% minimum) — proven | 3 dips from −0.75% (even gaps, size ×2), take profit +1%, hard exit 3%, uptrend + hourly dip start | 108 (99.1% win) | +15.12% (365 days) | 2.21% | +3.89% | +17.05% (buy and hold +20.7%) |

Note on the 0.13.1 rows: the crypto row is still on partial history (the bot runs half the deals until it is complete), and over this window the no-stop setup and plain holding made more than the bot, with no hard exits to limit a crash. The bot's edge is the capped downside (worst drop 3.4% / 2.2%), not the raw return in a rising market.

**Data warning (found 2026-09-29 12:15 PM ET, fixed in v0.12.2):** Alpaca's crypto bar pages hold only ~170 hourly bars (~7 days) each, and the downloads stopped after a fixed number of pages. The crypto training rows above (0.6.0 through 0.12.1) were made on far less history than "365 days" (v0.12.1: about 3 weeks per coin; earlier multi-coin requests lost most coins entirely). **Treat every crypto DCA number above as unreliable.** ETF rows are fine (stock pages hold 10,000 bars). From v0.12.2 the crypto history is stored and completed over a few days; training stays "not proven" until it is complete. The first training on complete history goes in the next row.

Settings retrain daily and can change; the DCA tab's rules card always shows the live ones.

## DCA lab runs

| When (ET) | Version | Coins picked | Picking helped on unseen data? | Bull-run mode chosen | Beat normal deals on unseen data? |
|---|---|---|---|---|---|
| 2026-09-28 7:17 PM | 0.11.2 | **Only 5 coins had usable history** (GRT +24.6% over 201 deals, AAVE +16.2% / 121, AVAX +3.9% / 97, DOGE +3.3% / 18, BONK 0 deals, listed since 2/16/26), 3,439 four-hour bars from 9/30/22. ~32 were expected; cause still open | No: picking was not used, so the bot kept the hand list (AVAX, AAVE, DOGE, BONK were the hand-list coins that had data) | No (normal deals: 236 deals, +1.78%, worst drop 0.9%) | n/a |

The 5-coin run is not a fair test of the coin list or bull-run mode. Cause found 2026-09-29 (small crypto pages shared across coins, capped page count) and fixed in v0.12.2; since then the bot ignores lab runs made before the fix (v1) or while history is still downloading (`partial`).

## $100 plan (virtual)

| When (ET) | Version | What | Result |
|---|---|---|---|
| 2026-09-29 9:52 AM | 0.12.0 | Dry probe on real prices, starting defaults (lab not run since 0.12.0) | Concentrated DCA: 3 dip buys from −3% (gaps ×1.5, each 2× the last), trailing take profit from +3% (4% under the best price), hard exit 15%, uptrend start → opened ARB, ADA, AVAX at $4.17 each. Momentum: close above the 60-bar high (10 days) while BTC is in an uptrend, 12% trailing stop → bought AAVE $33.33. Nothing saved (dry) |
| (pending) | 0.12.0 | First lab result with the $100 plan (walk-forward) | Next lab run: Sunday 10/4 at 5:10 AM ET, or DCA tab → "Run the lab now" |

## Live signal snapshots (shadow: recorded, not acted on)

| When (ET) | Version | Perp funding (Hyperliquid, %/yr) | Money conditions (FRED) | BTC regime |
|---|---|---|---|---|
| 2026-09-28 6:59 PM | 0.11.0 | BTC −7.1, ETH +11, SOL +11, PEPE +11 (234 coins listed) | mixed (dollar −0.56, M2 growth +0.27, real yield +0.65 over 3 months) | uptrend: close 84,457.95 over 200-day 71,075.35, 50-day 76,105.75. Bull-run mode still off until the lab runs |

## Live paper scoreboard (Benchmark tab, copied from Eli's screenshots 2026-10-15)

Real paper trades, not backtests. Live site was still on v0.17.1 for this whole window.

| Day (ET) | Equity | Day P&L | Swing closed | DCA closed | Meme closed |
|---|---|---|---|---|---|
| 2026-09-28 | $98,835 | −$1,143 | 5 · −$310 | 4 · +$11 | 1 · +$7.30 |
| 2026-09-29 | $98,867 | +$203 | 0 | 5 · +$5.50 | 1 · +$0.38 |
| 2026-10-01 to 10-05 | $98,698 | $0 | 0 | 0 | 0 (nothing open: bot idle, cause unknown) |
| 2026-10-06 | $98,687 | −$11 | 0 | 0 | 0 |
| 2026-10-08 | $97,864 | −$688 | 2 · −$475 | 3 · −$45 | 2 · −$61 |
| 2026-10-09 | $98,193 | +$368 | 0 | 3 · +$18 | 0 |
| 2026-10-11 | $98,455 | +$208 | 0 | 3 · +$59 | 1 · +$17 |
| 2026-10-12 | $98,034 | −$214 | 0 | 5 · +$74 | 2 · +$29 |
| 2026-10-13 | $97,724 | −$220 | 6 · −$722 | 1 · +$54 | 1 · +$54 |
| 2026-10-15 2:40 PM | $94,132 | +$116 | | | 3 stock + 14 crypto positions open, −$302 open P&L |

Totals 9/28 to 10/13: swing 13 trades −$1,507; DCA 24 deals +$176.50; meme 8 deals +$46.68. Equity fell $3,592 between the
10/13 snapshot and 10/15 with only −$302 open P&L, so something closed at a loss on 10/14 or money moved (not yet explained).
The DCA crypto settings changed five times in this window (daily retraining).

## Economic calendar snapshots

| When (ET) | Version | Next 14 days |
|---|---|---|
| 2026-09-28 7:04 PM | 0.11.2 | GDP Wed 9/30 8:30 AM, PCE inflation Wed 9/30 8:30 AM, Jobs report Fri 10/2 8:30 AM (top event). Next Fed decision Wed 10/28 2:00 PM (outside the window) |

## Catalyst scenarios (v0.13.0, Options tab)

Every scenario you run is saved (Blob `catalyst/log-v1.json`) and graded after its holding period: move vs the expected range, right direction, and whether the swing plan's target or stop came first. The panel's scorecard is the live record; copy notable rows here.

| When (ET) | Stock | Type | Scenario | Expected range | Result |
|---|---|---|---|---|---|
| (pending) | | | First graded scenarios after Eli starts using the panel | | |
