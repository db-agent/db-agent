# AdventureWorks spike: does an ontology help text-to-SQL?

Question: is AdventureWorks (68 tables in 5 schemas) a good demo dataset for the ontology feature, and how much
does a knowledge file change the answers of small local models? Run on 2026-10-30 with Ollama on a laptop.

## Setup

- Data: AdventureWorks 2014 OLTP for Postgres, converted CSVs from
  [NorfolkDataSci/adventure-works-postgres](https://github.com/NorfolkDataSci/adventure-works-postgres)
  (based on [lorint/AdventureWorks-for-Postgres](https://github.com/lorint/AdventureWorks-for-Postgres)).
  111 MB, 31,465 orders, 121,317 order lines, 19,820 customers. The install script carries 463 `COMMENT ON`
  descriptions, so table and column descriptions exist in the database.
- Engine: `PG_SCHEMA=sales,production,person,humanresources,purchasing` (new: several schemas, tables shown as
  `sales.customer`). The schema text is about 4,900 tokens.
- 17 questions with ground-truth SQL (`scripts/adventureworks/cases.json`): 6 easy, 6 medium, 5 hard. A question
  passes when the result set of the generated SQL equals the ground truth.
- Three conditions, no benchmark examples in any of them:
  - **clean**: the schema only.
  - **comments**: the database's own descriptions (427 entries, built by `ontology-from-comments.js`). This is what an
    automatic scan can produce without a person.
  - **curated**: the comments plus what a person adds (`curated-knowledge.json`): how a customer is defined, the join
    path to a product category, a net revenue expression, three rules, three example questions.

## Results (strict pass, one run per cell)

| Model | clean | comments | curated |
|---|---|---|---|
| qwen2.5-coder:1.5b | 5/17 | 4/17 | 8/17 |
| qwen2.5-coder:7b | 7/17 | 8/17 | 14/17 |

On the lenient score (extra columns allowed) the 7b model with the curated ontology gets 15/17.
Average answer time with the 7b model: 6.6 s (clean), 5.2 s (comments), 4.1 s (curated).

## What this says, and what it does not

- Database comments alone changed almost nothing (within noise). What moved the score was the human part:
  join paths, business definitions and rules. That is the case for a review form and not only an automatic scan.
- The 1.5b model fails mostly by inventing tables and columns (`humanresources.employeedepartment`,
  `t1.firstname`) even with the ontology. A prompt that holds 87 tables is too much for it. Choosing the relevant tables
  per question (not built) is the likely fix, and probably matters more than the ontology for small models.
- Weaknesses of this test: 17 questions, one run each, so a difference of one or two questions is noise. The curated
  file defines concepts (net revenue, customer names, category path) that several questions ask about. It
  shows the ceiling of a good ontology, not the gain on questions nobody anticipated. The three examples are not
  eval questions.
- How knowledge is chosen today limits it: a table description is only included when the question contains the
  table's name (`knowledge.js`, `filterByKeywordMatch`). "Orders" does not select `salesorderheader`. Expressions
  and instructions do not have this problem. This needs fixing for the ontology feature.

## Reproduce

```bash
git clone --depth 1 https://github.com/NorfolkDataSci/adventure-works-postgres.git aw
docker run -d --name aw -e POSTGRES_PASSWORD=pw -p 5457:5432 -v "$PWD/aw:/aw:ro" postgres:16
docker exec aw psql -U postgres -c 'CREATE DATABASE adventureworks'
# install.sql reads some CSVs from ./data and some from ./, so link them next to the script
docker exec aw bash -c 'cp -r /aw /work && cd /work && for f in data/*.csv; do ln -sf $f .; done'
docker exec -w /work aw psql -U postgres -d adventureworks -q -f install.sql

cd app
export DB_URL=postgresql://postgres:pw@localhost:5457/adventureworks PG_SSL=false
export PG_SCHEMA=sales,production,person,humanresources,purchasing
node scripts/adventureworks/ontology-from-comments.js /tmp/comments.json
# comments.json plus scripts/adventureworks/curated-knowledge.json (curated wins) is the "curated" file
CASES=scripts/adventureworks/cases.json MODELS=qwen2.5-coder:7b \
  CONDITIONS="clean,kb=/tmp/comments.json,kb=/tmp/curated.json" node scripts/eval-olist-text2sql.js
```

The "curated" file is built by merging: `descriptions` from `comments.json` with those in `curated-knowledge.json`
overriding on the same key, and the other sections copied from `curated-knowledge.json`.
