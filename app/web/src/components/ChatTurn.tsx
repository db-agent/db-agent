import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { exportCsv, sendFeedback } from "@/lib/api";
import type { QueryAnalysis, Turn } from "@/lib/types";
import { Check, CheckCircle2, Download, Loader2, ThumbsDown, ThumbsUp, Wrench, X, XCircle } from "lucide-react";

function formatBytes(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function formatUsd(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toPrecision(2)}`;
}

function CostPanel({ cost }: { cost: NonNullable<QueryAnalysis["cost"]> }) {
  if (cost.error) {
    return (
      <p className="text-xs text-muted-foreground">Cost estimate unavailable: {cost.error}</p>
    );
  }
  const secs = ((cost.durationMs ?? 0) / 1000).toFixed(1);
  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        Estimated compute cost
      </div>
      <div className="mt-1 text-lg font-semibold">
        ~{formatUsd(cost.usd ?? 0)}{" "}
        <span className="text-xs font-normal text-muted-foreground">
          (range {formatUsd(cost.usdLow ?? 0)} to {formatUsd(cost.usdHigh ?? 0)}, {cost.confidence} confidence)
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        About {secs}s on a {cost.warehouseType?.toLowerCase()} {cost.warehouseSize?.replace("_", "-")} warehouse
        ({cost.dbuPerHour} DBU/h at ${cost.pricePerDbu}/DBU), scanning ~
        {Math.round(cost.scanRows ?? 0).toLocaleString()} rows. Based on {cost.historySamples} similar past
        queries from <code>system.query.history</code>. This is the query&apos;s share of warehouse
        time, not the bill: serverless also bills startup and idle time.
      </p>
      {cost.notes?.map((n) => (
        <p key={n} className="mt-1 text-xs text-amber-600 dark:text-amber-500">
          {n}
        </p>
      ))}
    </div>
  );
}

function QueryAnalysisPanel({ analysis }: { analysis: QueryAnalysis }) {
  if (analysis.error) {
    return (
      <p className="text-sm text-muted-foreground">
        EXPLAIN COST unavailable — {analysis.error}
      </p>
    );
  }

  const sizeText = analysis.sizeLabel || formatBytes(analysis.sizeInBytes ?? null) || "n/a";
  const rowsText =
    analysis.rowCount != null && Number.isFinite(analysis.rowCount)
      ? analysis.rowCount.toLocaleString(undefined, { maximumFractionDigits: 0 })
      : "n/a";

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-md bg-muted p-3">
          <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            Estimated data size
          </div>
          <div className="mt-1 font-medium">{sizeText}</div>
        </div>
        <div className="rounded-md bg-muted p-3">
          <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            Estimated rows
          </div>
          <div className="mt-1 font-medium">{rowsText}</div>
        </div>
      </div>
      {analysis.cost && <CostPanel cost={analysis.cost} />}
      <p className="text-[11px] text-muted-foreground">
        From Databricks <code>EXPLAIN COST</code> (optimizer estimates; not billed usage).
      </p>
      {analysis.rawPlan && (
        <details>
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            Raw EXPLAIN plan
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
            {analysis.rawPlan}
          </pre>
        </details>
      )}
    </div>
  );
}

function FeedbackButtons({ question, sql }: { question: string; sql: string | null }) {
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);

  async function submit(r: "up" | "down", c?: string) {
    setRating(r);
    setSubmitted(true);
    await sendFeedback({ question, sql, rating: r, comment: c });
  }

  function handleDown() {
    if (submitted) return;
    setShowComment(true);
  }

  if (submitted) {
    return (
      <p className="text-xs text-muted-foreground">
        Thanks for the feedback{rating === "down" ? " — noted for review" : ""}.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => submit("up")}
          title="Good answer"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ThumbsUp className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={handleDown}
          title="Bad answer"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ThumbsDown className="size-3.5" />
        </button>
      </div>
      {showComment && (
        <div className="flex items-center gap-2">
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What went wrong? (optional)"
            className="flex-1 rounded-md border bg-background px-2 py-1 text-xs outline-none"
          />
          <Button type="button" size="sm" className="h-7 text-xs" onClick={() => submit("down", comment)}>
            Submit
          </Button>
        </div>
      )}
    </div>
  );
}

function UserBubble({ question }: { question: string }) {
  return (
    <div className="mb-3 flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
        {question}
      </div>
    </div>
  );
}

function ResultTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Query executed successfully — no rows returned.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c}>{c}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {columns.map((c) => (
                <TableCell key={c}>{String(row[c])}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ChatTurn({
  turn,
  onAccept,
  onReject,
}: {
  turn: Turn;
  onAccept?: (turnId: string) => Promise<void>;
  onReject?: (turnId: string) => void;
}) {
  const { question, output } = turn;
  const [executing, setExecuting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportDone, setExportDone] = useState<string | null>(null);
  const awaiting =
    output != null &&
    output.sql != null &&
    output.validation?.isSafe !== false &&
    output.status === "awaiting_approval";

  const defaultTab = awaiting && output?.analysis != null ? "analysis" : "sql";

  async function handleAccept() {
    if (!onAccept || executing) return;
    setExecuting(true);
    try {
      await onAccept(turn.id);
    } finally {
      setExecuting(false);
    }
  }

  async function handleExport() {
    if (!output?.sql || exporting) return;
    setExporting(true);
    setExportError(null);
    setExportDone(null);
    try {
      const { name, bytes } = await exportCsv(output.sql);
      setExportDone(`Downloaded ${name} (${(bytes / 1024).toFixed(bytes < 1024 * 100 ? 1 : 0)} KB). If it contains only the header row, the query returned no rows.`);
    } catch (exc) {
      setExportError(String((exc as Error).message ?? exc));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mb-6">
      <UserBubble question={question} />

      <Card className="rounded-2xl rounded-tl-sm py-4">
        <CardContent className="px-4">
          {output === null && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Generating SQL …
            </div>
          )}

          {output?.error && (!output.sql || !awaiting) && (
            <div className="flex items-start gap-2 text-sm">
              <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div>
                <span className="font-medium text-destructive">Error</span>
                {" — "}
                {output.error}
              </div>
            </div>
          )}

          {output && output.sql !== null && (
            <div className="flex flex-col gap-3">
              {output.repairAttempts > 0 && (
                <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-500">
                  <Wrench className="size-3.5" />
                  SQL auto-corrected after {output.repairAttempts} failed attempt
                  {output.repairAttempts !== 1 ? "s" : ""}
                </div>
              )}

              <Tabs defaultValue={defaultTab} key={`${turn.id}-${defaultTab}`}>
                <TabsList>
                  <TabsTrigger value="sql">Generated SQL</TabsTrigger>
                  <TabsTrigger value="explain">Explanation</TabsTrigger>
                  {(output.analysis != null || awaiting) && (
                    <TabsTrigger value="analysis">Query analysis</TabsTrigger>
                  )}
                  <TabsTrigger value="schema">Schema context</TabsTrigger>
                </TabsList>
                <TabsContent value="sql">
                  <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                    {output.sql || "(empty)"}
                  </pre>
                </TabsContent>
                <TabsContent value="explain">
                  <p className="text-sm">{output.explanation}</p>
                </TabsContent>
                {(output.analysis != null || awaiting) && (
                  <TabsContent value="analysis">
                    {output.analysis != null ? (
                      <QueryAnalysisPanel analysis={output.analysis} />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No EXPLAIN COST available for this engine. Review the generated SQL, then
                        accept to run it.
                      </p>
                    )}
                  </TabsContent>
                )}
                <TabsContent value="schema">
                  <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                    {output.schemaContext}
                  </pre>
                </TabsContent>
              </Tabs>

              {output.validation && (
                <Badge
                  variant={output.validation.isSafe ? "default" : "destructive"}
                  className="w-fit gap-1"
                >
                  {output.validation.isSafe ? (
                    <CheckCircle2 className="size-3" />
                  ) : (
                    <XCircle className="size-3" />
                  )}
                  {output.validation.isSafe ? "Safety check passed" : "Safety check failed"}
                  {" — "}
                  {output.validation.reason}
                </Badge>
              )}

              {awaiting && output.validation?.isSafe && (
                <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
                  {output.error && (
                    <div className="flex items-start gap-2 text-sm text-destructive">
                      <XCircle className="mt-0.5 size-4 shrink-0" />
                      <span>Execution failed — {output.error}</span>
                    </div>
                  )}
                  {output.approvalReason && (
                    <p className="text-sm font-medium text-amber-600 dark:text-amber-500">
                      {output.approvalReason}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Approve to run it and show the rows here, decline to discard it, or export every row to a CSV file without displaying them.
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 gap-1.5"
                      disabled={executing || exporting}
                      onClick={handleAccept}
                      title="Approve and run query"
                    >
                      {executing ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Check className="size-4" />
                      )}
                      {executing ? "Running…" : "Approve"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5"
                      disabled={executing || exporting}
                      onClick={() => onReject?.(turn.id)}
                      title="Decline and discard this query"
                    >
                      <X className="size-4" />
                      Decline
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5"
                      disabled={executing || exporting}
                      onClick={handleExport}
                      title="Run the query and download all rows as a CSV file"
                    >
                      {exporting ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Download className="size-4" />
                      )}
                      {exporting ? "Exporting…" : "Export CSV"}
                    </Button>
                  </div>
                  {exportDone && <p className="text-xs text-muted-foreground">{exportDone}</p>}
                  {exportError && (
                    <div className="flex items-start gap-2 text-sm text-destructive">
                      <XCircle className="mt-0.5 size-4 shrink-0" />
                      <span>Export failed — {exportError}</span>
                    </div>
                  )}
                </div>
              )}

              {output.rows !== null && (
                <div>
                  <p className="mb-1.5 text-xs text-muted-foreground">
                    {output.rows.length} row{output.rows.length !== 1 ? "s" : ""} returned
                  </p>
                  <ResultTable columns={output.columns ?? []} rows={output.rows} />
                </div>
              )}

              {output.status === "complete" && output.rows !== null && (
                <FeedbackButtons question={output.question} sql={output.sql} />
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
