import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { cancelAbTest, fetchAbCases, fetchAbStatus, startAbTest } from "@/lib/api";
import type { AbArm, AbStatus, AbSummaryArm } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Check, ChevronDown, ChevronRight, Loader2, X } from "lucide-react";

function Card({ title, arm, accent }: { title: string; arm: AbSummaryArm | undefined; accent: string }) {
  return (
    <div className="flex-1 rounded-xl border p-5" style={{ borderTop: `4px solid ${accent}` }}>
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <p className="mt-2 text-5xl font-semibold tabular-nums">{arm && arm.total ? `${arm.percent}%` : "-"}</p>
      <p className="mt-1 text-sm">{arm ? `${arm.pass} of ${arm.total} correct` : ""}</p>
      {arm && arm.total > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {arm.tokens.toLocaleString()} tokens, {(arm.avgMs / 1000).toFixed(1)} s per answer
          {arm.held ? `, ${arm.held} held by the cost guard` : ""}
        </p>
      )}
    </div>
  );
}

function Mark({ arm }: { arm?: AbArm }) {
  if (!arm) return <span className="text-muted-foreground">-</span>;
  if (arm.status === "pass") return <Check className="size-4 text-[var(--brand-azure)]" aria-label="correct" />;
  return <X className="size-4 text-[var(--brand-orange)]" aria-label={arm.status} />;
}

export function AccuracyTest() {
  const [status, setStatus] = useState<AbStatus>({ status: "idle" });
  const [cases, setCases] = useState<{ model: string; total: number; eligible: { id: string; question: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await fetchAbStatus();
      setStatus(s);
      return s;
    } catch (exc) {
      setError((exc as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    fetchAbCases().then(setCases).catch((exc) => setError((exc as Error).message));
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (status.status !== "running") return;
    timer.current = window.setTimeout(() => void refresh(), 1500);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [status, refresh]);

  async function run() {
    setError(null);
    try {
      await startAbTest();
      await refresh();
    } catch (exc) {
      setError((exc as Error).message);
    }
  }

  const running = status.status === "running";
  const summary = status.summary;
  const hasResults = (status.results?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">Does the ontology improve the answers?</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Each benchmark question is answered twice by the same model: once with the schema only, once with the knowledge file.
            Both answers are run and compared with the correct SQL's result. Benchmark examples are left out of both runs, so the
            model never sees the answer.
          </p>
          {cases && (
            <p className="mt-2 text-xs text-muted-foreground">
              Model: <span className="font-mono">{cases.model}</span>. {cases.eligible.length} of {cases.total} benchmark questions fit this
              database.
            </p>
          )}
        </div>
        {running ? (
          <Button variant="outline" onClick={() => void cancelAbTest().then(refresh)}>
            Stop
          </Button>
        ) : (
          <Button onClick={() => void run()} disabled={!cases || cases.eligible.length === 0}>
            {hasResults ? "Run again" : "Run the test"}
          </Button>
        )}
      </div>

      {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {cases && cases.eligible.length === 0 && (
        <p className="text-sm text-muted-foreground">No benchmark question fits this database yet. Add questions with their correct SQL in Benchmarks.</p>
      )}

      {running && (
        <div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-[var(--brand-azure)] transition-all" style={{ width: `${((status.done ?? 0) / (status.total || 1)) * 100}%` }} />
          </div>
          <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {status.done} of {status.total}: {status.current}
          </p>
        </div>
      )}

      {hasResults && (
        <>
          <div className="flex gap-4">
            <Card title="Schema only" arm={summary?.off} accent="var(--muted-foreground)" />
            <Card title="With the ontology" arm={summary?.on} accent="var(--brand-azure)" />
          </div>
          {status.status === "done" && summary && summary.on.total > 0 && (
            <p className="text-sm">
              {summary.on.pass - summary.off.pass >= 0 ? "The ontology added " : "The ontology removed "}
              <b>{Math.abs(summary.on.pass - summary.off.pass)}</b> correct answer{Math.abs(summary.on.pass - summary.off.pass) === 1 ? "" : "s"} out of {summary.on.total}.
              {summary.on.total < 20 && " With under 20 questions, a difference of one or two is within normal run-to-run noise."}
            </p>
          )}
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Question</th>
                  <th className="w-28 px-3 py-2 text-center font-medium">Schema only</th>
                  <th className="w-28 px-3 py-2 text-center font-medium">Ontology</th>
                </tr>
              </thead>
              <tbody>
                {status.results?.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="cursor-pointer border-t hover:bg-muted/30" onClick={() => setOpen(open === r.id ? null : r.id)}>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5">
                          {open === r.id ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                          {r.question}
                        </span>
                        {r.skipped && <span className="ml-2 text-xs text-muted-foreground">({r.skipped})</span>}
                      </td>
                      <td className="px-3 py-2"><div className="flex justify-center"><Mark arm={r.off} /></div></td>
                      <td className="px-3 py-2"><div className="flex justify-center"><Mark arm={r.on} /></div></td>
                    </tr>
                    {open === r.id && (
                      <tr className="border-t bg-muted/20">
                        <td colSpan={3} className="px-3 py-3">
                          <div className="grid gap-3 md:grid-cols-2">
                            {(["off", "on"] as const).map((k) => (
                              <div key={k}>
                                <p className="mb-1 text-xs font-medium text-muted-foreground">{k === "off" ? "Schema only" : "With the ontology"}: {r[k]?.status}</p>
                                <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-background p-2 text-xs">{r[k]?.sql || "(no SQL)"}</pre>
                                {r[k]?.detail && <p className="mt-1 text-xs text-muted-foreground">{r[k]?.detail}</p>}
                              </div>
                            ))}
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">Correct SQL: <span className="font-mono">{r.groundTruthSql}</span></p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
