# Bakehouse demo runbook

About 12 minutes. Three things to show: what db-agent does, how it connects to Databricks, and what an ontology is worth.

Two db-agent instances run on the same Databricks schema with the same model:

| URL | What it is |
|---|---|
| http://localhost:3001 | db-agent **without** an ontology (empty knowledge file) |
| http://localhost:3002 | db-agent **with** the prepared ontology (46 notes, 4 definitions, 6 rules, 3 examples) |

The data is `main.bakehouse_seed` (made by `scripts/seed-bakehouse.js` from `samples.bakehouse`): 300 customers, 48 franchises,
27 suppliers, 204 reviews and 4,000,000 sales, with **no comments at all**.

## Set up (30 minutes before)

1. **Databricks:** start the SQL warehouse and keep it running for the whole session. A stopped warehouse makes every call
   fail with a generic `400`. `DATABRICKS_HOST`, `DATABRICKS_HTTP_PATH` and `DATABRICKS_TOKEN` must be in `app/.env`
   (or your shell). Use a token you can revoke: it is passed to both containers as an environment variable.
2. **Model:** `ollama pull qwen2.5-coder:7b`, and keep Ollama running. The 7b model needs about 5 GB of memory: close heavy apps.
3. **Ports:** stop anything else using 3001 or 3002: another db-agent, and the AdventureWorks demo
   (`docker compose -f docker-compose.adventureworks.yml down`). Check with `docker ps`: only `dbagent-bakehouse-*` containers should be running.
4. **Start:**
   ```bash
   cd app
   docker compose -f docker-compose.bakehouse.yml up --build -d
   ```
   The first build takes a few minutes. Later starts take seconds.
5. **Check everything:**
   ```bash
   node scripts/bakehouse/preflight.js
   ```
   It checks Ollama, both instances, the Databricks connection, the ontology on each, the 17 benchmark questions, and asks
   each instance one question to warm the model. Fix any `FAIL` before going on. It ends with `Ready.`
6. **Run the accuracy test once**, on 3002: open http://localhost:3002/#ontology/accuracy and click **Run the test**
   (about 5 minutes). Leave the result on screen. The result lives in memory: restarting that container clears it.
7. **Windows:** a browser window for 3001 on the left and one for 3002 on the right. A third tab on
   http://localhost:3001/#ontology (the Ontology screen) is handy. Zoom the browser to 125% for the room.
8. **Fallback:** record a 60-second clip of each part below while everything works.

To redo the demo from the start: `docker compose -f docker-compose.bakehouse.yml up -d --force-recreate agent-plain`
(resets 3001 to no ontology; the accuracy result on 3002 stays).

## Run of show

### 1. What db-agent does (3 minutes, on 3001)

- Ask **"What is the revenue per product?"** Show the SQL it wrote, the rows, and the line under the answer: tokens, the LLM
  cost estimate and the warehouse cost estimate. Two bills, shown separately.
- Type **`! DELETE FROM sales_transactions WHERE 1=1`** into the box (the `!` runs SQL directly). It is refused:
  "Query must start with SELECT or WITH". db-agent only runs read-only SQL.
- Open **Report** (top right): the spend estimates for the session, with the model and the two costs.

### 2. Databricks integration (1 minute)

- The sidebar holds the connection: workspace host, SQL warehouse path, catalog `main`, schema `bakehouse_seed`. db-agent reads
  the schema from Unity Catalog and runs the SQL on your warehouse.
- Say that the same app is deployed to Databricks Apps with labagent (your last segment).

### 3. The ontology (7 minutes)

1. **Without it (3001).** Ask these three, one by one, and point at the SQL and the result:
   - "How many suppliers are approved?" gives `approved = 'Yes'` and **0**.
   - "How many transactions were paid with visa?" gives `paymentMethod = 'Visa'` and **0**.
   - "What is the revenue from female customers?" gives `gender = 'F'` and a **null**.

   The schema says these are text columns. It does not say the values are `'Y'`, lowercase `visa` and `female`.
2. **Scan (3001).** Open **Ontology** and click **Scan database**: readiness 40 out of 100, 0% of columns described,
   a list of codes and flags nobody described, and four sensitive-looking columns. "The database has no comments, so
   the scan has nothing to copy. It drafts what exists and tells you what only a person can write."
3. **Write it (3001).** In **Tables**, pick the table, type one line per column, then **Save for the team**:
   - `sales_suppliers`, column `approved`: `'Y' when the supplier is approved.`
   - `sales_transactions`, column `paymentMethod`: `Card network, lowercase: visa, mastercard or amex.`
   - `sales_customers`, column `gender`: `Lowercase text: female or male.`

   Ask the same three questions again. They now give **27**, **1,332,880** and **35,881,278**. (Rehearsed: all three flip.)
4. **The prepared version (3002).** Ask the same three: right the first time. Open **Ontology**, **Scan database**:
   readiness 72, 78% described, while "database alone" stays at 0%. Show **Definitions** (`revenue` = `SUM(totalPrice)`) and
   **Rules** (the USA / US spelling, never select card numbers).
5. **The numbers (3002, Accuracy test tab, already run).** The same 17 questions, same model, with the schema only and with the
   ontology: see the result on screen. Expand a row to show both SQL statements. Say plainly: 17 questions, one model, and
   the ontology was written by the same person who wrote the questions.
6. **Shared.** The ontology is one file used by every caller, the web app, the API and MCP clients such as Claude. **SKILL.md**
   exports it for agents that write their own SQL.

## Prompt bank (checked against both instances)

These give a different SQL statement and a different answer with and without the ontology (wrong against right).
Use the exact wording: a small rewording can change the SQL.

| Type this | Without | With |
|---|---|---|
| How many suppliers are approved? | `'Yes'`, 0 | `'Y'`, 27 |
| How many transactions were paid with visa? | `'Visa'`, 0 | `'visa'`, 1,332,880 |
| What is the revenue from female customers? | `'F'`, null | `'female'`, 35,881,278 |
| How many male customers are there? | `'Male'`, 0 | `'male'`, 149 |
| How many customers live in the United States? | `'United States'`, 0 | `'USA'`, 99 |
| How many franchises are in the United States? | `'United States'`, 0 | `'US'`, 16 |
| How many American Express payments were there? | `'American Express'`, 0 | `'amex'`, 1,332,466 |

Ask the two United States prompts back to back: customers say `USA`, franchises say `US`. Only the first three are
rehearsed as a live edit on 3001. Prompts that make no difference (good if someone asks whether the ontology changes
everything): how many XXL franchises, the average sale value, the best-selling product, revenue per payment method.
`node scripts/bakehouse/demo-prompts.js` re-runs the whole check against both instances.

## If something goes wrong

| Symptom | Fix |
|---|---|
| Every answer fails with `400` | The warehouse is stopped. Start it in Databricks and ask again. |
| First answer is slow (30 s or more) | Ollama is loading the model. Run `preflight.js` first so it is warm. |
| A live edit does not change the answer | Switch to 3002 and show the same question there: it is the same story. |
| 3001 already has notes from a rehearsal | `up -d --force-recreate agent-plain`, then ask the three questions once to warm it. |
| Accuracy result is gone | The 3002 container was restarted. Run the test again (5 minutes) or show the screenshots. |
| Port in use | `PLAIN_PORT=3101 CURATED_PORT=3102 docker compose -f docker-compose.bakehouse.yml up -d`, and use those ports. |

## What to say about the limits

- 17 questions, one model, a small number of runs. The ontology defines concepts the questions ask about, so it shows what a good
  ontology can do, not a guarantee on questions nobody anticipated.
- The cost guard is relaxed on these two instances. Databricks estimates 4,000,000 rows for a `GROUP BY` that returns 6, so with the
  default limits even "revenue per product" would wait for approval. The approval flow is shown in the gateway demo, not here.
- Answers are slightly different from run to run. The three questions above gave the same wrong answers without the ontology and
  the same right answers with it in every run since notes started reaching the model, but do the rehearsal.
