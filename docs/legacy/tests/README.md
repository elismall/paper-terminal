# Tests

Automated checks for ELI TERMINAL. They run on your own computer or any machine with Node.js 22+, fully offline from the real account: `mock.mjs` fakes Alpaca, Vercel Blob and Jev; `newsmock.mjs` fakes the news sources (Benzinga, SEC, GlobeNewswire, PR Newswire, Fed); `mockdata.mjs` makes synthetic price history.

Run everything and record the result in `docs/TEST-LOG.md` + `docs/test-runs/`:

```
node tests/run-all.mjs
```

Page-layout checks as well (needs `npm i -D playwright` and a local server in the project root, `python -m http.server 8767`):

```
node tests/run-all.mjs --ui
```

| File | Covers |
|---|---|
| t1.mjs | Core bot safety: lock, ladder, kill switch, emergency stop, DCA dust, Jev shadow/gate, control + health routes, bot view |
| t4.mjs | Pre-market gap check, Jev hold review, AI view on cards |
| t5.mjs | Jev tab log and live ask |
| t6.mjs | v0.9.0 storage migration, lock, trailing take profit, hourly crypto check, tile lists |
| t7.mjs | v0.10.0 DCA: 10 crypto deals, 2 meme slots, sizing, precision |
| t8.mjs | v0.10.0 news sources, Market Brief, bot news features, daily history |
| t9.mjs | v0.10.0 real stock entry with the news layer (shadow, gate, off, Jev) |
| t10.mjs | v0.11 economic calendar (FRED per-release dates, built-in Fed days, 15-minute retry on failure), SEC Form 4 insider buys, news flags C and I |
| t11.mjs | v0.11 DCA lab (coin picking, bull-run combos, walk-forward), bull-run mode, BTC/ETH core sleeve, stale lab ignored |
| t12.mjs | v0.11 perp funding (Hyperliquid), money conditions (FRED), order-id tags, LEVERAGE_MODE gate/off, DCA signal scorecard, Macro series, live chart bars |
| t13.mjs | v0.12 $100 plan: money rules (3 slots, 75/25 compound, $60 floor, $1 minimum, fees), concentrated DCA ladder, momentum entries/trailing exits, lab walk-forward pick, virtual ledger (writes only on change), `?small=1`, health probe |
| t14.mjs | v0.12.1 audit fixes (updated for v0.12.2): per-coin crypto history + coverage, chronological DCA backtest, honest "proven", lab without leakage, run lock, emergency stop, missing data = unknown, stock time exits, $100 plan entry candle |
| t15.mjs | v0.12.2 crypto price history: request pacer, stored history (new candles + backwards fill, no holes, time budget, failed read never overwrites, puts only when needed), "proven"/lab gated while downloading, /api/hist job + route + crons |
| t16.mjs | v0.13.0 long calls/puts, implied move, earnings flag on option ideas, past earnings timing, Catalyst Scenario (every catalyst type, Jev/keywords, stats, plans, log + grading), /api/catalyst |
| t17.mjs | v0.13.1 DCA rules for real money: 3 dip buys in training, first buy 15% of the deal, `-p` tag in order ids (old deals keep their sizing), 0.5% minimum profit after costs in the live rules, the backtest and the $100 plan |
| uiac.mjs | v0.13.2 ticker suggestions under every symbol field (Option ideas, Catalyst, Ask Jev, order ticket): stocks-only fields drop crypto, company names match, arrow + Enter or tap fills, on screen at 3 widths |
| uiopt.mjs | v0.13.0 Options tab: Catalyst scenario panel + long call idea at 1400/390/320 px (draft survives refreshes, no sideways scroll) |
| uibt.mjs / uinews.mjs / uijev.mjs / uilab.mjs | Bot tab (stocks + DCA line), News (Market Brief dropdown) + Benchmark history, Jev tab, DCA tab (resting orders, closed deals, $100 plan, lab) + site cleanup + live ticking chart, at 1400/390/320 px |

`mkfx-lab.mjs` rebuilds `fx-dcalab.json` (the DCA lab fixture) and `mkfx-cat.mjs` rebuilds `fx-catalyst.json` + `fx-optcall.json` (Options tab fixtures) from the mocks. `optmock.mjs` adds the option chain, SEC full-text search and long filing/headline histories (v0.13.0).

Fixtures: `fx-*.json` (saved API responses used by the UI checks). Screenshots (`*.png`) are written here and are not committed.
