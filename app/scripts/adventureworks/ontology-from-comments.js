#!/usr/bin/env node
// Builds a knowledge file from the descriptions already stored in the database (COMMENT ON ...).
// This is what an automatic scan can produce without a human: no join hints, no business terms.
//   DB_URL=postgresql://postgres:pw@localhost:5457/adventureworks node scripts/adventureworks/ontology-from-comments.js out.json
import fs from "node:fs";
import pg from "pg";

const out = process.argv[2];
if (!process.env.DB_URL || !out) { console.error("usage: DB_URL=... node ontology-from-comments.js out.json"); process.exit(2); }
const pool = new pg.Pool({ connectionString: process.env.DB_URL, ssl: process.env.PG_SSL === "false" ? false : undefined });
const { rows } = await pool.query(`
  SELECT n.nspname AS schema, c.relname AS tbl, a.attname AS col,
         CASE WHEN a.attnum = 0 THEN obj_description(c.oid, 'pg_class') ELSE col_description(c.oid, a.attnum) END AS comment
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  WHERE c.relkind IN ('r', 'v') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'`);
const tableComments = await pool.query(`
  SELECT n.nspname AS schema, c.relname AS tbl, obj_description(c.oid, 'pg_class') AS comment
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'v') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'`);

// Keys are "table.column", as in knowledge.json.example. Two schemas with the same table name keep their schema prefix.
const owners = new Map();
for (const r of tableComments.rows) owners.set(r.tbl, (owners.get(r.tbl) || new Set()).add(r.schema));
const name = (r) => (owners.get(r.tbl).size > 1 ? `${r.schema}.${r.tbl}` : r.tbl);
const descriptions = {};
for (const r of tableComments.rows) if (r.comment) descriptions[name(r)] = r.comment;
for (const r of rows) if (r.col && r.comment) descriptions[`${name(r)}.${r.col}`] = r.comment;
fs.writeFileSync(out, JSON.stringify({ descriptions }, null, 2) + "\n");
console.log(`${Object.keys(descriptions).length} descriptions -> ${out}`);
await pool.end();
