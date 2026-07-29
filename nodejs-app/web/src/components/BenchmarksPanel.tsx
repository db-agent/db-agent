import { useEffect, useState } from "react";
import { addBenchmark, deleteBenchmark, fetchBenchmarks } from "@/lib/api";
import type { BenchmarkCase } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, X } from "lucide-react";

function sourceBadge(source: BenchmarkCase["source"]) {
  if (source === "seed") return <Badge variant="secondary">seed</Badge>;
  if (source === "feedback") return <Badge variant="outline">from feedback</Badge>;
  return <Badge variant="outline">user</Badge>;
}

function statusBadge(lastRun: BenchmarkCase["lastRun"]) {
  if (!lastRun) return <Badge variant="outline">never run</Badge>;
  if (lastRun.status === "pass") return <Badge variant="secondary">pass</Badge>;
  return <Badge variant="destructive">fail</Badge>;
}

export function BenchmarksPanel({ onClose }: { onClose: () => void }) {
  const [cases, setCases] = useState<BenchmarkCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState("");
  const [groundTruthSql, setGroundTruthSql] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    setLoading(true);
    fetchBenchmarks()
      .then(setCases)
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || !groundTruthSql.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await addBenchmark(question.trim(), groundTruthSql.trim());
      setQuestion("");
      setGroundTruthSql("");
      load();
    } catch (exc) {
      setError((exc as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    await deleteBenchmark(id).catch(() => {});
    load();
  }

  return (
    <aside className="flex h-screen w-96 shrink-0 flex-col overflow-y-auto border-l bg-sidebar px-4 py-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Benchmarks</h2>
          <p className="text-xs text-muted-foreground">
            Question + correct SQL pairs used to check answer quality and to teach the
            assistant your business definitions (e.g. what "best" means).
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Close benchmarks panel"
        >
          <X className="size-4" />
        </button>
      </div>

      <form onSubmit={handleAdd} className="mb-4 flex flex-col gap-2 rounded-lg border p-3">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Question, e.g. Which SKU is best performing?"
          rows={2}
          className="w-full resize-none rounded-md border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground"
        />
        <textarea
          value={groundTruthSql}
          onChange={(e) => setGroundTruthSql(e.target.value)}
          placeholder="Correct SQL for that question (read-only SELECT)"
          rows={3}
          className="w-full resize-none rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-none placeholder:text-muted-foreground"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button type="submit" size="sm" disabled={submitting || !question.trim() || !groundTruthSql.trim()}>
          {submitting ? "Adding…" : "Add benchmark case"}
        </Button>
      </form>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : cases.length === 0 ? (
        <p className="text-xs text-muted-foreground">No benchmark cases yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {cases.map((c) => (
            <div key={c.id} className="rounded-lg border p-2.5 text-xs">
              <div className="mb-1 flex items-start justify-between gap-2">
                <p className="font-medium">{c.question}</p>
                {c.source !== "seed" && (
                  <button
                    type="button"
                    onClick={() => handleDelete(c.id)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label="Delete benchmark case"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
              <code className="mb-1.5 block break-all rounded bg-muted px-1.5 py-1 text-[11px] text-muted-foreground">
                {c.groundTruthSql}
              </code>
              <div className="flex items-center gap-1.5">
                {sourceBadge(c.source)}
                {statusBadge(c.lastRun)}
              </div>
              {c.lastRun?.reason && (
                <p className="mt-1 text-[11px] text-destructive">{c.lastRun.reason}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
