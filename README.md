# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ads-boto/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ads-boto/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A launch radar for protocols that record no token yet: 176 rows ranked by an implied FDV derived from TVL, seven-day growth, age without a token and chain reach, each with a farm plan, plus a separate view of tokens already trading.

## Run it

```sh
# in the grading sandbox, with the snapshot mounted at /input
node main.ts

# locally, against any snapshot.json
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

The run writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. Open `out/dashboard/index.html` through any static file server to read the board.

The model lives in `lib/model.ts`; the page is `dashboard/index.html`, `dashboard/app.css` and `dashboard/app.js` with no network calls.

---

<sub>Entered on [make.fun](https://make.fun/?ref=jvxh0j4z&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
