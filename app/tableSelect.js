// tableSelect.js: for big schemas, show the model only the tables that look relevant to the question.
//
// A small model given 80+ tables invents tables and columns. This picks the best matches by name, column
// and description words, adds the tables they join to (customerid -> customer), and drops the rest.
// A plain heuristic, not a parser or an embedding model. OFF by default: it only runs when
// SCHEMA_PRUNE_ABOVE=N is set, and then only for schemas with more than N tables (try 20).
// On the AdventureWorks spike it made no clear difference for a 7b model (see docs/adventureworks-spike.md).

const STOP = new Set(`the a an of in on at by for to from with and or is are was were be been how many much what which who whom
whose when where why show list give me us our their there than then that this these those per each every all any total number
count average avg sum most least top first last name names id ids rather more less over under between after before`.split(/\s+/));

const lastPart = (name) => String(name).toLowerCase().split(".").pop();

// "orders" -> "order", "categories" -> "category", "status" stays.
function stem(word) {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us")) return word.slice(0, -1);
  return word;
}

export function questionWords(question) {
  const words = String(question || "").toLowerCase().match(/[a-z][a-z0-9]+/g) || [];
  return [...new Set(words.map(stem).filter((w) => w.length >= 3 && !STOP.has(w)))];
}

// Words inside a snake_case or run-together name: "salesorderheader" matches the word "order" by substring.
const hasWord = (haystack, word) => haystack.includes(word);

export function selectTables(question, schema, knowledge = null, { pruneAbove = Number(process.env.SCHEMA_PRUNE_ABOVE ?? 0), max = Number(process.env.SCHEMA_MAX_TABLES ?? 10) } = {}) {
  const all = Object.keys(schema || {});
  if (!(pruneAbove > 0) || all.length <= pruneAbove) return { schema, tables: all, pruned: false };
  const words = questionWords(question);
  if (words.length === 0) return { schema, tables: all, pruned: false };

  // Description text per table, from the knowledge file ("table", "table.column" and "schema.table" keys).
  const descByTable = new Map();
  for (const [key, text] of Object.entries(knowledge?.descriptions || {})) {
    const parts = key.toLowerCase().split(".");
    for (const t of parts.length === 3 ? [parts[1]] : parts.slice(0, 2)) {
      descByTable.set(t, `${descByTable.get(t) || ""} ${String(text).toLowerCase()}`);
    }
  }

  const scores = new Map();
  for (const table of all) {
    const name = lastPart(table);
    const cols = (schema[table] || []).map((c) => String(c.name).toLowerCase());
    const desc = descByTable.get(name) || "";
    let score = 0;
    for (const w of words) {
      if (name === w) score += 6;
      else if (hasWord(name, w)) score += 4;
      if (cols.some((c) => c === w)) score += 3;
      else if (cols.some((c) => hasWord(c, w))) score += 2;
      if (desc && hasWord(desc, w)) score += 1;
    }
    if (score > 0) scores.set(table, score);
  }
  if (scores.size === 0) return { schema, tables: all, pruned: false };

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  const chosen = ranked.slice(0, Math.max(3, max - 3));

  // Pull in the tables the chosen ones point to: orderheader.customerid -> a table named customer.
  const byName = new Map();
  for (const t of all) { const n = lastPart(t); byName.set(n, [...(byName.get(n) || []), t]); }
  const extra = [];
  for (const table of chosen) {
    for (const c of schema[table] || []) {
      const col = String(c.name).toLowerCase();
      if (!col.endsWith("id") || col.length <= 4) continue;
      const base = col.slice(0, -2);
      const hit = byName.get(base) || all.filter((t) => lastPart(t).endsWith(base) && lastPart(t) !== lastPart(table)).map((t) => [t]).flat().slice(0, 1);
      for (const t of hit) if (!chosen.includes(t) && !extra.includes(t)) extra.push(t);
    }
  }
  // Names of people almost always live in a person table: keep it reachable when the question asks for a name.
  const picked = [...chosen, ...extra].slice(0, max);
  return { schema: Object.fromEntries(picked.map((t) => [t, schema[t]])), tables: picked, pruned: true };
}
