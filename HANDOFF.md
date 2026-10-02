# Handoff: Paper Terminal

Read this first if you are an assistant (or a person) picking up this repo. Keep it current: update it in the same commit as any
change to setup, routes, env vars, or how to run things.

**Current version:** 0.17.1 (`lib/version.js`; bump it with every deploy).

## What it is
A market terminal plus stock and crypto trading bots that run on Alpaca **paper** trading by default. Deployed on Vercel
(Hobby plan). No build step, no npm dependencies, no tests. Node 22 (`package.json` engines), ES modules.

## Layout
- `index.html`, `app.css`, `js/*.js`: front end. Plain classic scripts sharing one global scope, loaded in numeric order.
- `api/router.js`: the only serverless function. `vercel.json` rewrites `/api/<name>` to it; it dispatches to `routes/<name>.js`
  (`GET`/`POST`/`DELETE` exports). Non-GET requests must be same-origin.
- `routes/*.js`: one file per API route. `lib/*.js`: shared logic (Alpaca client, bots, DCA, news, notifications, storage).
- `sw.js`, `manifest.webmanifest`: installable app and push notifications.
- `vercel.json`: security headers (strict CSP), daily crons, the rewrite. Faster bot ticks come from cron-job.org (see README).

## Settings
All secrets live in Vercel → Settings → Environment Variables, never in the repo. The full list with notes is `.env.example`.
Required: `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`, `DASH_PASSCODE`, `CRON_SECRET`, plus `BLOB_READ_WRITE_TOKEN` from a Vercel Blob store.
Live trading only turns on when all five live settings are present.

## Run it locally
```
node scripts/dev-server.mjs        # http://localhost:3000
```
Export env vars in your shell first (use paper keys). Without keys the UI loads, `/api/health` and `/api/session` answer,
and data routes return friendly "no keys" / "locked" messages.

Quick check that every file parses: `for f in api/*.js lib/*.js routes/*.js js/*.js sw.js; do node --check "$f"; done`

## Outside hosts the server calls
`paper-api.alpaca.markets`, `api.alpaca.markets`, `data.alpaca.markets`, `api.hyperliquid.xyz`, `api.stlouisfed.org`,
`www.federalreserve.gov`, `data.sec.gov`, `efts.sec.gov`, `www.sec.gov`, `www.globenewswire.com`, `www.prnewswire.com`,
`api.typesafe.ai`, and the Vercel Blob API. A sandbox needs these allowed to exercise data routes.

## Status as of 2026-10-02
- Verified in a Claude cloud session: all files parse on Node 22; the dev server serves the UI and the router answers
  (`/api/health` 200, `/api/session` 200, `/api/account` 401 locked, unknown route 404). The page renders with no JS errors.
- Not verifiable there: market data and bots, because that sandbox has no Alpaca keys and blocks the hosts above.
