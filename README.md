# Token Radar — the pre-token launch board

[![bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/yodalef/token-radar-20261126/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/yodalef/token-radar-20261126/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar reads one sealed DefiLlama snapshot (758 protocols, as of 2026-11-14) and ranks the protocols that record no token yet by what a launch would be worth — each with a concrete plan for farming it before a token exists.

The board holds 191 protocols: all 40 on the snapshot's watchlist, plus 151 further pre-token protocols below the watchlist's $50M floor. Protocols that already record a token are never ranked; the 24 largest are shown separately, at their recorded market cap, in the dashboard's "Already launched" view.

## The value model

One function (`impliedValue` in `lib/model.ts`) prices every row from the snapshot's own figures — no protocol is ever priced or ranked by name:

```
implied value = TVL × category multiple × growth factor × age factor × breadth factor
```

- **Category multiple** — what a launched token tends to be worth against its protocol's TVL, by category: Dexs 1.00×, Derivatives 1.05×, Lending 0.85×, CDP 0.80×, Yield 0.60×, bridges 0.45×, anything unlisted 0.62× (the full table is `CATEGORY_MULTIPLE` in `lib/model.ts` and is stated on the dashboard).
- **Growth factor** — the 7-day TVL change, clamped to −50%…+100%, at weight 0.6 (a protocol up 100% in a week is priced at 1.6× its base; one down 50% at 0.7×).
- **Age factor** — the years the protocol has run with no token: 0.72 at listing, rising to 1.00 over five years. A longer track record has had more time to become worth launching.
- **Breadth factor** — +2.5% for each chain past the first, up to six extra chains.

Farm plans are generated per protocol from its own record: its category's core action (supply, provide liquidity, stake, bridge, …), a capital tier set by its TVL, its main chain's gas costs, and a holding window set by its age — six steps each, every step carrying an estimated cost and time.

## Run it

Node 22, standard library only, no install:

```
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

In the grader's container the snapshot is mounted at `/input/snapshot.json` and the output goes to `/output`. The run writes `board.json` (the ranked board), `data.js` (the dashboard's data, generated from the same board), a copy of `dashboard/` and `screenshots/`, and `dossier.json`. The program is deterministic: the same snapshot always writes the same bytes.

Open `out/dashboard/index.html` after placing `out/data.js` beside `out/dashboard/` (the layout the run produces) — the page renders fully offline, with a sortable, filterable board and a detail view per protocol.

## Layout

- `main.ts` — the entry point: snapshot in, board + dashboard data + dossier out.
- `lib/model.ts` — the value model, the coverage rules, the farm-plan generator and the board validator.
- `dashboard/` — the static page (`index.html`, `app.css`, `app.js`); it reads `data.js` and nothing from the network.
- `screenshots/` — the board, a protocol detail view, and a filtered view, rendered from the generated dashboard.
- `vendor/makefun-board.ts` — make.fun's dossier library, vendored unchanged.

Built by an AI agent for a make.fun bounty.
