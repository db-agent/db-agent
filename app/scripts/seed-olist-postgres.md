# Olist-shaped Postgres seed (issue #63: query plan and scan flagging)

The real [Olist](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce) dataset has about
112k `order_items`, too small for any scan to be expensive. `seed-olist-postgres.js` generates the same
seven-table shape (`customers`, `sellers`, `products`, `orders`, `order_items`, `order_payments`,
`order_reviews`) at any scale, on Postgres, Aurora, RDS or Lakebase. The data is synthetic and
deterministic (fixed seed), generated server-side with `generate_series`, so nothing passes through
your machine.

```bash
cd app
SEED_DB_URL=postgresql://admin:pw@host:5432/db \
  SEED_ORDER_ITEMS=15000000 node scripts/seed-olist-postgres.js        # asks you to type "yes"
```

| Command | What it does |
|---|---|
| `seed` (default) | **Drops and recreates** the seven tables, loads data, adds primary keys, runs `ANALYZE` |
| `ensure` | Same as `seed`, but does nothing if `order_items` already has rows (used by `docker compose`) |
| `add-indexes` | Adds the date/state indexes that turn the seq-scan demos into index scans |
| `drop-indexes` | Removes them again |

Safety: `SEED_DB_URL` is required and is deliberately **not** read from `DB_URL` or `.env`, because
`seed` drops tables. It prints the target host and asks for confirmation (`--yes` to skip). Use an
admin role for seeding and a read-only role for the app.

Size (measured, local Postgres 16): 300k `order_items` takes 6 s and ~0.3 GB; 15M takes about 5 minutes
and about 12.8 GB across all tables (`order_items` 3.2 GB, `orders` 2.5 GB, `customers` 2.2 GB,
`order_reviews` 2.2 GB, `order_payments` 2.0 GB). Other tables scale with `order_items`.

## Validating the plan flags

`olist-questions.json` holds 10 vague questions with the SQL a model would typically write, and whether
each should be flagged, with and without the demo indexes. `check-olist-questions.js` plans them
(EXPLAIN only, nothing is executed) and exits 1 on any mismatch:

```bash
DB_URL=postgresql://user:pw@host:5432/db PG_SSL=false node scripts/check-olist-questions.js
node scripts/check-olist-questions.js --actual     # also runs count(*) to compare estimate vs actual
```

Result on **15,000,000 `order_items`** (13.2M orders), local Postgres 16, after `ANALYZE`:

| # | Question | No indexes | With `add-indexes` | Est. rows / actual |
|---|---|---|---|---|
| 1 | show me all sales | seq scan, **flagged** | **flagged** | 15,000,027 / 15,000,000 |
| 2 | list every order | seq scan, **flagged** | **flagged** | 13,157,938 / 13,157,895 |
| 3 | show all customers | seq scan, **flagged** | **flagged** | 13,157,418 / 13,157,895 |
| 4 | show me a few sales (`LIMIT 10`) | not flagged | not flagged | 10 / 10 |
| 5 | one order by id | index scan, not flagged | not flagged | 1 / 1 |
| 6 | what shipped on 30 August 2018 | seq scan, **flagged** | index scan, **not flagged** | 15,598 / 20,545 |
| 7 | customers in Amazonas | seq scan, **flagged** | bitmap scan, **not flagged** | 330,251 / 332,644 |
| 8 | top 10 customers by spend | seq scans, **flagged** | **flagged** | 10 / 10 |
| 9 | average review score by state | seq scans, **flagged** | **flagged** | 12 / 12 |
| 10 | monthly revenue | seq scans, **flagged** | **flagged** | 13,157,938 / 24 |

8 of 10 flagged without indexes, 6 of 10 with. The filtered questions (6, 7) flip when the index exists.
Question 7 with the index is still stopped by the cost guard's `APPROVAL_MAX_ROWS` (330k result rows),
because "not flagged" means the scan is efficient, not that the result is small.

Estimate accuracy: 9 of 10 estimates are within 0.76x to 1.00x. Question 10 is off by about 550,000x:
Postgres cannot estimate the number of groups for `GROUP BY date_trunc(...)` and assumes nearly one per
row. The scan side of that plan (full scans of `orders` and `order_payments`) is correct, so it is still
flagged, but treat the *result* row estimate of expression groupings as unreliable.

## Demo flow

1. Ask "what shipped on 30 August 2018": the plan shows a sequential scan on `order_items` with a warning.
2. `node scripts/seed-olist-postgres.js add-indexes --yes` (or the `docker compose run` form in the app README).
3. Ask again: index scan, no warning, a fraction of the data size.
4. Ask "show me all sales": flagged, and it stops for approval because it exceeds the row limit.
