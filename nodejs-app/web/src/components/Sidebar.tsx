import { useEffect, useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { EXAMPLE_QUESTIONS, fetchMemories } from "@/lib/api";
import type { AppConfig, MemoryRecord, Schema } from "@/lib/types";
import { Database, Server, Sparkles } from "lucide-react";

const MEMORY_POLL_MS = 60_000; // mirrors the Python app's st.cache_data(ttl=60)

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 mt-4 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
      {children}
    </div>
  );
}

function MemorySuggestions({
  config,
  schema,
  onAsk,
}: {
  config: AppConfig | null;
  schema: Schema | null;
  onAsk: (q: string) => void;
}) {
  const [memories, setMemories] = useState<MemoryRecord[] | null>(null);

  useEffect(() => {
    if (!config?.memoryEnabled || !schema) return;

    let cancelled = false;
    const load = () => {
      fetchMemories(Object.keys(schema).sort()).then((m) => {
        if (!cancelled) setMemories(m);
      });
    };
    load();
    const interval = setInterval(load, MEMORY_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [config?.memoryEnabled, schema]);

  if (!config?.memoryEnabled) return null;

  return (
    <>
      <FieldLabel>Suggested from other agents</FieldLabel>
      <p className="mb-2 text-[11px] text-muted-foreground">
        via <code className="rounded bg-muted px-1 py-0.5">{config.memoryBackend}</code> memory
        · this agent: <code className="rounded bg-muted px-1 py-0.5">{config.dbagentId}</code>
      </p>
      {memories === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : memories.length === 0 ? (
        <p className="text-xs text-muted-foreground">No cross-agent context yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {memories.map((m) => (
            <Card key={m.recordId} className="py-3">
              <CardContent className="flex flex-col gap-1.5 px-3">
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Sparkles className="size-3" />
                  from <code className="rounded bg-muted px-1 py-0.5">{m.sourceAgent}</code> ({m.sourceDbKind})
                </div>
                <p className="text-xs">{m.insightSummary}</p>
                {m.suggestedFollowups.map((q, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    className="h-auto justify-start whitespace-normal py-1.5 text-left text-xs font-normal"
                    onClick={() => onAsk(q)}
                  >
                    {q}
                  </Button>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export function Sidebar({
  config,
  schema,
  onAsk,
}: {
  config: AppConfig | null;
  schema: Schema | null;
  onAsk: (q: string) => void;
}) {
  return (
    <aside className="flex h-screen w-72 shrink-0 flex-col overflow-y-auto border-r bg-sidebar px-4 py-5">
      <h1 className="text-base font-semibold">DB Agent · Node</h1>
      <p className="text-xs text-muted-foreground">
        Natural-language SQL · React + shadcn/ui
      </p>

      <Separator className="my-4" />

      <FieldLabel>LLM</FieldLabel>
      <div className="flex items-center gap-2 text-xs">
        <Server className="size-3.5 text-muted-foreground" />
        <code className="rounded bg-muted px-1.5 py-0.5">
          {config?.llmBaseUrl ?? "…"}
        </code>
      </div>
      <div className="mt-1 text-xs">
        <code className="rounded bg-muted px-1.5 py-0.5">
          {config?.llmModel ?? "…"}
        </code>
      </div>

      <FieldLabel>Database</FieldLabel>
      <div className="flex items-center gap-2 text-xs">
        <Database className="size-3.5 text-muted-foreground" />
        <code className="rounded bg-muted px-1.5 py-0.5">
          {config?.dbPath ?? "…"}
        </code>
      </div>

      <FieldLabel>Schema</FieldLabel>
      {schema ? (
        <Accordion className="w-full">
          {Object.entries(schema).map(([table, cols]) => (
            <AccordionItem key={table} value={table}>
              <AccordionTrigger className="py-2 text-xs">
                {table} <span className="text-muted-foreground">({cols.length} cols)</span>
              </AccordionTrigger>
              <AccordionContent>
                <div className="flex flex-col gap-1 pl-1">
                  {cols.map((c) => (
                    <div key={c.name} className="text-xs text-muted-foreground">
                      <code className="text-foreground">{c.name}</code> {c.type}
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      ) : (
        <p className="text-xs text-muted-foreground">Loading…</p>
      )}

      <MemorySuggestions config={config} schema={schema} onAsk={onAsk} />

      <FieldLabel>Try an example</FieldLabel>
      <div className="flex flex-col gap-1.5">
        {EXAMPLE_QUESTIONS.map((q) => (
          <Button
            key={q}
            variant="outline"
            size="sm"
            className="h-auto justify-start whitespace-normal py-1.5 text-left text-xs font-normal"
            onClick={() => onAsk(q)}
          >
            {q}
          </Button>
        ))}
      </div>
    </aside>
  );
}
