---
name: steward
description: How to manage changes, releases, PRs and the handoff doc in Paper Terminal so nothing goes stale. Use for any change to this repo, at the end of every task before committing, when driving a PR to merge, or when asked to tidy, release or hand off the project.
---

# Steward: managing Paper Terminal

Eli makes many live changes and hands the repo between different assistants, so the main job is keeping every base file
current: nothing stale in docs, comments or config. If docs and code disagree, the code wins and you fix the docs, unless the
code is plainly a bug, which you report (or file as an `audit` issue) instead of quietly changing.

## Every change

1. Read `HANDOFF.md` first, then make the change. Keep the header comment of each file you touch true; they are the per-file docs.
2. **Version.** If anything that deploys changed (anything not listed in `.vercelignore`), bump `VERSION` in `lib/version.js`
   (patch for fixes, minor for features), once per PR, and the "Current version" line in `HANDOFF.md`. Comments that date a
   change use that version, like `// v0.17.2: ...`.
3. **`HANDOFF.md`.** Update every section the change touched (layout, auth, money paths, schedule, storage, settings), "Status
   as of <YYYY-MM-DD>" (what was verified and how, what could not be), "Known drift and open items", and the audit findings table.
4. **`.env.example`.** Every `env('NAME')` the server reads is listed with a one-line note; removed settings are removed. If a
   non-coder must set it, also add it to `README.md`.
5. **New route:** `routes/<name>.js` plus its import and `R` entry in `api/router.js`, with the right auth check first.
   **New client file:** a `<script>` in `index.html`. **New repo-only file or folder:** list it in `.vercelignore`, or Vercel
   serves it publicly.
6. **`README.md`** is for non-coders setting up their own copy. Update it only when setup, settings, costs or what the owner
   sees changed; keep its voice (short steps, no jargon). **`CLAUDE.md`** only when a convention changed.
7. Run `npm run audit`; it must pass. If it fails because a base file is stale, fix the file. If it fails because the code
   broke an invariant, stop and report it. If the change added a route, setting or money rule the audit does not cover, add the
   check to `test/`. Never weaken or skip a test to get green.
8. If the change touches auth, sessions, `lib/trade.js`, order or sizing code, the kill switch, cron or Blob storage, run the
   `adversary-auditor` agent on the diff and fix critical and high findings before merging.

## PRs

- One branch per change. The PR body says what changes for someone using the app (Before / After), then How.
- CI (`.github/workflows/audit.yml`) red is fixed in the PR, never skipped.
- Never set or change Vercel env vars, live keys or `TRADING_MODE` from a PR or an agent; those are Eli's to set by hand.
  Never merge without Eli.

## Periodic audit

Weekly, or after a burst of changes: run `adversary-auditor` with scope "full", file new findings as `audit` issues, close issues
whose fix has merged (and remove their row from `HANDOFF.md`), and refresh "Known drift and open items".
