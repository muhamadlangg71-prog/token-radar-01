# Token Radar

A dashboard that finds the DeFi protocols whose token does not exist yet and
ranks them by implied value — what a token would be worth if it launched
today — with a farm plan for each one.

## How it works

`main.ts` (Node 22, standard library only) reads a sealed snapshot of
protocols, scores it with the radar-2 model in `lib/model.ts`, and writes:

- `board.json` — the ranked board
- `data.js` — the dashboard's data, beside the page
- `dashboard/` and `screenshots/` — copies of this repo's page and images
- `dossier.json` — the dossier the kit's library writes from those two

Run it with:

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Without `--input` it reads `/input/snapshot.json`; without
`MAKEFUN_OUTPUT_DIR` it writes to `/output`. It exits non-zero and writes
nothing if the board fails validation.

## The model (radar-2)

A protocol's implied value is:

```
implied = round(TVL × category multiple × growth multiple
                × maturity multiple × chain multiple)
```

- **Category multiple** — what a dollar of TVL is worth in that kind of
  protocol: RWA 0.4, derivatives-style categories 0.35, lending-style
  categories 0.3, DEXs 0.2, everything else 0.25.
- **Growth multiple** — `1 + clamp(change_7d, -60, 120) / 200`, so a
  protocol up 20% in a week scores 1.10 and one down 60% scores 0.70.
- **Maturity multiple** — `min(1, 0.6 + age_days × 0.4 / 1095)`, rising from
  0.6 at listing to 1 after three years. A missing listing date counts as
  365 days.
- **Chain multiple** — `1 + 0.03 × min(chains − 1, 5)`.

The base multiple of 0.25 is recorded in each row's breakdown but is not part
of the product. Multipliers are rounded to four decimals only for display;
the implied value is computed from the unrounded ones.

## Who gets ranked

The kit's watchlist of forty protocols is a floor, never a ceiling: the board
holds all forty plus every other protocol that counts as pre-token — no
market cap, no price-tracker id, no ticker — except exchanges, bridges,
liquid staking and restaking wrappers, a few custodial or private categories,
versioned redeployments (names ending in " V2" / " V3") and staking-vault
listings. On the sealed snapshot that makes 198 rows: 40 watchlist + 158
early. The live side of the dashboard lists the 24 largest launched tokens
by market cap, exchanges set aside, for comparison.

## The farm plan

Every row carries six steps: start from a fresh wallet, open a position
sized by TVL ($150 past $1B, $100 past $100M, $50 below), repeat a small
qualifying action each week, hold for 30 / 45 / 60 days depending on the
protocol's age, then check the right rewards page before claiming anything,
and keep a log. The opening move and the weekly habit are worded per
category — vaults take a deposit, debt protocols mint against collateral,
pools take liquidity, staking takes a stake.

## The dashboard

`dashboard/index.html` with `app.js` and `app.css` renders the board with
search, category and chain filters, a watchlist toggle, sorting, and a live
tab. Clicking a row opens its detail view: why it ranks where it does, a
recompute of its implied value from the snapshot inputs, its farm plan, and
its same-category peers. The page's state lives in the URL hash, so any
filtered view is a link.
