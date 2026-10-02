---
name: steward
description: How to manage changes, releases, PRs and the handoff doc in Paper Terminal. Use for any change to this repo, when driving a PR to merge, or when asked to tidy, release or hand off the project.
---

# Steward: managing Paper Terminal

Eli makes many live changes, so the main job is keeping every base file current: nothing stale in docs, comments or config.

## Every change

1. Read `HANDOFF.md` first.
2. Make the change. Update the header comment of each file you touch so it stays true.
3. If it ships: bump `VERSION` in `lib/version.js` (patch for fixes, minor for features) and the version line in `HANDOFF.md`.
4. Update `HANDOFF.md` sections the change affects (routes, env vars, schedule, money paths, known drift).
5. New env var: add it to `.env.example` with a one-line comment; if a non-coder must set it, also to README.md.
6. New route: `routes/<name>.js` plus the import and `R` entry in `api/router.js`. New client file: a `<script>` in `index.html`.
7. Run `node scripts/check.mjs`; it must print `check: ok`.
8. If the change touches auth, sessions, `lib/trade.js`, any order or sizing code, the kill switch, cron or Blob storage, run
   the `auditor` agent on the diff and fix critical and high findings before merging.

## PRs

- Branch per change; the PR body says what changes for someone using the app (Before / After), then How.
- CI red or a check failure is fixed in the PR, never skipped.
- Never set or change Vercel env vars, live keys, or `TRADING_MODE` from a PR or an agent; those are Eli's to set by hand.

## Periodic audit

Weekly (or after a burst of changes): run the `auditor` agent with scope "full", file new findings as `audit` issues, close
issues whose fix has merged, and refresh the "Known drift and open items" section of `HANDOFF.md`.
