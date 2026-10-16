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
import { sendFeedback } from "@/lib/api";
import type { QueryAnalysis, Turn } from "@/lib/types";
import { Check, CheckCircle2, Loader2, ThumbsDown, ThumbsUp, Wrench, X, XCircle } from "lucide-react";

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

          {output?.error && !output.sql && (
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
                  <p className="text-xs text-muted-foreground">
                    Review the query analysis, then accept to run on the warehouse or discard.
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 gap-1.5"
                      disabled={executing}
                      onClick={handleAccept}
                      title="Accept and run query"
                    >
                      {executing ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Check className="size-4" />
                      )}
                      {executing ? "Running…" : "Accept & run"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5"
                      disabled={executing}
                      onClick={() => onReject?.(turn.id)}
                      title="Discard this query"
                    >
                      <X className="size-4" />
                      Discard
                    </Button>
                  </div>
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
