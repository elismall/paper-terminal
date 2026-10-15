# Eli Terminal (trading-bot)

Personal "mini Bloomberg" market terminal with a paper-trading bot for stocks and crypto, hosted on Vercel.
Paper money only: every trading call goes to Alpaca's paper API.

- Live: https://tb-terminal-five.vercel.app (Vercel sign-in + app passcode)
- Full project notes for people and AI assistants: [HANDOFF.md](HANDOFF.md)
- Original pipeline blueprint: [docs/blueprint.html](docs/blueprint.html)

- Test results and bot results: [docs/TEST-LOG.md](docs/TEST-LOG.md), [docs/RESULTS-LOG.md](docs/RESULTS-LOG.md); tests in [tests/](tests/README.md)
- The AI second opinion (Jev by TypeSafe): [docs/JEV.md](docs/JEV.md)
- Options tab: Catalyst Scenario (type a stock + a scenario: past reactions, swing plan, long calls) and long call / put ideas (v0.13.0); details in HANDOFF.md

No build step. `index.html` + `app.css` + `js/*.js` (classic scripts, loaded in order) are the front end; `api/router.js` is the only serverless
function and dispatches to `routes/`. Secrets live only in Vercel environment variables, never in this repo.
