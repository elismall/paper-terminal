# Paper Terminal: working rules for assistants

Start with `HANDOFF.md`: architecture, auth model, money paths, schedule, open items. It must stay current.

## Every change
- Follow the `steward` skill (`.claude/skills/steward/SKILL.md`): version bump, handoff update, `.env.example`, `.vercelignore`.
  The owner makes many live changes; stale docs are a bug.
- Run `npm run audit` before committing. It must pass. It needs no install and no network; CI runs it on every PR.
- Run the `adversary-auditor` agent (`.claude/agents/adversary-auditor.md`) on the diff before merging anything that touches
  auth, orders, sizing, the kill switch, cron or storage, and fix what it proves.

## Code
- No npm dependencies and no build step. Node 22, ES modules on the server; classic scripts sharing one global scope in `js/`,
  loaded in the order `index.html` lists them. Keep it that way unless Eli asks otherwise.
- Match the surrounding style: dense one-line helpers, comments that say why and since which version.
- New API route: `routes/<name>.js` exporting `GET`/`POST`/`DELETE`, imported and added to `R` in `api/router.js` (Vercel Hobby
  allows 12 functions, so everything goes through the one router). Check `authorized(req, { strict: true })` first for
  anything that is not public market data; state-changing work is never a GET.
- Orders only through `lib/trade.js` (`ppost`, `pdel`, `ppatch`). Never call `api.alpaca.markets` directly.
- Settings: read with `env('NAME')` from `lib/core.js` and add the name to `.env.example`. Never commit a value.
- The Blob store is public: never write secrets, passcodes or raw IPs to it.

## Never
- Change real-money settings (`TRADING_MODE`, `LIVE_*`, live keys), place orders against a live account, or loosen the live
  guard, the CSP or a route's auth check without Eli asking.
- Skip or weaken a test in `test/` to make the audit pass.
