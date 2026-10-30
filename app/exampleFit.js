// exampleFit.js: does an example query reference only tables and columns that exist in
// the connected schema? Used to keep few-shot examples that were written for a different
// database (the bundled SQLite demo cases in benchmarks.json) out of the prompt: small
// models copy them, hallucinating columns that do not exist.
//
// A cheap, dependency-free heuristic over the SQL text, not a parser. It errs toward
// DROPPING an example it cannot verify (a missing example costs little; a wrong one
// misleads the model). Checked: table names after FROM/JOIN, qualified columns (t.col)
// and bare columns against the tables the query actually references.

const KEYWORDS = new Set(`
select from where group by order having limit offset union intersect except all distinct as on using join inner left
right full outer cross natural and or not in is null like ilike between exists case when then else end asc desc
with over partition rows range unbounded preceding following current row true false filter within interval date
timestamp time cast count sum avg min max coalesce nullif round floor ceil abs upper lower length substr substring
trim extract year month day hour minute second week quarter epoch dow doy isodow lateral values fetch first next only
integer int bigint smallint numeric decimal float double real text varchar char boolean bool
`.split(/\s+/).filter(Boolean));

const CLAUSE_END = new Set(["where", "group", "order", "having", "limit", "offset", "union", "intersect", "except", "window", "qualify"]);
const NOT_ALIAS = new Set(["on", "using", "join", "inner", "left", "right", "full", "outer", "cross", "natural", "lateral", ...CLAUSE_END]);
// FROM inside these functions is part of their syntax, not a table clause.
const FROM_IN_FUNCTION = new Set(["extract", "trim", "substring", "overlay", "position"]);

export function tokenize(sql) {
  const text = String(sql || "")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"([^"]*)"|`([^`]*)`|\[([^\]]*)\]/g, (_m, a, b, c) => a ?? b ?? c);
  return text.match(/[A-Za-z_][A-Za-z0-9_$]*|\d+(?:\.\d+)?|::|[^\sA-Za-z0-9_]/g) || [];
}

const isIdent = (t) => t != null && /^[A-Za-z_]/.test(t);

export function sqlFitsSchema(sql, schema) {
  const known = new Map(); // lowercase table -> Set of lowercase columns, or null (unknown columns, e.g. a CTE)
  for (const [table, cols] of Object.entries(schema || {})) {
    known.set(table.toLowerCase(), new Set(cols.map((c) => String(c.name).toLowerCase())));
  }
  const toks = tokenize(sql);
  if (toks.length === 0) return false;
  const low = toks.map((t) => t.toLowerCase());

  // CTE names: "WITH x AS (" or ", y AS (". Their columns are not known, so they are exempt.
  const ctes = new Set();
  for (let i = 1; i < toks.length - 2; i++) {
    if (isIdent(toks[i]) && low[i + 1] === "as" && low[i + 2] === "(" && (low[i - 1] === "with" || low[i - 1] === ",")) {
      ctes.add(low[i]);
    }
  }

  // Pass 1: table references (with aliases) and output aliases.
  const refs = new Map(); // alias-or-name (lowercase) -> table (lowercase) | null for CTEs
  const tableTokens = new Set(); // token indexes that name a table or an alias being defined
  const outputAliases = new Set();
  const parens = [];
  let inFrom = false;
  let expectTable = false;
  for (let i = 0; i < toks.length; i++) {
    const t = low[i];
    if (t === "(") { parens.push(low[i - 1] || ""); continue; }
    if (t === ")") { parens.pop(); continue; }
    if (t === "as" && isIdent(toks[i + 1])) outputAliases.add(low[i + 1]);
    if (t === "from" && !FROM_IN_FUNCTION.has(parens[parens.length - 1])) { inFrom = true; expectTable = true; continue; }
    if (t === "join") { expectTable = true; continue; }
    if (t === "," && inFrom && parens.length === 0) { expectTable = true; continue; }
    if (inFrom && CLAUSE_END.has(t)) { inFrom = false; expectTable = false; continue; }
    if (!(expectTable && isIdent(toks[i]) && !NOT_ALIAS.has(t))) continue;

    // table name, possibly schema-qualified (a.b.c): the last part is the table
    let j = i;
    while (low[j + 1] === "." && isIdent(toks[j + 2])) j += 2;
    const table = low[j];
    if (!known.has(table) && !ctes.has(table)) return false;
    for (let k = i; k <= j; k++) tableTokens.add(k);
    let alias = table;
    if (low[j + 1] === "as" && isIdent(toks[j + 2])) { alias = low[j + 2]; tableTokens.add(j + 2); j += 2; }
    else if (isIdent(toks[j + 1]) && !NOT_ALIAS.has(low[j + 1]) && !KEYWORDS.has(low[j + 1])) { alias = low[j + 1]; tableTokens.add(j + 1); j += 1; }
    refs.set(alias, ctes.has(table) && !known.has(table) ? null : table);
    refs.set(table, ctes.has(table) && !known.has(table) ? null : table);
    expectTable = false;
    i = j;
  }
  if (refs.size === 0) return false;

  // Pass 2: every column reference must exist in the tables this query uses.
  const hasUnknownCols = [...refs.values()].some((t) => t === null);
  const allCols = new Set();
  for (const t of refs.values()) if (t) for (const c of known.get(t)) allCols.add(c);

  for (let i = 0; i < toks.length; i++) {
    if (!isIdent(toks[i]) || tableTokens.has(i)) continue;
    const t = low[i];
    if (low[i - 1] === ".") continue; // handled with its qualifier
    if (low[i + 1] === "(") continue; // function call
    if (low[i - 1] === "::") continue; // cast target type
    if (low[i + 1] === "." && isIdent(toks[i + 2])) {
      // qualifier.column
      if (!refs.has(t)) { if (known.has(t) || ctes.has(t)) continue; return false; }
      const table = refs.get(t);
      const col = low[i + 2];
      if (table && !known.get(table).has(col)) return false;
      continue;
    }
    if (low[i + 1] === "." && toks[i + 2] === "*") continue;
    if (KEYWORDS.has(t) || refs.has(t) || outputAliases.has(t) || ctes.has(t)) continue;
    if (allCols.has(t)) continue;
    if (hasUnknownCols) continue; // cannot verify against a CTE's columns
    return false;
  }
  return true;
}
