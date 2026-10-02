# Handoff: Paper Terminal

Read this first if you are an assistant (or a person) picking up this repo, then `CLAUDE.md` for the rules. Keep this file
current: update it in the same commit as any change to setup, routes, settings or how to run things. The `steward` agent
(`.claude/agents/steward.md`) does that, and `npm run audit` fails if the version below is stale.

**Current version:** 0.17.2 (`lib/version.js`; bump it with every deploy).

## What it is
A market terminal plus stock and crypto trading bots that run on Alpaca **paper** trading by default. Each friend runs their
own copy on Vercel (Hobby plan) with their own keys; `README.md` is the non-coder setup guide. No build step, no npm
dependencies. Node 22 (`package.json` engines), ES modules on the server.

## Layout
- `index.html`, `app.css`, `js/*.js`: front end. Plain classic scripts sharing one global scope, loaded in numeric order.
- `api/router.js`: the only serverless function. `vercel.json` rewrites `/api/<name>` to it; it dispatches to `routes/<name>.js`
  (`GET`/`POST`/`DELETE` exports). Non-GET requests must be same-origin.
- `routes/*.js`: one file per API route. `lib/*.js`: shared logic (Alpaca client, bots, DCA, news, notifications, storage).
  Orders all go through `lib/trade.js`, which holds the live-money guard.
- `sw.js`, `manifest.webmanifest`: installable app and push notifications.
- `vercel.json`: security headers (strict CSP), daily crons, the rewrite. Faster bot ticks come from cron-job.org (see README).
- `test/`: the adversary audit (`npm run audit`), also run by `.github/workflows/audit.yml` on every push to main and every PR.
- `scripts/dev-server.mjs`: local server. `.claude/agents/`: the `adversary-auditor` and `steward` agents.
- Repo-only files are listed in `.vercelignore` so the deployed site never serves them.

## Sign-in model (v0.17.0)
`DASH_PASSCODE` → `POST /api/session` sets an HttpOnly `__Host-tb_s` cookie (7 days) that unlocks account routes ("strict");
signed-in pages also get a daily `x-tb-gate` header key that unlocks market data only. Both are HMACs keyed on the passcode
plus `CRON_SECRET`, so changing either signs every device out. 5 wrong passcodes lock that device (`lib/authguard.js`).
Scheduled runs authenticate with `Authorization: Bearer <CRON_SECRET>`.

## Settings
All secrets live in Vercel → Settings → Environment Variables, never in the repo. The full list with notes is `.env.example`
(the audit fails if the server reads a setting it does not list). Required: `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`,
`DASH_PASSCODE`, `CRON_SECRET`, plus `BLOB_READ_WRITE_TOKEN` from a Vercel Blob store. Live trading only turns on when
`TRADING_MODE=live`, the exact `LIVE_CONFIRM` sentence, both live keys and `LIVE_MAX_USD` are all set.

## Run and check it locally
```
npm run audit      # adversary audit: auth, cross-site, live-money guard, headers, repo invariants (no network needed)
npm run dev        # http://localhost:3000 (scripts/dev-server.mjs; PORT and HOST env vars change where it listens)
```
Export env vars in your shell first (use paper keys). Without keys the UI loads, `/api/health` and `/api/session` answer,
and data routes return friendly "no keys" / "locked" messages. The dev server listens on 127.0.0.1 only and, like
production, does not serve dotfiles or anything in `.vercelignore`.

What `npm run audit` covers: `test/auth.test.js` (forged/expired/tampered sessions, the daily key, cron secret, cross-site
refusal, every route 401 for a stranger with no network call, every non-market route 401 with only the daily market-data key, health leaks nothing, sign-in cookie flags, lockout),
`test/live-guard.test.js` (paper unless every live setting is exact; live cap, short-sale, sell-to-open and resize refusals,
nothing sent when refused), `test/repo.test.js` (routes wired, every handler has an auth check and POST/DELETE are strict,
CSP and headers, index.html scripts match `js/`, no eval or committed keys, `.env.example` complete, version matches this
file, `.vercelignore` covers repo-only files, every file parses), `test/devserver.test.js` (the dev server refuses dotfiles,
repo-only files, traversal and bad escapes, and keeps running).

## Outside hosts the server calls
`paper-api.alpaca.markets`, `api.alpaca.markets`, `data.alpaca.markets`, `api.hyperliquid.xyz`, `api.stlouisfed.org`,
`www.federalreserve.gov`, `data.sec.gov`, `efts.sec.gov`, `www.sec.gov`, `www.globenewswire.com`, `www.prnewswire.com`,
`api.typesafe.ai`, and the Vercel Blob API. A sandbox needs these allowed to exercise data routes. The audit needs none of
them: it fakes `fetch` and fails if code reaches the network unexpectedly.

## Status as of 2026-10-02
- v0.17.2 adds the audit, the CI workflow, the two agents, this handoff, `CLAUDE.md` and the dev server. App changes:
  `api/router.js` now only dispatches to its own route names (before, `?__p=__proto__` or `constructor` reached the lookup
  and answered 405; now 404), and `.env.example` lists six settings the server already read (`CRYPTO_SWING`, `JEV_MODE`,
  `JEV_MODEL`, `NEWS_MODE`, `LEVERAGE_MODE`, `VAPID_SUBJECT`).
- Verified in a Claude cloud session: `npm run audit` passes on Node 22; the dev server serves the UI and the router answers
  (`/api/health` 200, `/api/account` 401 locked, unknown route 404) and refuses `/.env.example`, `/.git/config`, `/HANDOFF.md`,
  `/test/...` and `..` paths.
- Not verifiable there: market data and bots, because that sandbox has no Alpaca keys and blocks the hosts above.

## Open threads
- Bot strategy logic (`lib/botcore.js`, `lib/dca.js`, `lib/cryptobot.js`) has no unit tests yet; the audit covers the money
  guard around it, not the trading decisions. Good next additions: sizing and `RULES` limits with fixed bars.
