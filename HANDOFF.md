# Handoff: Paper Terminal

Read this first if you are an LLM or a person picking up this repo, then `CLAUDE.md` for the rules. It is the current map of
the code, the rules that keep it safe, and what is open. **Keep it current:** any change to routes, settings, schedules, money
paths or the version updates this file in the same commit. The `steward` skill (`.claude/skills/steward/SKILL.md`) says how,
and `npm run audit` fails if the version below is stale.

**Current version:** 0.17.2 (`lib/version.js`; bump it with every deploy). Owner: Eli (`elismall`).
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
- **Session cookie** `__Host-tb_s` (HttpOnly, Secure, SameSite=Strict, 7 days) from `POST /api/session` after the passcode
  (`DASH_PASSCODE`) checks out. HMAC keyed on `DASH_PASSCODE` + `CRON_SECRET`, so changing either signs every device out.
  Routes that touch the account call `authorized(req, { strict: true })`.
- **Market-data key** header `x-tb-gate`: HMAC of today's New York date, handed out only to signed-in devices. Market routes are
  CDN-cached with `Vary: x-tb-gate`. Unlocks market data only (bars, benchmark, brief, crypto, intraday, longterm, macro, news,
  options, quotes, swing, symbols).
- **Cron**: `Authorization: Bearer $CRON_SECRET` (`cronOk`). Used by `/api/tick` and the backup crons.
- **Lockout** (`lib/authguard.js`): 5 wrong passcodes in 15 minutes per hashed IP locks that IP out, doubling up to 24 hours;
  25 in an hour from anywhere locks new sign-ins for an hour.
- **CSRF**: `api/router.js` refuses cross-site POST/DELETE (Sec-Fetch-Site / Origin).

## Money paths (handle with care)
- **Every order** goes through `call()` in `lib/trade.js`. Paper (`paper-api.alpaca.markets`) unless **all** of
  `TRADING_MODE=live`, `LIVE_CONFIRM=<exact phrase>`, `ALPACA_LIVE_KEY_ID`, `ALPACA_LIVE_SECRET_KEY` and `LIVE_MAX_USD` are set.
  In live mode every buy is checked against `LIVE_MAX_USD` (positions + open buys + this order); short sales, selling options
  to open and order resizes are refused.
- Bots: stock swing (`lib/botcore.js`), crypto swing + protection (`lib/cryptobot.js`, entries off unless `CRYPTO_SWING=on`),
  DCA deals (`lib/dca.js`), the $100 plan (`lib/small.js`).
- Kill switch: `lib/control.js` + `routes/control.js` (pause / resume / emergency stop), plus `BOT_PAUSED=true` in Vercel.
- Manual orders: `routes/order.js` (strict auth, `buildOrder` in `lib/trade.js`).
- Advisory signals that can be switched from shadow to gate (block or skip new trades): `JEV_MODE`, `NEWS_MODE`,
  `LEVERAGE_MODE`. They never place orders themselves.

## Schedule
- `/api/tick` is the heartbeat (`routes/tick.js`; `lib/schedule.js` picks the job by New York time and Alpaca's calendar).
- Free setup (current README): cron-job.org calls `/api/tick?every=15` with the cron header; the tick answers 202 and keeps
  working via `waitUntil`. Vercel Pro can call it every 5 minutes instead.
- `vercel.json` backup crons: daily `/api/tick?every=60`, daily `/api/hist` (crypto history), weekly `/api/dcalab`.

## Storage
Vercel Blob (`BLOB_READ_WRITE_TOKEN`), a **public** store: bot state, ledgers, daily scoreboard (`stats/history.json`), push
subscriptions, lockout state (`control/auth-guard.json`, hashed IPs only) and crypto price history (`hist/crypto-*.json`).

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
  refusals; nothing sent when refused.
- `test/repo.test.js` (drift check): routes wired; every handler has an auth check and POST/DELETE are strict; CSP and headers;
  `index.html` scripts match `js/`; no eval or committed keys; `.env.example` matches the code both ways; the version here
  matches `lib/version.js`; `.vercelignore` covers repo-only files; every file parses.
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

## Status as of 2026-10-02
- v0.17.2 adds the audit, CI, the auditor agent, the steward skill, this file, `CLAUDE.md` and the dev server. App changes:
  the router dispatches only to its own route names (`?__p=__proto__` now 404, was 405), and `.env.example` lists six settings
  the server already read. This combines two earlier efforts (PR #1 and PR #14) into one.
- Verified in a Claude cloud session: `npm run audit` passes on Node 22 locally and in CI; the dev server serves the UI and the
  router answers (`/api/health` 200, `/api/account` 401, unknown route 404).
- Not verifiable there: market data and bots, because that sandbox has no Alpaca keys and blocks the hosts above.

## Known drift and open items
- Header comments in `lib/schedule.js` and `routes/tick.js` still describe a Vercel Pro `*/5` cron; `vercel.json` now ships daily
  backups only and the README uses cron-job.org every 15 minutes.
- `lib/history.js` and `lib/season.js` mention `docs/RESULTS-LOG.md`, which is not in the repo.
- Bot strategy logic (`lib/botcore.js`, `lib/dca.js`, `lib/cryptobot.js`) has no unit tests; the audit covers the money guard
  around it, not the trading decisions.
- Unverified: `lib/`, `routes/` and `package.json` are not in `.vercelignore`, so Vercel probably serves the server source as
  static files (no secrets in it). Ignoring them would likely break the function bundle; check on a preview deploy first.
- The stranger tests run with Blob off, so a Blob write placed before a route's auth check would not show as a network call.

### Audit findings (first pass, 2026-10-02; GitHub issues labeled `audit`)

| Issue | Severity | Finding |
|---|---|---|
| [#2](https://github.com/elismall/paper-terminal/issues/2) | high | Kill switch fails open when the Blob read fails |
| [#3](https://github.com/elismall/paper-terminal/issues/3) | high | One failed Blob read wipes stored history and push devices |
| [#4](https://github.com/elismall/paper-terminal/issues/4) | high | Overlapping bot runs can duplicate orders and double the live cap |
| [#5](https://github.com/elismall/paper-terminal/issues/5) | high | Passcode lockout can be bypassed with parallel guesses |
| [#6](https://github.com/elismall/paper-terminal/issues/6) | medium | DCA dip buys keep firing while paused or in drawdown |
| [#7](https://github.com/elismall/paper-terminal/issues/7) | medium | Live cap undercounts and misses some order shapes |
| [#8](https://github.com/elismall/paper-terminal/issues/8) | medium | Daily backup cron misses the 7 PM evening run in winter |
| [#9](https://github.com/elismall/paper-terminal/issues/9) | medium | Account data and push keys live in a public Blob store |
| [#10](https://github.com/elismall/paper-terminal/issues/10) | medium | Anyone can lock the owner out of signing in on new devices |
| [#11](https://github.com/elismall/paper-terminal/issues/11) | low | Health check tells strangers whether the passcode is weak |
| [#12](https://github.com/elismall/paper-terminal/issues/12) | low | Core Alpaca, order and Blob fetches have no timeout |
| [#13](https://github.com/elismall/paper-terminal/issues/13) | low | Hardening: sign-out, state-changing GETs, push hosts, storage cleanup |

Close the issue and remove its row when the fix merges; when a fix lands, add a test to `test/` so it stays fixed.
