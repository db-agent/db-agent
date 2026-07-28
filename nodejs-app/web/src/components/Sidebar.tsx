import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import type { AppConfig, Schema } from "@/lib/types";
import { Database, Server } from "lucide-react";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 mt-4 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
      {children}
    </div>
  );
}

export function Sidebar({
  config,
  schema,
}: {
  config: AppConfig | null;
  schema: Schema | null;
}) {
  return (
    <aside className="flex h-screen w-72 shrink-0 flex-col overflow-y-auto border-r bg-sidebar px-4 py-5">
      <div className="flex items-center gap-2">
        <img src="/logo.png" alt="" className="size-7 rounded-md" />
        <h1 className="text-base font-semibold">DB Agent</h1>
      </div>
      <p className="text-xs text-muted-foreground">
        Ask your database questions in plain English
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
                      {c.sampleValues && (
                        <span className="ml-1 text-[11px]">
                          — one of: {c.sampleValues.map((v) => `'${v}'`).join(", ")}
                        </span>
                      )}
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
    </aside>
  );
}
