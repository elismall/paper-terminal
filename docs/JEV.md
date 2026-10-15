# Jev (TypeSafe AI) in ELI TERMINAL

Last updated: 2026-09-29 (v0.12.0). Everything about the AI second opinion in one place. Code: `lib/jev.js` (questions, policy, tags, chart snapshot), `lib/review.js` (hold review + call log), `routes/jev.js` (Jev tab API), `routes/brief.js` (Market Brief), `js/3d-jev.js` (Jev tab), wiring in `lib/botcore.js` and `lib/dca.js`.

## What it is

Jev is TypeSafe's model (`jev-1.13.0` by default) answering structured questions about **numbers**: the bot's own rules pick a trade, then Jev is asked a fixed set of questions about that setup. It never places orders, never touches stops, exits or risk limits, and the hard safety rules (lib/control.js) always win. Rule of thumb in the code: **code computes, Jev judges, code decides.**

Jev reads charts as numbers, not pictures: `chartState(bars)` turns the last completed daily candles into a small snapshot (1/5/20-day returns, the last 10 closes vs now, distance to the 20-day high/low and 52-week high, up/down streak, the last candle's body/wicks/close position, 5- vs 20-day volume, ATR14 vs ATR50). Well under 400 tokens per call.

## Setup and switches (Vercel environment variables)

| Variable | Values | Meaning |
|---|---|---|
| `TYPESAFE_API_KEY` | set by Eli (Sensitive) | Without it Jev is off and never called. Verified working 2026-09-28 (`/api/health?probe=jev`, answered in 189 ms). Cloud API, nothing installed locally. |
| `JEV_MODE` | `shadow` (default once the key exists) · `gate` · `off` | shadow = ask and record, trades unchanged. gate = the policy below can skip or halve new entries. off = never called. |
| `JEV_MODEL` | default `jev-1.13.0` | Model name sent with each request. |

Request: `POST https://api.typesafe.ai/v1/systemone` with `Authorization: Bearer <key>`, body `{ model, state, questions }`. Question types: `score` (0 to n−1 + confidence), `choice` (one label + confidence), `noul` (probability 0–1). Timeout 4 s per call, one retry on HTTP 429/529 after 0.5 s. Calls for one run go out in parallel.

## Every question it is asked

**New entry** (`ENTRY_Q`, stock swing, crypto swing and each new DCA deal's first buy):

| Key | Type | Question |
|---|---|---|
| quality | score 0–3 | Given only these numbers, how good is this long entry for a gain over the next few days? (Poor / Marginal / Decent / Strong) |
| trend | score 0–3 | How strong and orderly is the uptrend? |
| regime | choice | trending / mean_reverting / choppy |
| extended | noul | Is price stretched too far above its recent averages and range to buy now? |
| reversal | noul | Do the latest candles show selling pressure that often comes before a drop? |
| volume_ok | noul | Does recent volume support the price move? |
| downside | noul | Is a sharp drop over the next few days more likely than usual? |

**Stock entries also get the news** (`ENTRY_NEWS_Q` = the above + `news_support`, v0.10.0): the recent headlines and SEC filings from `lib/news.js` go in the state, plus: "Do the recent headlines and filings support buying this stock now, with no earnings report, share offering or bad-news risk right ahead?" (noul). Since v0.12.1 the question also says: a null field means that data could not be fetched (see `news.data_status`) and is unknown, not good or bad news; earnings dates are estimates. Flag **Q** (news data partly missing) means caution / half size in `NEWS_MODE=gate`.

**Catalyst Scenario** (`CATALYST_Q`, v0.13.0, Options tab, one call per scenario you run, not logged, never trades): the state is `{ symbol, scenario (your text, up to 500 characters), catalyst_date, holding_days, typical_daily_move_pct, next_earnings_est }`. Questions: kind (choice: earnings / product / rumor / regulatory / deal / analyst / macro / other), direction (choice: up / down / unclear, "if the scenario happens as described"), size (score: smaller than a normal day / about normal / large / very large), priced_in (noul). Jev's kind and direction are used only when its answer is at least 40% on that label; otherwise keywords in your text decide, and your own picks in the form override both. **Jev never supplies the numbers**: the move range, the swing plan and the option strikes come from the stock's own price history around similar past events (`lib/catalyst.js`). priced_in ≥ 0.6 adds a warning.

A note on "confidence": for `score` and `choice` answers it is how concentrated Jev's answer is on one label, not a calibrated probability; `noul` answers have no confidence field.

**Hold review** (`REVIEW_Q`, after each real main run, every open swing position; shadow only, never acted on): hold (score: Exit now / Weak hold / Hold / Strong hold), continues (noul), fading (noul), downside (noul). Saved to Blob `jev/review.json` and shown on trade cards as "AI view (shadow)".

**Market Brief** (`NEWS_Q`, News tab, up to 6 stocks, cached 10 minutes, not logged): impact (score None/Small/Meaningful/Major), direction (up/down/unclear), priced_in (noul), risk_event (noul).

What each state contains: swing entries use `swingState()` (setup, rules score, RSI14, volume vs 20-day, 3-month relative strength, ATR %, distance from the 20/50/200-day averages, trend flag, 3-month market return, chart snapshot). DCA deals use `dcaState()` in `lib/dca.js` (hourly RSI14, above/below and % from the 200-day, take profit %, dip buys, deepest dip %, hard exit %, chart snapshot, and for crypto the perp funding %/yr and money conditions).

## Where the answers are kept

- **In the entry order id** (the bot has no database): `-j<score×10>[e<stretched>r<selling>d<drop risk>]`, each a tenth 0–9, e.g. `-j24e3r1d2` = quality 2.4, stretched 0.3, selling 0.1, drop risk 0.2. DCA puts it on the deal's first buy only. Old `-jNN` ids still parse. Stock orders also carry the news tag `-n<headlines><flags>[w<Jev news 0–9>]`.
- **Call log**: Blob `jev/log.json`, the last 60 calls from real runs with the exact state sent, the answers and what the bot did (bought / passed and why / not taken). Shown on the Jev tab.
- **Hold review**: Blob `jev/review.json`.

## The gate policy (only in `JEV_MODE=gate`)

Thresholds in `JEV.gate` (`lib/jev.js`). Checked in this order; it can only make the bot more careful:

1. drop risk ≥ 0.75 → **skip**
2. quality < 1.0 with confidence ≥ 0.6 → **skip**
3. quality < 1.6 or confidence < 0.4 → **half size**
4. stretched ≥ 0.7 or selling pressure ≥ 0.7 ("flag") → **half size**
5. otherwise normal

DCA deals are never resized, only skipped. If Jev fails or times out, the trade goes ahead on the rules alone; in gate mode the safety ladder drops to level 2 "Caution" for that run.

## Where it shows in the app

- **Jev tab (key J)**: plain-English explainer, how one decision is made, **Ask Jev** about any symbol (builds the exact snapshot the bot would send; not logged, no trade), the latest real calls, the hold review, the **scorecard** (closed trades and deals grouped by the score Jev gave at entry: Weak under 1 / Middling 1–2 / Strong 2+, and flagged vs not), and the exact questions and policy. Since v0.12.0 the scorecard is only here (it was also on Benchmark).
- **Bot tab → Safety panel**: Jev mode and model.
- **Trade cards**: the entry score and the hold review ("AI view (shadow)").
- **Options tab → Catalyst scenario** (v0.13.0): the answer line says whether the type and direction came from Jev (and how sure), from keywords, or from you.
- **News tab**: Jev's read of each Market Brief stock; the news scorecard includes "Jev: news supports (60%+)" / "doubtful (under 40%)" rows.
- `/api/health?probe=jev`: one tiny test call (never returns the key).

## When to switch to gate

Only after the scorecard shows a real split over 30+ closed trades/deals: Weak scores clearly losing and Strong scores clearly winning. Until then leave `JEV_MODE` unset (shadow).

## Tests

- `tests/t1.mjs`: shadow vs gate policy, tags in order ids, safety ladder Caution when Jev fails in gate mode.
- `tests/t4.mjs`: request body matches the documented TypeSafe format, hold review, AI view on cards, probe.
- `tests/t5.mjs`: the call log saved per run with state + outcome, `/api/jev` ask for stocks and crypto, passcode.
- `tests/t9.mjs`: a real stock entry with the news question in shadow, gate and off.
- `tests/t16.mjs`: the Catalyst Scenario questions pass the documented format, Jev's answer is used, keywords when Jev is off, your picks override.
- `tests/uijev.mjs`: Jev tab layout.
