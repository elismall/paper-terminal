# Paper Terminal

Start with `HANDOFF.md`: architecture, auth model, money paths, schedule and open items. It must stay current.

- Follow `.claude/skills/steward/SKILL.md` for every change (version bump, handoff update, `node scripts/check.mjs`).
- Use the `auditor` agent (`.claude/agents/auditor.md`) before merging anything that touches auth, orders, sizing, the kill
  switch, cron or storage.
- No build step and no npm dependencies; plain ES modules on Node 22. Keep it that way unless Eli asks otherwise.
- Never change real-money settings (`TRADING_MODE`, `LIVE_*`, live keys) or place orders against a live account.
