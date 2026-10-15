# docs

Project notes carried over from the original repo, `elismall/trading-bot` (archived; it stopped at v0.13.2 on 2026-09-29).
Repo-only: `.vercelignore` keeps this folder off the deployed site. For the current state of the app, read `HANDOFF.md`.

| File | What it is | Current? |
|---|---|---|
| `RESULTS-LOG.md` | Dated results from DCA training, the lab, the $100 plan and the daily scoreboard. `lib/history.js` and `lib/season.js` point here. New rows: `/api/history` returns them as Markdown in `md`. | Rows end at v0.13.2; add new ones by hand |
| `JEV.md` | Everything about Jev (TypeSafe AI second opinion): questions, policy, scorecard. | Written for v0.12.0; check `lib/jev.js` for changes since |
| `blueprint.html` | The original design blueprint of the terminal. | History |
| `TEST-LOG.md`, `test-runs/` | Test runs from v0.10.0 to v0.13.2, made with the old `tests/run-all.mjs`. | History; the current checks are `npm run audit` (`test/`) |
| `legacy/` | The old repo's `tests/` folder (mock-based scripts for v0.13.x), its `HANDOFF.md` and `README.md`, kept for reference. Not run by anything. | History |
