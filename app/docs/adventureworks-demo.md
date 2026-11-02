# AdventureWorks demo: with and without an ontology

Two db-agent instances on one AdventureWorks Postgres, one model. One instance has no ontology. The other has a
fully curated one. A compare page asks both the same question, side by side.

| URL | What it is |
|---|---|
| http://localhost:3000 | Side by side: the same question to both, scored against the correct SQL |
| http://localhost:3001 | db-agent **without** an ontology. Use it for **Ontology > Scan database** |
| http://localhost:3002 | db-agent **with** the curated ontology |
| localhost:5457 | The Postgres (user `postgres`, password `postgres`; the agents use a read-only role) |

## Start

```bash
ollama pull qwen2.5-coder:7b          # the model the numbers below were measured with
cd app
docker compose -f docker-compose.adventureworks.yml up --build
```

The first start builds the images, downloads AdventureWorks (pinned commit) and loads it: about 2 to 4 minutes.
Later starts take seconds, because the data is in a volume. Ollama runs on the host; the containers reach it at
`host.docker.internal`. To use another OpenAI-compatible endpoint: `DEMO_LLM_BASE_URL`, `DEMO_LLM_API_KEY`,
`DEMO_LLM_MODEL`. If a port is taken: `COMPARE_PORT`, `PLAIN_PORT`, `CURATED_PORT`, `AW_DB_PORT`.

Warm the model before you go on stage: ask one question on the compare page first, so Ollama has loaded it. Both sides share one Ollama, so a pair of answers takes about as long as two (roughly 10 to 40 s per pair with the 7b model on a laptop). `http://localhost:3000/?q=your+question` asks straight away.

## What each instance has

- **Both:** the AdventureWorks schemas (`humanresources`, `person`, `production`, `purchasing`, `sales`), the same model,
  and the 17 benchmark questions loaded (Benchmarks panel).
- **Without (3001):** no knowledge file. Schema only.
- **With (3002):** the database's own 427 comments, plus the hand-written part: how a customer is defined, the join path
  to a product category, net revenue, rules, and three example questions
  (`scripts/adventureworks/curated-knowledge.json`).

## Run of show

1. **Compare page, schema-only versus curated.** Pick a prepared question or click **Run all prepared questions**.
   Each side shows its SQL, its rows, tokens and time, and whether it matches the correct answer. The tally at the top
   counts correct answers. Measured on this setup with qwen2.5-coder:7b: about 7 of 17 without, 14 of 17 with. Expect
   a few questions of difference either way: it is a small set and the model is not perfectly repeatable.
2. **Build it live on 3001.** Ontology, **Scan database**. Show the readiness score and the orange boxes (codes with no
   description). Add a definition (Definitions: `revenue` = `SUM(orderqty * unitprice * (1 - unitpricediscount))`
   over `sales.salesorderdetail`) and a rule, then **Save for the team**. Ask the revenue question on the compare page
   again: the left side now follows the definition.
3. **Show it is shared.** On 3001, the Accuracy tab runs the same questions with and without the file, in one instance.
4. **Export.** The **SKILL.md** button gives the same ontology as a skill file for agents that write their own SQL.
5. **Reset.** `docker compose -f docker-compose.adventureworks.yml up -d --force-recreate agent-plain` puts 3001
   back to no ontology.

## Limits to say out loud

- 17 questions, one model, one run: it shows what a good ontology can do, not a guarantee. The curated file defines
  concepts several of the questions ask about.
- The scan drafts only what the database already says (comments and declared joins). What a status code means, or how
  your company defines revenue, a person has to write.
- Everything inside the containers resets when you recreate them, except the database volume.

## Stop and clean up

```bash
docker compose -f docker-compose.adventureworks.yml down        # keeps the loaded data
docker compose -f docker-compose.adventureworks.yml down -v     # also deletes it
```

## Databricks at the end

Deploying this app on Databricks Apps with labagent is covered in the README ("Databricks Apps") and the labagent
repo, not in this compose file. The Databricks engine reads one catalog and one schema; AdventureWorks is a Postgres
demo here, so show the deployed app against your own Databricks tables.
