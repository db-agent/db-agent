// ontology/scan.js: how ready is this database for AI questions, and what should a person write down?
//
// Input is metadata only (table and column names, types, comments, declared keys), never table rows.
// Output is a readiness score per table and overall, a list of things a person should fill in, and a
// draft knowledge file built from what the database already says about itself.

const SENSITIVE = /(^|_)(email|e_mail|phone|mobile|ssn|sin|passport|password|passwd|secret|token|birth|birthdate|dob|salary|address|iban|credit_?card|cardnumber|national_?id|tax_?id)(_|$)|(email|phone|password|birthdate|salary|address)$/i;
const CODE_LIKE = /(status|flag|type|code|state|kind|level|class|stage|category)$/i;
const GENERIC = /^(col\d*|column\d*|field\d*|misc|tmp|temp|data|value|val|info|flag\d*|x\d*|y\d*|a\d*|b\d*|attr\d*|var\d*|f\d+)$/i;
const NOISE = /^(rowguid|modifieddate|modified_date|created_at|updated_at|createdat|updatedat|etl_.*|_.*)$/i;
const WIDE_TABLE = 40;

const lastPart = (name) => name.split(".").pop();

// Short names with no vowel are usually abbreviations ("qty" is fine to a human, "cstmr_ref_cd" is not).
function unclearName(name) {
  const n = name.toLowerCase();
  if (GENERIC.test(n)) return true;
  if (n.length <= 2 && n !== "id") return true;
  const words = n.split(/[_\s]+/).filter(Boolean);
  return words.some((w) => w.length >= 3 && !/[aeiouy]/.test(w) && !["qty", "pct", "src", "dst", "ytd", "url", "ssn", "sku", "tbl"].includes(w));
}

export function scanMetadata(meta, { schemaName = null } = {}) {
  const names = Object.keys(meta.tables || {});
  const owners = new Map();
  for (const n of names) owners.set(lastPart(n), (owners.get(lastPart(n)) || 0) + 1);
  // Knowledge keys are "table.column"; two tables with the same name in different schemas keep the schema prefix.
  const keyOf = (n) => (owners.get(lastPart(n)) > 1 ? n : lastPart(n));

  const tables = [];
  const todo = [];
  const draft = { descriptions: {}, expressions: {}, examples: [], instructions: [] };
  const referencedBy = new Map();
  for (const n of names) for (const fk of meta.tables[n].foreignKeys || []) referencedBy.set(fk.refTable, (referencedBy.get(fk.refTable) || 0) + 1);

  for (const name of names) {
    const t = meta.tables[name];
    const cols = t.columns || [];
    const key = keyOf(name);
    const issues = [];
    const described = cols.filter((c) => c.comment).length;
    const meaningful = cols.filter((c) => !NOISE.test(c.name));
    const docShare = cols.length ? described / cols.length : 1;
    const unclear = cols.filter((c) => unclearName(c.name)).map((c) => c.name);
    const sensitive = cols.filter((c) => SENSITIVE.test(c.name)).map((c) => c.name);
    const isView = t.kind === "view";
    const hasPk = isView || cols.some((c) => c.primaryKey); // a view cannot declare a key
    const fks = t.foreignKeys || [];

    let penalty = 40 * (1 - docShare) + (t.comment ? 0 : 5) + 20 * (cols.length ? unclear.length / cols.length : 0);
    if (cols.length > WIDE_TABLE) { penalty += 10; issues.push(`very wide table (${cols.length} columns)`); }
    if (!hasPk) { penalty += 15; issues.push("no primary key declared"); }
    if (described < cols.length) issues.push(`${cols.length - described} of ${cols.length} columns have no description`);
    if (!t.comment) issues.push("table has no description");
    if (unclear.length) issues.push(`unclear column names: ${unclear.slice(0, 6).join(", ")}${unclear.length > 6 ? ", ..." : ""}`);
    if (sensitive.length) issues.push(`looks sensitive, no tag or mask: ${sensitive.join(", ")}`);
    const score = Math.max(0, Math.round(100 - penalty));
    tables.push({ name, key, columns: cols.length, described, hasPk, foreignKeys: fks.length, score, issues, sensitive, rowEstimate: t.rowEstimate ?? null });

    // Draft knowledge: what the database already says, plus where the keys point.
    if (t.comment) draft.descriptions[key] = t.comment;
    const fkByColumn = new Map(fks.map((fk) => [fk.column, fk]));
    for (const c of cols) {
      const parts = [];
      if (c.comment) parts.push(c.comment);
      const fk = fkByColumn.get(c.name);
      if (fk) parts.push(`Joins to ${fk.refTable}.${fk.refColumn}.`);
      if (parts.length) draft.descriptions[`${key}.${c.name}`] = parts.join(" ");
    }

    // Things only a person can supply: what a code means, what a flag counts, which table holds names.
    for (const c of meaningful) {
      if (!c.comment && CODE_LIKE.test(c.name)) {
        todo.push({ kind: "code-meaning", table: key, column: c.name, ask: `What do the values of ${key}.${c.name} mean?` });
      }
    }
    for (const c of sensitive) todo.push({ kind: "sensitive", table: key, column: c, ask: `${key}.${c} looks sensitive. Tag or mask it before wider use.` });
    if (!t.comment && cols.length) todo.push({ kind: "table-description", table: key, column: null, ask: `What is one row of ${key}?` });
  }

  // Join paths a person should check: tables nothing points to and that point to nothing are islands.
  for (const t of tables) {
    const isIsland = t.foreignKeys === 0 && !referencedBy.get(names.find((n) => keyOf(n) === t.key)) && t.columns > 1;
    if (isIsland && names.length > 3) t.issues.push("no declared joins to other tables");
  }

  const overall = tables.length ? Math.round(tables.reduce((s, t) => s + t.score, 0) / tables.length) : 0;
  const totalCols = tables.reduce((s, t) => s + t.columns, 0);
  const totalDescribed = tables.reduce((s, t) => s + t.described, 0);
  const fixes = [...tables].sort((a, b) => a.score - b.score).filter((t) => t.issues.length).slice(0, 10);
  return {
    schema: schemaName,
    summary: {
      tables: tables.length, columns: totalCols,
      describedColumns: totalDescribed, describedShare: totalCols ? Math.round((100 * totalDescribed) / totalCols) : 0,
      foreignKeys: tables.reduce((s, t) => s + t.foreignKeys, 0),
      tablesWithoutPrimaryKey: tables.filter((t) => !t.hasPk).length,
      views: names.filter((n) => meta.tables[n].kind === "view").length,
      sensitiveColumns: tables.reduce((s, t) => s + t.sensitive.length, 0),
      overall,
    },
    tables: tables.sort((a, b) => a.score - b.score),
    fixes,
    todo,
    draft,
  };
}

// Falls back to getSchema() (names and types only) for engines that cannot read comments or keys.
export async function readMetadata(engine) {
  if (typeof engine.getMetadata === "function") return engine.getMetadata();
  const schema = await engine.getSchema();
  const tables = {};
  for (const [name, cols] of Object.entries(schema)) {
    tables[name] = { comment: null, rowEstimate: null, foreignKeys: [], columns: cols.map((c) => ({ name: c.name, type: c.type, comment: null, primaryKey: false })) };
  }
  return { tables };
}

export function renderScanMarkdown(scan) {
  const s = scan.summary;
  const lines = [
    "# Database readiness scan", "",
    `Readiness: **${s.overall} / 100** across ${s.tables} tables and ${s.columns} columns.`,
    `${s.describedShare}% of columns have a description. ${s.foreignKeys} foreign keys declared. ${s.tablesWithoutPrimaryKey} tables without a primary key. ${s.sensitiveColumns} columns look sensitive.`,
    "", "The scan read table and column metadata only. No table rows were read.", "",
    "## Top fixes", "",
  ];
  for (const t of scan.fixes) lines.push(`- **${t.key}** (${t.score}): ${t.issues.join("; ")}`);
  lines.push("", "## Questions only a person can answer", "");
  const byKind = (k) => scan.todo.filter((x) => x.kind === k);
  for (const [kind, title] of [["code-meaning", "What the codes and flags mean"], ["table-description", "What a row of a table is"], ["sensitive", "Sensitive-looking columns"]]) {
    const list = byKind(kind);
    if (!list.length) continue;
    lines.push(`### ${title} (${list.length})`, "");
    for (const x of list.slice(0, 25)) lines.push(`- ${x.ask}`);
    if (list.length > 25) lines.push(`- ... and ${list.length - 25} more`);
    lines.push("");
  }
  return lines.join("\n");
}
