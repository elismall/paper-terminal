# Handoff: Paper Terminal

Read this first if you are an LLM or a person picking up this repo, then `CLAUDE.md` for the rules. It is the current map of
the code, the rules that keep it safe, and what is open. **Keep it current:** any change to routes, settings, schedules, money
paths or the version updates this file in the same commit. The `steward` skill (`.claude/skills/steward/SKILL.md`) says how,
and `npm run audit` fails if the version below is stale.

**Current version:** 0.20.0 (`lib/version.js`; bump it with every deploy). Owner: Eli (`elismall`).
Repo: https://github.com/elismall/paper-terminal

## What it is
A self-hosted market terminal plus trading bots for US stocks and crypto, run on Alpaca. It trades **paper** (practice money) by
default; real money is possible only through the live gate in `lib/trade.js`. Friends fork it and deploy their own copy on
Vercel (Hobby plan) with their own keys; `README.md` and https://paper-terminal-setup.vercel.app are the non-coder setup guide.
No build step, no npm dependencies, Node 22 (`package.json` engines), ES modules on the server.

## Layout

| Path | What lives there |
|---|---|
| `api/router.js` | The **only** Vercel function. `vercel.json` rewrites `/api/<name>` to it; it dispatches to `routes/<name>.js` (Hobby allows 12 functions). Refuses cross-site POST/DELETE and dispatches only to its own route names. |
| `routes/*.js` | One file per API route, exporting `GET`/`POST`/`DELETE(req)`. New route = new file **and** an entry in the router's imports and `R` map. |
| `lib/*.js` | Shared logic: auth, Alpaca access, bots, research engines, storage, notifications. |
| `js/*.js` | Browser client: plain classic scripts sharing one global scope, loaded in order by `index.html`. New file = new `<script>` tag. |
| `index.html`, `app.css`, `sw.js`, `manifest.webmanifest` | The single-page app shell, styles, service worker (push only, no caching), PWA manifest. |
| `vercel.json` | Security headers (strict CSP: no inline scripts), daily backup crons, the `/api/*` rewrite. |
| `test/` | The adversary audit, `npm run audit` (see below). CI: `.github/workflows/audit.yml` on every PR and push to main. |
| `scripts/dev-server.mjs` | Local server, `npm run dev`. |
| `.claude/agents/adversary-auditor.md` | The adversarial auditor agent (see "Auditing"). |
| `.claude/skills/steward/SKILL.md` | How to manage changes, releases, PRs and this file. |
| `.vercelignore` | Repo-only files the deployed site must not serve (Vercel serves every other file publicly). |

## Auth model (lib/core.js, lib/authguard.js, routes/session.js)
- **Session cookie** `__Host-tb_s` (HttpOnly, Secure, SameSite=Strict; the session inside lasts 7 days, the cookie itself 37 since
  v0.20.0 so an expired device can still prove it was signed in, see Lockout) from `POST /api/session` after the passcode
  (`DASH_PASSCODE`) checks out. HMAC keyed on `DASH_PASSCODE` + `CRON_SECRET`, so changing either signs every device out.
  Routes that touch the account call `authorized(req, { strict: true })`.
- **Market-data key** header `x-tb-gate`: HMAC of today's New York date, handed out only to signed-in devices. Market routes are
  CDN-cached with `Vary: x-tb-gate`. Unlocks market data only (bars, benchmark, brief, crypto, intraday, longterm, macro, news,
  options, quotes, swing, symbols).
- **Cron**: `Authorization: Bearer $CRON_SECRET` (`cronOk`). Used by `/api/tick` and the backup crons.
- **Lockout** (`lib/authguard.js`): 5 wrong passcodes in 15 minutes per hashed IP locks that IP out, doubling up to 24 hours;
  25 in an hour from anywhere locks new sign-ins for an hour, doubling on repeats within a day (max 24 hours). Since v0.20.0 each
  attempt is counted *before* its passcode is checked (parallel guesses can't slip through), and a device holding this site's
  session cookie (valid, or expired up to `GUARD.graceDays` = 30 days ago) is not stopped by the "everyone" lock. Counting is per
  warm instance; other instances see a lock through the Blob CDN copy (up to ~90 s late). A Vercel Firewall rate limit on
  `/api/session` is the outer layer (README suggests it; not set from code).
- **Sign out everywhere** (v0.20.0): `DELETE /api/session?all=1` (signed-in device) saves a cut-off time in
  `control/signout.json`; `sessionOf` rejects sessions issued before it. The router refreshes the cut-off only for requests that
  carry the session cookie, at most every 30 minutes per instance, through the CDN copy (each read costs from the Hobby read
  allowance; a stranger must never be able to spend it). Other instances can lag up to about an hour; changing `CRON_SECRET`
  signs everyone out at once. The first sign-in creates the file (`ensureSignOutFile`), because a missing file is never
  CDN-cached. If Blob is unreadable it keeps the last known value (fail-open on purpose, so a storage hiccup never locks the
  owner out of the kill switch).
- **CSRF**: `api/router.js` refuses cross-site POST/DELETE, and since v0.20.0 also cross-site GETs that carry `run` or `dry`
  (they place trades or run jobs). Cron callers send no Origin / Sec-Fetch-Site and pass.
- **Health** (`/api/health`): strangers get true/false setup flags and the version only; `passStrong`, `botPaused`, `jev`,
  `cryptoSwing`, `trading`, `lastRun` and every probe need a signed-in device.

## Money paths (handle with care)
- **Every order** goes through `call()` in `lib/trade.js`. Paper (`paper-api.alpaca.markets`) unless **all** of
  `TRADING_MODE=live`, `LIVE_CONFIRM=<exact phrase>`, `ALPACA_LIVE_KEY_ID`, `ALPACA_LIVE_SECRET_KEY` and `LIVE_MAX_USD` are set.
  In live mode every buy is checked against `LIVE_MAX_USD` (positions + open buys + this order); short sales, selling options
  to open and order resizes are refused. Since v0.20.0: open market buys count at the live price (an unpriceable one blocks new
  buys), spreads must be 1:1 debit verticals (same stock, expiry, type), sells can't carry bracket/OTO/OCO legs, a price change
  on a resting buy is re-capped (`patchGuard`), and the stock and crypto swing bots size from `min(equity, LIVE_MAX_USD)`. Only
  orders still working count, and only their unfilled part. Live orders and price changes go out one at a time per instance
  (`serial` in `call`), so two buys sent at once cannot both pass on the same numbers. Sells with bracket/OTO legs are refused;
  OCO exits (stop + target, both sells) are allowed.
- **Exit sells** (time exit, breakeven close, DCA hard exit) use `ppostSure`: one retry with the same `client_order_id` after a
  timeout (Alpaca refuses the copy if the first one landed), since the position's stops were already canceled.
- **Duplicate orders** (v0.20.0): runs can overlap (backup cron + 15-minute ticker, or Run now during a tick). Right before every
  new entry (stock, crypto swing, DCA base order, DCA dip buy, bull-run core buy) the bot calls `recentlyOrdered` in
  `lib/trade.js` (Alpaca's own order list for that symbol, last 15-30 minutes) and stands down if a live order with the same id
  prefix exists, or if the check fails. A request that times out is never followed by a "close the whole position" fallback.
- Bots: stock swing (`lib/botcore.js`), crypto swing + protection (`lib/cryptobot.js`, entries off unless `CRYPTO_SWING=on`),
  DCA deals (`lib/dca.js`), the $100 plan (`lib/small.js`).
- Kill switch: `lib/control.js` + `routes/control.js` (pause / resume / emergency stop), plus `BOT_PAUSED=true` in Vercel. Fails
  closed since v0.20.0: an unreadable `control/mode.json` means "no new trades this run" (level 3), the app shows "Can't read",
  and nothing is written over it. A pause (level 4) also cancels the DCA bot's resting dip buys; any block stops new dip buys.
- Manual orders: `routes/order.js` (strict auth, `buildOrder` in `lib/trade.js`).
- Advisory signals that can be switched from shadow to gate (block or skip new trades): `JEV_MODE`, `NEWS_MODE`,
  `LEVERAGE_MODE`. They never place orders themselves.

## Schedule
- `/api/tick` is the heartbeat (`routes/tick.js`; `lib/schedule.js` picks the job by New York time and Alpaca's calendar).
- Free setup (current README): cron-job.org calls `/api/tick?every=15` with the cron header; the tick answers 202 and keeps
  working via `waitUntil`. Vercel Pro can call it every 5 minutes instead.
- `vercel.json` backup crons: daily `/api/tick?every=60&lock=1` at 00:40 UTC (8:40 PM EDT / 7:40 PM EST, after a 7:30 tick has
  finished; `lock=1` takes the real run lock, one Blob write a day), daily `/api/hist` (crypto history), weekly `/api/dcalab`.
- Evening run (7 PM ET, slot `cx`): `saveLastRun` records the New York day it finished in `control/last.json` (`evening`). After
  7 PM the tick reads it (`eveningDone`): done → never twice; not done → only the backup tick catches it up (once per instance per
  day, so a failed save can't repeat it all evening); unreadable → only the usual 7 PM window. The marker is dated by the run's
  start, so a late run can't mark tomorrow as done.

## Storage
Vercel Blob (`BLOB_READ_WRITE_TOKEN`), a **public** store: bot state, ledgers, daily scoreboard (`stats/history.json`), push
subscriptions, lockout state (`control/auth-guard.json`, hashed IPs only), the sign-out cut-off (`control/signout.json`, a time)
and crypto price history (`hist/crypto-*.json`). Anyone who learns the store id can read these (issue #9, open).

Rules since v0.20.0 (`lib/notify.js`):
- `blobGet` (lenient: `null` for missing **or** unreadable) is for showing things only. Anything that saves what it read uses
  `blobGetStrict` (`null` only on a confirmed 404, throws otherwise) or `blobUpdate(path, fn)`, so a storage hiccup can never
  overwrite real data with an empty copy. `lib/hist.js` has its own equivalent (`readFile`).
- Every Blob, Alpaca and push call has a timeout (Blob reads 10 s, writes 20 s, Alpaca data 20 s, orders 15 s, push 10 s).
- Housekeeping: Trade fit / Catalyst records that fall off their capped index are deleted, candidate-ledger and ORB day files past
  their keep window are deleted, and `jev/day/` keeps about 8 days. `fund/<sym>-v1.json` is one file per looked-up symbol,
  overwritten in place (bounded by how many symbols you look up). Grading merges grades into a fresh read of the index by id.

## Settings
All secrets live in Vercel → Settings → Environment Variables, never in the repo or in chat. `.env.example` is the full list
with notes; the audit fails if the server reads a setting it does not list, or it lists one nothing reads. Required:
`ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`, `DASH_PASSCODE`, `CRON_SECRET`, plus `BLOB_READ_WRITE_TOKEN` from a Vercel Blob store.

## Run and check it locally
```
npm run audit      # adversary audit and drift check (no install, no network)
npm run dev        # http://localhost:3000 (scripts/dev-server.mjs; PORT and HOST env vars change where it listens)
```
Export env vars in your shell first (use paper keys). Without keys the UI loads, `/api/health` and `/api/session` answer, and
data routes return friendly "no keys" / "locked" messages. The dev server listens on 127.0.0.1 only and, like production, does
not serve dotfiles or anything in `.vercelignore`.

What `npm run audit` covers:
- `test/auth.test.js`: forged, expired and tampered sessions; the daily key; the cron secret; cross-site refusal; every route
  401 for a stranger with no network call; every non-market route 401 with only the daily key; health leaks nothing; sign-in
  cookie flags; lockout.
- `test/live-guard.test.js`: paper unless every live setting is exact; live cap, short-sale, sell-to-open and resize
  refusals; nothing sent when refused; credit spreads, calendars and sell brackets refused; resting market buys priced; price
  changes on buys re-capped.
- `test/storage.test.js`: strict vs lenient Blob reads; no save after a failed read (scoreboard, push devices); push host
  allowlist; kill switch and run lock fail closed; evening marker.
- `test/hardening.test.js`: parallel guesses, the owner's grace past the everyone-lock, what health tells strangers, cross-site
  `?run=1` GETs, the duplicate-order check, the evening catch-up, sign out everywhere.
- `test/repo.test.js` (drift check): routes wired; every handler has an auth check and POST/DELETE are strict; CSP and headers;
  `index.html` scripts match `js/`; no eval or committed keys; `.env.example` matches the code both ways; the version here
  matches `lib/version.js`; `.vercelignore` covers repo-only files; every file parses.
  Also: README names every setting in `.env.example`, and no export in `lib/` or `routes/` goes unused.
- `test/cryptomarket.test.js`: the Crypto tab's whole-market list (`/api/crypto?all=1`) with Alpaca faked: every tradable USD
  coin once with its name, bar pages followed to the end, no plays, reads only; without keys, the bot's coins and no trading-API call.
- `test/devserver.test.js`: the dev server refuses dotfiles, repo-only files, traversal and bad escapes, and keeps running.

## Outside hosts the server calls
`paper-api.alpaca.markets`, `api.alpaca.markets`, `data.alpaca.markets`, `api.hyperliquid.xyz`, `api.stlouisfed.org`,
`www.federalreserve.gov`, `data.sec.gov`, `efts.sec.gov`, `www.sec.gov`, `www.globenewswire.com`, `www.prnewswire.com`,
`api.typesafe.ai`, and the Vercel Blob API. A sandbox needs these allowed to exercise data routes. The audit needs none of them.

## Auditing
`.claude/agents/adversary-auditor.md` attacks a change or the whole repo. In Claude Code ask: "use the adversary-auditor agent
on <area or diff>". It reads only, reports verified findings with severity, a fix and a guard test, and when asked files each
as a GitHub issue labeled `audit`. Run it on every change to auth, orders, sizing, the kill switch, cron or storage, and weekly
with scope "full".

## Status as of 2026-10-09
- v0.20.0 (PR #18, open, not merged) fixes audit issues #2-#8 and #10-#13 in one change: fail-closed kill switch and run lock,
  strict Blob reads for every read-modify-write, a duplicate-order check before every bot entry, DCA dip buys gated by pause,
  the tighter live cap, the lockout rework and sign out everywhere, quieter `/api/health`, timeouts, the evening catch-up and
  the 00:05 UTC backup cron, push host allowlist, storage cleanup. Also: schedule copy in the app and file headers now says
  "every tick (15 minutes on the free setup)" instead of "every 5 minutes", and the `docs/RESULTS-LOG.md` references are gone.
  `npm run audit` passes (76 tests). The adversary auditor ran on the diff; its 7 findings were fixed with tests (live cap race, filled parents double-counted, OCO exits refused, stranger-triggered Blob reads, cookie too short for the grace bypass, evening marker date and repeats, timed-out exit sells).
- v0.19.0 (PR #17, merged 2026-10-09) adds a search box to the Crypto tab's Market list, and that list is now the whole market: `routes/crypto.js` `?all=1`
  returns every tradable Alpaca `/USD` pair (asset list via `pget`, cached 6 hours per instance; needs keys, else the 14 bot
  coins), with price, 24h/7d/30d change, 24h dollar volume and a 48h sparkline, sorted by volume; CDN cache 60 s. It downloads
  bars for all coins in one paged request per timeframe (`allBars`, paced, max 60 pages or 20 s) instead of one per coin. Each
  instance builds it at most once a minute and shares that with every caller; any query besides `all=1` gets 400 (no
  cache-busting); a failed asset-list read is retried after 5 minutes. A download cut short blanks the coins whose newest bars
  are missing and sets `partial`, so stale numbers never show as current. Swing plays and the 30-second
  board stay on `CRYPTO_UNIVERSE`, so the bot's coins, signals and trading are unchanged. Client: `js/3-trade-bot-crypto.js`
  (`cbBoard`, `cbRow`, `cbLoadAll`, the `#cb-q` box; Enter opens the first match). Any coin can be charted and traded by hand
  from the list, as the order ticket already allowed.
- v0.18.1 (PR #1, merged 2026-10-08) added the audit, CI, the auditor agent, the steward skill, this file, `CLAUDE.md` and the
  dev server; the router dispatches only to its own route names.
- v0.18.0 (PR #16, merged 2026-10-08) added "Plays from the chart" on the Options tab: `lib/patterns.js` (5 chart patterns plus
  how often each worked before on that stock), a straddle/strangle builder in `lib/options.js`, `routes/options.js`
  `strategy=chart` (5-minute per-instance cache) and the `js/3l-chart.js` panel. Ideas only, no order buttons, no bot changes;
  covered by `test/patterns.test.js` and `test/chartplay.test.js`.
- Verified in a Claude cloud session: `npm run audit` passes on Node 22; the router answers without keys.
- Not verifiable there: market data, Blob and bots against real services (no Alpaca keys or Blob token, and the sandbox blocks
  the hosts above). The v0.20.0 storage and order paths are covered by tests with a faked network only.

## Known drift and open items
- v0.19.0 whole-market list: not yet checked against live Alpaca (the cloud sandbox blocks it). Check how many pages the
  multi-coin bar download takes (if it is ~40 per timeframe, the list uses a big share of the 200-a-minute data budget the bots
  share while the Crypto tab is open), whether one tradable coin with no data makes Alpaca reject the whole multi-coin request,
  and the asset name format (" / US Dollar" is stripped). With no `DASH_PASSCODE`, market data is open to anyone, so anyone
  can trigger that download once a minute per instance (the 14-coin board already allowed a smaller version of this).
- **#9 public Blob store** (open, needs Eli): Vercel now offers private Blob stores. Moving means creating a private store in
  Vercel, connecting it to the project, and a code change to read with the token plus a one-time copy of the old files. Not done
  without Eli because it touches his live data and Vercel account.
- **Short passcodes** are still accepted (health shows signed-in devices whether it is 12+ characters). Refusing short ones
  would lock out friends' copies on deploy, so it's Eli's call.
- **Watch after deploy:** each new bot entry now makes one extra Alpaca call (`recentlyOrdered`); a failing check makes the bot
  skip that entry ("did not answer the check"). If that shows up often in the Bot tab, look at Alpaca rate limits.
- The partial-day chart-pattern reads (v0.18.0) have not been checked against live data (needs a session with Alpaca keys).
- `earnFlag` on the options route (v0.18.0 review): decided to leave as is. Earnings dates are public data, the route needs the
  daily market-data key (only signed-in devices get it) and answers are CDN-cached.
- Bot strategy logic (`lib/botcore.js`, `lib/dca.js`, `lib/cryptobot.js`) has no unit tests; the audit covers the money guard
  around it, not the trading decisions (the DCA pause gate in `manage` is untested for the same reason).
- Unverified: `lib/`, `routes/` and `package.json` are not in `.vercelignore`, so Vercel probably serves the server source as
  static files (no secrets in it). Ignoring them would likely break the function bundle; check on a preview deploy first.
- The stranger tests run with Blob off, so a Blob write placed before a route's auth check would not show as a network call
  (one exception: `test/hardening.test.js` checks that strangers never cause Blob reads through the router).
- Left from the v0.20.0 adversarial review (unverified or low odds): `acquireLock` takeover still has a ~100 ms gap between the
  second read and the delete (a real fix is a create-only lock name per time slot); `recentlyOrdered` is check-then-send, so two
  runs within the same second can both pass for one symbol (deterministic ids would close it; stock/crypto ids carry prices);
  lockout counting is per warm instance, so a burst spread over N instances gets about N times the guesses until the Blob copy
  catches up; unknown what status an over-quota or suspended Blob store returns (if 404, the kill switch would read as never
  set); a fork without Blob now makes no new trades (fail-closed, README says so).

### Audit findings (first pass, 2026-10-02; GitHub issues labeled `audit`)

| Issue | Severity | Finding | Status |
|---|---|---|---|
| [#2](https://github.com/elismall/paper-terminal/issues/2) | high | Kill switch fails open when the Blob read fails | fixed in v0.20.0, closes on merge |
| [#3](https://github.com/elismall/paper-terminal/issues/3) | high | One failed Blob read wipes stored history and push devices | fixed in v0.20.0, closes on merge |
| [#4](https://github.com/elismall/paper-terminal/issues/4) | high | Overlapping bot runs can duplicate orders and double the live cap | fixed in v0.20.0, closes on merge |
| [#5](https://github.com/elismall/paper-terminal/issues/5) | high | Passcode lockout can be bypassed with parallel guesses | fixed in v0.20.0, closes on merge |
| [#6](https://github.com/elismall/paper-terminal/issues/6) | medium | DCA dip buys keep firing while paused or in drawdown | fixed in v0.20.0, closes on merge |
| [#7](https://github.com/elismall/paper-terminal/issues/7) | medium | Live cap undercounts and misses some order shapes | fixed in v0.20.0, closes on merge |
| [#8](https://github.com/elismall/paper-terminal/issues/8) | medium | Daily backup cron misses the 7 PM evening run in winter | fixed in v0.20.0, closes on merge |
| [#9](https://github.com/elismall/paper-terminal/issues/9) | medium | Account data and push keys live in a public Blob store | open: needs a private store (Eli) |
| [#10](https://github.com/elismall/paper-terminal/issues/10) | medium | Anyone can lock the owner out of signing in on new devices | fixed in v0.20.0 (devices used before); closes on merge |
| [#11](https://github.com/elismall/paper-terminal/issues/11) | low | Health check tells strangers whether the passcode is weak | fixed in v0.20.0, closes on merge |
| [#12](https://github.com/elismall/paper-terminal/issues/12) | low | Core Alpaca, order and Blob fetches have no timeout | fixed in v0.20.0, closes on merge |
| [#13](https://github.com/elismall/paper-terminal/issues/13) | low | Hardening: sign-out, state-changing GETs, push hosts, storage cleanup | fixed in v0.20.0, closes on merge |

Close the issue and remove its row when the fix merges; when a fix lands, add a test to `test/` so it stays fixed.
