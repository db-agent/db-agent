# Ontology: scan, edit, share, test

An ontology here is one shared file, `knowledge.json`. It tells the model what your tables mean, how they join and
how your company defines its terms (revenue, active customer, what status 5 means). Every caller reads it on the next
question: the web app, the HTTP API and every MCP client. Write it once, not once per tool.

## Try it in 5 minutes

```bash
cd app
cp .env.example .env            # SQL_ENGINE=sqlite uses the bundled demo database
LLM_MODEL=qwen2.5-coder:7b node server.js
```

1. Open http://localhost:3001 and click **Ontology**.
2. Click **Scan database**. It reads table and column names, types, comments and declared keys. It never reads rows.
   You get a readiness score, and a draft: the comments and joins the database already has.
3. Under **Tables**, orange boxes are columns that look like codes or flags with no description (`status`, `type`).
   Write what the values mean. Add a one-line description of each table.
4. Under **Definitions**, write your terms as SQL: `revenue` = `SUM(quantity * price)`. Under **Rules**, house rules.
5. **Save for the team**. The next question, from any tool, uses it.
6. Open **Accuracy test** and click **Run the test**. Each benchmark question is answered once with the schema only
   and once with the ontology, and the result of each answer is compared with the correct SQL's result.

The same thing from the command line:

```bash
node bin/db-agent.js scan                            # report and knowledge.draft.json in ./db-agent-scan
node bin/db-agent.js knowledge export --format skill --out SKILL.md
```

## What the scan checks

Per table, 0 to 100: share of columns with a description (the biggest weight), a table description, unclear column
names (`col1`, `flag`, no vowels), very wide tables (over 40 columns) and a missing primary key (views are exempt).
It also lists sensitive-looking columns (email, phone, birth date, salary, address) and codes or flags nobody described.
It reads comments from Postgres and Databricks (SQLite has none), and declared primary and foreign keys where the
database has them.

The scan only drafts what the database already says. What a status code means, or how your company defines revenue,
is not in the metadata. A person has to write it, and that is the part that moved accuracy in our test.

## The accuracy test

Needs benchmark questions: a question plus its correct SQL (Benchmarks panel, or
`node scripts/adventureworks/import-cases.js` for the AdventureWorks set). Questions whose SQL names tables this
database does not have are left out. Benchmark examples are removed from both runs so the model never sees the answer.
A query the cost guard holds for approval counts as not passed and is not run. With fewer than about 20 questions,
a difference of one or two is run-to-run noise.

## Sharing it with agents that write their own SQL

`SKILL.md` (button in the Ontology screen, or `knowledge export --format skill`) is the same ontology as a skill file
for an agent that writes SQL itself and does not call db-agent's `ask`. Agents that call `ask` do not need it:
db-agent adds the ontology to the prompt for them. `run_sql` over MCP does not apply it.

## Files

- `ontology/scan.js`: scoring and the draft. `ontology/knowledgeFile.js`: validate, save (with a `.bak-<time>` backup), merge, skill export.
- `abTest.js`: the accuracy test. `resultCompare.js`: how two results are compared.
- API: `GET/PUT /api/ontology`, `POST /api/ontology/scan`, `GET /api/ontology/export?format=skill|json`,
  `GET /api/ab/cases`, `POST /api/ab/start`, `GET /api/ab/status`, `POST /api/ab/cancel`.

## Measured on AdventureWorks (qwen2.5-coder:7b, 17 questions)

Run through the app's own flow: scan, save, run the accuracy test, add human-written definitions, run it again.

| Step | Schema only | With the ontology |
|---|---|---|
| After the scan alone (comments and declared joins) | 7/17 | 8/17 |
| After adding definitions, join paths and rules by hand | 7/17 | 14/17 |

The ontology answers also used fewer tokens in total (111k against 154k), because the model needed fewer repair
attempts. One run each, 17 questions, and the hand-written file defines concepts several questions ask about, so
read it as what a good ontology can do, not as the gain on questions nobody anticipated. The scan found 89 tables and
views, 50% of columns described, 93 declared joins and 12 sensitive-looking columns. Load the data with
`scripts/adventureworks/load.sh` (see `docs/adventureworks-spike.md` when that page is merged).
