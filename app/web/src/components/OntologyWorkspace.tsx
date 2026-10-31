import { useEffect, useMemo, useState } from "react";
import { fetchOntology, fetchSchema, saveOntology, scanDatabase } from "@/lib/api";
import type { Knowledge, ScanResult, Schema } from "@/lib/types";
import { AccuracyTest } from "@/components/AccuracyTest";
import { Button } from "@/components/ui/button";
import { Download, Loader2, Plus, ScanSearch, Trash2, X } from "lucide-react";

type Tab = "build" | "accuracy";
type Section = "tables" | "definitions" | "rules" | "examples";

const lastPart = (n: string) => n.split(".").pop() ?? n;
const inputCls = "w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-[var(--brand-azure)]";

function ScoreDot({ score }: { score: number }) {
  const color = score >= 75 ? "var(--brand-azure)" : score >= 50 ? "#b7791f" : "var(--brand-orange)";
  return <span className="w-8 shrink-0 text-right text-xs font-medium tabular-nums" style={{ color }}>{score}</span>;
}

function Pairs({
  items, onChange, aLabel, bLabel, bRows = 2, mono = false,
}: {
  items: [string, string][];
  onChange: (next: [string, string][]) => void;
  aLabel: string;
  bLabel: string;
  bRows?: number;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {items.map(([a, b], i) => (
        <div key={i} className="flex gap-2 rounded-lg border p-3">
          <div className="flex flex-1 flex-col gap-2">
            <input className={inputCls} placeholder={aLabel} value={a} onChange={(e) => onChange(items.map((p, j) => (j === i ? [e.target.value, p[1]] : p)))} />
            <textarea className={`${inputCls} ${mono ? "font-mono text-xs" : ""}`} rows={bRows} placeholder={bLabel} value={b} onChange={(e) => onChange(items.map((p, j) => (j === i ? [p[0], e.target.value] : p)))} />
          </div>
          <button type="button" className="self-start text-muted-foreground hover:text-foreground" aria-label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="self-start gap-1.5" onClick={() => onChange([...items, ["", ""]])}>
        <Plus className="size-3.5" /> Add
      </Button>
    </div>
  );
}

export function OntologyWorkspace({ onClose, initialTab = "build" }: { onClose: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [section, setSection] = useState<Section>("tables");
  const [kb, setKb] = useState<Knowledge | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [path, setPath] = useState("");
  const [schema, setSchema] = useState<Schema>({});
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<"scan" | "save" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOntology().then((o) => {
      setKb(o.knowledge);
      setSaved(JSON.stringify(o.knowledge));
      setPath(o.path);
    }).catch((exc) => setError((exc as Error).message));
    fetchSchema().then((s) => {
      setSchema(s);
      setSelected(Object.keys(s)[0] ?? null);
    }).catch(() => {});
  }, []);

  const dirty = kb !== null && JSON.stringify(kb) !== saved;
  const keyOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of scan?.tables ?? []) m.set(t.name, t.key);
    return (name: string) => m.get(name) ?? lastPart(name);
  }, [scan]);
  const scoreOf = useMemo(() => new Map((scan?.tables ?? []).map((t) => [t.name, t.score])), [scan]);
  const todoKeys = useMemo(() => new Set((scan?.todo ?? []).filter((t) => t.kind !== "sensitive" && t.column).map((t) => `${t.table}.${t.column}`)), [scan]);
  const todoTables = useMemo(() => new Set((scan?.todo ?? []).filter((t) => t.kind === "table-description").map((t) => t.table)), [scan]);
  const sensitiveKeys = useMemo(() => new Set((scan?.todo ?? []).filter((t) => t.kind === "sensitive" && t.column).map((t) => `${t.table}.${t.column}`)), [scan]);

  async function runScan() {
    setBusy("scan");
    setError(null);
    setMessage(null);
    try {
      const r = await scanDatabase();
      setScan(r.scan);
      setKb(r.merged);
      setMessage("Scan finished. The comments and keys the database already has were added underneath what you wrote. Review, then save.");
    } catch (exc) {
      setError((exc as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!kb) return;
    setBusy("save");
    setError(null);
    try {
      await saveOntology(kb);
      setSaved(JSON.stringify(kb));
      setMessage("Saved. Every user and tool connected to this db-agent uses it from the next question.");
    } catch (exc) {
      setError((exc as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const setDesc = (key: string, text: string) =>
    setKb((k) => {
      if (!k) return k;
      const d = { ...k.descriptions };
      if (text) d[key] = text; else delete d[key];
      return { ...k, descriptions: d };
    });

  const tableNames = Object.keys(schema);
  const cols = selected ? schema[selected] ?? [] : [];
  const selKey = selected ? keyOf(selected) : "";
  const sections: [Section, string][] = [["tables", "Tables"], ["definitions", "Definitions"], ["rules", "Rules"], ["examples", "Examples"]];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground">
      <header className="flex items-center gap-4 border-b px-6 py-3">
        <h2 className="text-base font-semibold">Ontology</h2>
        <nav className="flex gap-1">
          {([["build", "Build"], ["accuracy", "Accuracy test"]] as [Tab, string][]).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)}
              className={`rounded-md px-3 py-1.5 text-sm ${tab === id ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}>
              {label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {tab === "build" && (
            <>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void runScan()} disabled={busy !== null}>
                {busy === "scan" ? <Loader2 className="size-3.5 animate-spin" /> : <ScanSearch className="size-3.5" />} Scan database
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.open("/api/ontology/export?format=skill")}>
                <Download className="size-3.5" /> SKILL.md
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.open("/api/ontology/export?format=json")}>
                <Download className="size-3.5" /> JSON
              </Button>
              <Button size="sm" onClick={() => void save()} disabled={!dirty || busy !== null}>
                {busy === "save" ? "Saving" : dirty ? "Save for the team" : "Saved"}
              </Button>
            </>
          )}
          <button type="button" onClick={onClose} className="ml-2 text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {tab === "accuracy" ? (
          <div className="mx-auto max-w-5xl px-6 py-6"><AccuracyTest /></div>
        ) : (
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-6">
            <p className="text-sm text-muted-foreground">
              The ontology is one shared file ({path || "knowledge.json"}). It tells the model what your tables mean, how they join and
              how your company defines its terms. Scan reads only table and column metadata, never rows.
            </p>
            {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            {message && <p className="rounded-md border px-3 py-2 text-sm">{message}</p>}

            {scan && (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                {[
                  ["Readiness", `${scan.summary.overall} / 100`],
                  ["Columns described", `${scan.summary.describedShare}%`],
                  ["Declared joins", String(scan.summary.foreignKeys)],
                  ["Tables without a key", String(scan.summary.tablesWithoutPrimaryKey)],
                  ["Sensitive-looking columns", String(scan.summary.sensitiveColumns)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-1 border-b">
              {sections.map(([id, label]) => (
                <button key={id} type="button" onClick={() => setSection(id)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm ${section === id ? "border-[var(--brand-azure)] font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                  {label}
                  {kb && id === "definitions" && ` (${Object.keys(kb.expressions).length})`}
                  {kb && id === "rules" && ` (${kb.instructions.length})`}
                  {kb && id === "examples" && ` (${kb.examples.length})`}
                  {kb && id === "tables" && ` (${Object.keys(kb.descriptions).length} notes)`}
                </button>
              ))}
            </div>

            {kb && section === "tables" && (
              <div className="flex gap-4">
                <ul className="max-h-[60vh] w-72 shrink-0 overflow-y-auto rounded-lg border">
                  {tableNames.map((t) => (
                    <li key={t}>
                      <button type="button" onClick={() => setSelected(t)}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/50 ${selected === t ? "bg-muted font-medium" : ""}`}>
                        <span className="min-w-0 flex-1 truncate">{t}</span>
                        {scoreOf.has(t) && <ScoreDot score={scoreOf.get(t) ?? 0} />}
                      </button>
                    </li>
                  ))}
                  {tableNames.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No tables found.</li>}
                </ul>
                {selected && (
                  <div className="min-w-0 flex-1">
                    <h3 className="font-mono text-sm font-semibold">{selected}</h3>
                    <label className="mt-3 block text-xs text-muted-foreground">
                      What is one row of this table?
                      <textarea className={`${inputCls} mt-1 ${todoTables.has(selKey) && !kb.descriptions[selKey] ? "border-[var(--brand-orange)]" : ""}`} rows={2}
                        value={kb.descriptions[selKey] ?? ""} onChange={(e) => setDesc(selKey, e.target.value)} />
                    </label>
                    <div className="mt-4 flex flex-col gap-1.5">
                      {cols.map((c) => {
                        const k = `${selKey}.${c.name}`;
                        const needs = todoKeys.has(k) && !kb.descriptions[k];
                        return (
                          <div key={c.name} className="flex items-center gap-3">
                            <div className="w-56 shrink-0">
                              <p className="truncate font-mono text-xs">{c.name}</p>
                              <p className="truncate text-[11px] text-muted-foreground">{c.type}{sensitiveKeys.has(k) ? " · sensitive?" : ""}</p>
                            </div>
                            <input className={`${inputCls} ${needs ? "border-[var(--brand-orange)]" : ""}`}
                              placeholder={needs ? "What do the values mean?" : ""}
                              value={kb.descriptions[k] ?? ""} onChange={(e) => setDesc(k, e.target.value)} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {kb && section === "definitions" && (
              <div>
                <p className="mb-3 text-sm text-muted-foreground">Business terms and their SQL, for example <span className="font-mono">revenue</span> = <span className="font-mono">SUM(quantity * price)</span>. Used whenever a question mentions the term.</p>
                <Pairs items={Object.entries(kb.expressions)} aLabel="Term" bLabel="SQL or definition" mono
                  onChange={(next) => setKb({ ...kb, expressions: Object.fromEntries(next) })} />
              </div>
            )}

            {kb && section === "rules" && (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">House rules added to every question, for example "Exclude cancelled orders unless asked."</p>
                {kb.instructions.map((r, i) => (
                  <div key={i} className="flex gap-2">
                    <textarea className={inputCls} rows={2} value={r} onChange={(e) => setKb({ ...kb, instructions: kb.instructions.map((x, j) => (j === i ? e.target.value : x)) })} />
                    <button type="button" className="self-start text-muted-foreground hover:text-foreground" aria-label="Remove" onClick={() => setKb({ ...kb, instructions: kb.instructions.filter((_, j) => j !== i) })}>
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="self-start gap-1.5" onClick={() => setKb({ ...kb, instructions: [...kb.instructions, ""] })}>
                  <Plus className="size-3.5" /> Add
                </Button>
              </div>
            )}

            {kb && section === "examples" && (
              <div>
                <p className="mb-3 text-sm text-muted-foreground">Questions with their correct SQL. The closest ones are shown to the model as worked examples.</p>
                <Pairs items={kb.examples.map((e) => [e.question, e.sql])} aLabel="Question" bLabel="Correct SQL" bRows={4} mono
                  onChange={(next) => setKb({ ...kb, examples: next.map(([question, sql]) => ({ question, sql })) })} />
              </div>
            )}

            {scan && scan.fixes.length > 0 && section === "tables" && (
              <details className="rounded-lg border p-3 text-sm">
                <summary className="cursor-pointer font-medium">Top fixes from the scan</summary>
                <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                  {scan.fixes.map((t) => <li key={t.name}><b className="text-foreground">{t.key}</b> ({t.score}): {t.issues.join("; ")}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
