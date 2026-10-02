# Paper Terminal: handoff

Read this first if you are an LLM or a person picking up this repo. It is the current map of the code, the rules that keep it
safe, and what is open. **Keep it current:** any change to routes, env vars, schedules, money paths or the version updates this
file in the same commit (`node scripts/check.mjs` fails if the version here is stale).

Current version: **v0.17.1** (`lib/version.js`). Owner: Eli (`elismall`). Repo: https://github.com/elismall/paper-terminal

## What it is

A self-hosted market terminal plus trading bots for US stocks and crypto, run on Alpaca. It trades **paper** (practice money) by
default; real money is possible only through the live gate in `lib/trade.js`. Friends fork it and deploy their own copy on
Vercel (setup guide: README.md and https://paper-terminal-setup.vercel.app). No build step, no npm dependencies, Node 22.

## Layout

| Path | What lives there |
|---|---|
| `api/router.js` | The **only** Vercel function. `vercel.json` rewrites `/api/<name>` to it; it dispatches to `routes/<name>.js` (Hobby allows 12 functions). Also enforces the same-site check on every POST/DELETE. |
| `routes/*.js` | One file per API route, exporting `GET`/`POST`/`DELETE(req)`. New route = new file **and** an entry in the router's import list and `R` map. |
| `lib/*.js` | Shared logic: auth, Alpaca access, bots, research engines, storage, notifications. |
| `js/*.js` | Browser client: plain classic scripts sharing one global scope, loaded in order by `index.html`. New file = new `<script>` tag. |
| `index.html`, `app.css`, `sw.js`, `manifest.webmanifest` | The single-page app shell, styles, service worker, PWA manifest. |
| `vercel.json` | Security headers (strict CSP: no inline scripts), daily backup crons, the `/api/*` rewrite. |
| `scripts/check.mjs` | Drift check: syntax, router registry, env docs, client script list, handoff version. |
| `.claude/agents/auditor.md` | The adversarial auditor agent (see "Auditing"). |
| `.claude/skills/steward/SKILL.md` | How to manage changes, releases and PRs in this repo. |

## Auth model (lib/core.js, lib/authguard.js, routes/session.js)

- **Session cookie** `__Host-tb_s` (HttpOnly, Secure, SameSite=Strict, 7 days) from `POST /api/session` after the passcode
  (`DASH_PASSCODE`) checks out. Keyed on `DASH_PASSCODE` + `CRON_SECRET`, so changing either signs every device out.
  Routes that touch the account call `authorized(req, { strict: true })`.
- **Market-data key** header `x-tb-gate`: HMAC of today's New York date, handed out only to signed-in devices. Market routes are
  CDN-cached with `Vary: x-tb-gate`. Unlocks market data only.
- **Cron**: `Authorization: Bearer $CRON_SECRET` (`cronOk`). Used by `/api/tick` and the backup crons.
- **Lockout** (`lib/authguard.js`): 5 wrong passcodes in 15 minutes per hashed IP locks that IP out, doubling up to 24 hours.
- **CSRF**: `api/router.js` refuses cross-site POST/DELETE (Sec-Fetch-Site / Origin).

## Money paths (handle with care)

- **Every order** goes through `call()` in `lib/trade.js`. Paper (`paper-api.alpaca.markets`) unless **all** of
  `TRADING_MODE=live`, `LIVE_CONFIRM=<exact phrase>`, `ALPACA_LIVE_KEY_ID`, `ALPACA_LIVE_SECRET_KEY` and `LIVE_MAX_USD` are set.
  `LIVE_MAX_USD` caps what the bots may have in the market at once.
- Bots: stock swing (`lib/botcore.js`), crypto swing + protection (`lib/cryptobot.js`, entries off unless `CRYPTO_SWING=on`),
  DCA deals (`lib/dca.js`), the $100 real-money plan (`lib/small.js`).
- Kill switch: `lib/control.js` + `routes/control.js` (pause / resume / emergency stop), plus `BOT_PAUSED=true` in Vercel.
- Manual orders: `routes/order.js` (strict auth).
- Advisory signals that can be switched from shadow to gate (block new trades): `JEV_MODE`, `NEWS_MODE`, `LEVERAGE_MODE`.
  They never place orders themselves.

## Schedule

- `/api/tick` is the heartbeat (`routes/tick.js`, `lib/schedule.js` picks the job by New York time and Alpaca's calendar).
- Free setup (current README): cron-job.org calls `/api/tick?every=15` with the cron header; the tick answers 202 and keeps
  working via `waitUntil`. Vercel Pro can call it every 5 minutes instead.
- `vercel.json` backup crons: daily `/api/tick?every=60`, daily `/api/hist` (crypto history), weekly `/api/dcalab`.

## Storage

Vercel Blob (`BLOB_READ_WRITE_TOKEN`): bot state, ledgers, daily scoreboard (`stats/history.json`), push subscriptions, and
crypto price history (`hist/crypto-*.json`, public store, prices only).

## Environment variables

`.env.example` is the source of truth and `scripts/check.mjs` keeps it in sync with the code. Secrets live only in Vercel
project settings, never in the repo or in chat.

## Rules for every change

1. Bump `VERSION` in `lib/version.js` for anything that ships, and update this file's version line plus any section the change
   touched.
2. Run `node scripts/check.mjs` and fix everything it reports.
3. Anything touching auth, `lib/trade.js`, order placement, sizing, the kill switch or storage gets an auditor pass before it
   merges (see below).
4. Keep README.md (written for non-coders) in step with any setup change.
5. Keep the header comment at the top of each file accurate; they are the per-file docs.

## Auditing

`.claude/agents/auditor.md` defines an adversarial auditor. In Claude Code ask: "use the auditor agent on <area or diff>". It
reads only, reports verified findings with severity and a fix, and files each as a GitHub issue labeled `audit`.

## Known drift and open items

- Header comments in `lib/schedule.js`, `routes/tick.js` and some routes still describe a Vercel Pro `*/5` cron; `vercel.json`
  now ships daily backups only and the README uses cron-job.org every 15 minutes.
- `lib/history.js` and `lib/season.js` mention `docs/RESULTS-LOG.md`, which is not in the repo.
- No unit tests or CI yet; `scripts/check.mjs` is the only automated check.

### Audit findings (first pass, 2026-10-02; GitHub issues labeled `audit`)

| Issue | Severity | Finding |
|---|---|---|
| #2 | high | Kill switch fails open when the Blob read fails |
| #3 | high | One failed Blob read wipes stored history and push devices |
| #4 | high | Overlapping bot runs can duplicate orders and double the live cap |
| #5 | high | Passcode lockout can be bypassed with parallel guesses |
| #6 | medium | DCA dip buys keep firing while paused or in drawdown |
| #7 | medium | Live cap undercounts and misses some order shapes |
| #8 | medium | Daily backup cron misses the 7 PM evening run in winter |
| #9 | medium | Account data and push keys live in a public Blob store |
| #10 | medium | Anyone can lock the owner out of signing in on new devices |
| #11 | low | Health check tells strangers whether the passcode is weak |
| #12 | low | Core Alpaca, order and Blob fetches have no timeout |
| #13 | low | Hardening: sign-out, state-changing GETs, push hosts, storage cleanup |

Close the issue and remove its row when the fix merges.
