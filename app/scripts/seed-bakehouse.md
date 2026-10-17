# Bakehouse seed data (issue #63: query plan / full-scan flagging)

`samples.bakehouse` is read-only and only has 3,333 transactions, so no query on it is
expensive. `seed-bakehouse.js` copies it into a writable schema and regenerates
`sales_transactions` at scale with the same columns.

```bash
cd app
node scripts/seed-bakehouse.js                       # 2M rows -> main.bakehouse_seed
SEED_ROWS=15000000 node scripts/seed-bakehouse.js    # full-size run
SEED_TARGET=my_catalog.my_schema node scripts/seed-bakehouse.js
```

Uses `DATABRICKS_HOST`, `DATABRICKS_HTTP_PATH` and `DATABRICKS_TOKEN` from `app/.env`, then
set `DATABRICKS_CATALOG=main` and `DATABRICKS_SCHEMA=bakehouse_seed` to point db-agent at it.
Re-running is safe (`CREATE OR REPLACE`). It also runs `ANALYZE TABLE ... FOR ALL COLUMNS`;
without column stats `EXPLAIN COST` cannot estimate filter selectivity and every filtered
query looks like a full scan.

Data shape: `sales_transactions` spans 2023-01-01 to 2025-12-31, uses the 300 real
customers, 48 franchises, 6 products and the payment methods from the source, with skewed
(squared-uniform) customer, franchise and product frequencies. Card numbers are random.

## Test questions

Flag = expected to be flagged as expensive. `Fix` is the variant that should NOT be flagged.

| # | Question | Flag | Fix |
|---|----------|------|-----|
| 1 | show me all sales | yes | sales from December 2025 |
| 2 | list every transaction | yes | transactions from the last 7 days of 2025 |
| 3 | show all card numbers used | yes | card numbers used by customer X |
| 4 | what are the total sales | no (aggregate, but still a full scan; judge by rule) | |
| 5 | sales with customer details | yes (unfiltered join) | same, for one franchise and month |
| 6 | compare customers | yes | compare top 10 customers by revenue |
| 7 | how many customers are there | no (300 rows) | |
| 8 | list all franchises | no (48 rows) | |
| 9 | revenue by product in December 2025 | no (selective date filter) | |
| 10 | show suppliers that are approved | no (27 rows) | |

Rows 4 and 7-10 are the negative controls. Row 4 is a judgement call: decide whether an
aggregate over a large table counts as a warning and adjust the table to match.
