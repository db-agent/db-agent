import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import { getSqlEngineIcon } from "@/components/SqlEngineIcon";
import type { AppConfig, Conversation, Schema } from "@/lib/types";
import { MessageSquare, Plus, Server } from "lucide-react";

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
  conversations,
  activeId,
  onSelect,
  onNewChat,
}: {
  config: AppConfig | null;
  schema: Schema | null;
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
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

      <button
        type="button"
        onClick={onNewChat}
        className="mt-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted"
      >
        <Plus className="size-3.5" />
        New chat
      </button>

      <FieldLabel>Chat history</FieldLabel>
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {conversations.length === 0 && (
          <p className="text-xs text-muted-foreground">No conversations yet.</p>
        )}
        {conversations.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            className={`flex items-center gap-2 truncate rounded-lg px-2 py-1.5 text-left text-xs ${
              c.id === activeId ? "bg-muted font-medium" : "hover:bg-muted/60"
            }`}
          >
            <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{c.title}</span>
          </button>
        ))}
      </div>

      <Separator className="my-4" />

      <Accordion className="w-full">
        <AccordionItem value="connection-info">
          <AccordionTrigger className="py-1 text-xs font-medium">
            Connection info
          </AccordionTrigger>
          <AccordionContent>
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
            {(() => {
              const engineInfo = config?.sqlEngineInfo;
              const { icon, label } = getSqlEngineIcon(engineInfo?.type);
              return (
                <div className="flex items-center gap-2 text-xs" title={label}>
                  {icon}
                  <code className="rounded bg-muted px-1.5 py-0.5 break-all">
                    {engineInfo?.location ?? config?.dbPath ?? "…"}
                  </code>
                </div>
              );
            })()}
            {config?.sqlEngineInfo && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {getSqlEngineIcon(config.sqlEngineInfo.type).label}
                {config.sqlEngineInfo.endpoint ? ` · ${config.sqlEngineInfo.endpoint}` : ""}
              </p>
            )}

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
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </aside>
  );
}
