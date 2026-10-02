# Paper Terminal: working rules for assistants

Start with `HANDOFF.md` (what this is, layout, how to run it, current status). This file is the rules.

## Every change
- Run `npm run audit` before committing. It must pass. It needs no install and no network.
- Before opening a PR, run the `adversary-auditor` agent (`.claude/agents/adversary-auditor.md`) on the diff and fix what it
  proves. At the end of every task, run the `steward` agent (`.claude/agents/steward.md`) so the version, `HANDOFF.md`,
  `.env.example`, `.vercelignore` and README match the code. The owner makes many live changes; stale docs are a bug.
- One version bump per deploying PR in `lib/version.js`. Comments that date a change use that version (`// v0.17.2: ...`).

## Code
- No npm dependencies and no build step. Node 22, ES modules on the server; classic scripts sharing one global scope in `js/`,
  loaded in the order `index.html` lists them.
- Match the surrounding style: dense one-line helpers, comments that say why and since which version.
- New API route: `routes/<name>.js` exporting `GET`/`POST`/`DELETE`, imported and added to `R` in `api/router.js` (Vercel Hobby
  allows 12 functions, so everything goes through the one router). Check `authorized(req, { strict: true })` first for
  anything that is not public market data; state-changing work is never a GET.
- Orders only through `lib/trade.js` (`ppost`, `pdel`, `ppatch`). Never call `api.alpaca.markets` directly.
- Settings: read with `env('NAME')` from `lib/core.js` and add the name to `.env.example`. Never commit a value.
- The Blob store is public: never write secrets, passcodes or raw IPs to it.
- Repo-only files (tests, scripts, assistant docs, CI) go in `.vercelignore`, or Vercel serves them publicly.

## Never
- Turn on live trading, change `LIVE_PHRASE`, loosen the live guard, the CSP, or a route's auth check without the owner asking.
- Skip or weaken a test in `test/` to make the audit pass.
