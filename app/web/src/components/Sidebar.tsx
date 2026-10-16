import { useEffect, useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { getSqlEngineIcon } from "@/components/SqlEngineIcon";
import { saveSqlConnection } from "@/lib/api";
import type { AppConfig, Conversation, Schema } from "@/lib/types";
import { AlertTriangle, MessageSquare, Plus, RefreshCw, Server } from "lucide-react";

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
  schemaError,
  onRetrySchema,
  onConnectionSaved,
  conversations,
  activeId,
  onSelect,
  onNewChat,
}: {
  config: AppConfig | null;
  schema: Schema | null;
  schemaError?: string | null;
  onRetrySchema?: () => void;
  onConnectionSaved?: (next: AppConfig) => void;
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
}) {
  const [openItems, setOpenItems] = useState<string[]>([]);
  const [host, setHost] = useState("");
  const [httpPath, setHttpPath] = useState("");
  const [token, setToken] = useState("");
  const [catalog, setCatalog] = useState("");
  const [schemaName, setSchemaName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  useEffect(() => {
    if (schemaError) setOpenItems(["connection-info"]);
  }, [schemaError]);

  useEffect(() => {
    if (!config?.databricks) return;
    setHost(config.databricks.host || "");
    setHttpPath(config.databricks.httpPath || "");
    setCatalog(config.databricks.catalog || "");
    setSchemaName(config.databricks.schema || "");
    setToken("");
  }, [config?.databricks]);

  const showDatabricksForm =
    !config?.sqlEngine || config.sqlEngine === "databricks-sql" || Boolean(config.databricks);

  async function handleSaveConnection() {
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      const result = await saveSqlConnection({
        host,
        httpPath,
        token,
        catalog,
        schema: schemaName,
      });
      setSaveOk(true);
      setToken("");
      onConnectionSaved?.({
        ...(config as AppConfig),
        sqlEngine: "databricks-sql",
        sqlEngineInfo: result.sqlEngineInfo,
        databricks: result.databricks,
      });
    } catch (exc) {
      setSaveError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setSaving(false);
    }
  }

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

      <Accordion className="w-full" value={openItems} onValueChange={setOpenItems}>
        <AccordionItem value="connection-info">
          <AccordionTrigger className="py-1 text-xs font-medium">
            <span className="flex items-center gap-1.5">
              Connection info
              {schemaError && <AlertTriangle className="size-3.5 text-destructive" />}
            </span>
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

            {showDatabricksForm && (
              <>
                <FieldLabel>Databricks connection</FieldLabel>
                <div className="flex flex-col gap-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-foreground">
                      Host
                    </label>
                    <Input
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      placeholder="dbc-….cloud.databricks.com"
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-foreground">
                      HTTP path
                    </label>
                    <Input
                      value={httpPath}
                      onChange={(e) => setHttpPath(e.target.value)}
                      placeholder="/sql/1.0/warehouses/…"
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-foreground">
                      Token
                    </label>
                    <Input
                      type="password"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder={
                        config?.databricks?.tokenConfigured
                          ? "Leave blank to keep current"
                          : "Personal access token"
                      }
                      className="h-7 text-xs"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-foreground">
                      Catalog
                    </label>
                    <Input
                      value={catalog}
                      onChange={(e) => setCatalog(e.target.value)}
                      placeholder="samples"
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-foreground">
                      Schema
                    </label>
                    <Input
                      value={schemaName}
                      onChange={(e) => setSchemaName(e.target.value)}
                      placeholder="tpcds_sf1"
                      className="h-7 text-xs"
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={saving || !host || !httpPath || !catalog || !schemaName}
                    onClick={handleSaveConnection}
                  >
                    {saving ? "Connecting…" : "Save & reconnect"}
                  </Button>
                  {saveOk && (
                    <p className="text-[11px] text-emerald-600 dark:text-emerald-500">
                      Connected. Schema refreshed.
                    </p>
                  )}
                  {saveError && (
                    <p className="break-words text-[11px] text-destructive">{saveError}</p>
                  )}
                </div>
              </>
            )}

            {schemaError && (
              <div className="mt-2 flex flex-col gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 p-2">
                <div className="flex items-start gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span className="break-words">Connection failed: {schemaError}</span>
                </div>
                {onRetrySchema && (
                  <button
                    type="button"
                    onClick={onRetrySchema}
                    className="flex w-fit items-center gap-1 rounded-md border border-destructive/30 px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10"
                  >
                    <RefreshCw className="size-3" />
                    Retry
                  </button>
                )}
              </div>
            )}

            <FieldLabel>Schema</FieldLabel>
            {schemaError ? (
              <p className="text-xs text-muted-foreground">
                Unavailable — fix the connection error above and retry.
              </p>
            ) : schema ? (
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
