import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveLlm } from "@/lib/api";
import type { AppConfig } from "@/lib/types";

export function LlmSettings({
  config,
  onSaved,
}: {
  config: AppConfig | null;
  onSaved?: (next: AppConfig) => void;
}) {
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setBaseUrl(config?.llmBaseUrl ?? "");
    setModel(config?.llmModel ?? "");
  }, [config?.llmBaseUrl, config?.llmModel]);

  if (!config) return null;
  const locked = Boolean(config.llmLocked);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const next = await saveLlm({ baseUrl, model, apiKey });
      setApiKey("");
      onSaved?.({ ...(config as AppConfig), llmBaseUrl: next.baseUrl, llmModel: next.model, llmKeyConfigured: next.keyConfigured });
      setStatus({ ok: true, text: "Saved. The next question uses these settings." });
    } catch (exc) {
      setStatus({ ok: false, text: exc instanceof Error ? exc.message : String(exc) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 pt-1">
      <p className="text-[11px] text-muted-foreground">
        Any OpenAI-compatible endpoint: OpenAI, Groq, Ollama, Databricks. The key is kept in this server&apos;s memory only,
        is never shown again, and applies to everyone using this server until it restarts.
      </p>
      <label className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Endpoint</label>
      <Input value={baseUrl} disabled={locked} onChange={(e) => setBaseUrl(e.target.value)} className="h-7 text-xs" placeholder="https://api.openai.com/v1" />
      <label className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Model</label>
      <Input value={model} disabled={locked} onChange={(e) => setModel(e.target.value)} className="h-7 text-xs" placeholder="gpt-4o-mini" />
      <label className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">API key</label>
      <Input
        type="password"
        autoComplete="off"
        value={apiKey}
        disabled={locked}
        onChange={(e) => setApiKey(e.target.value)}
        className="h-7 text-xs"
        placeholder={config.llmKeyConfigured ? "A key is set. Type to replace it." : "Paste your API key"}
      />
      {!config.llmKeyConfigured && (
        <p className="text-[11px] text-destructive">No API key yet: questions will fail until you add one.</p>
      )}
      {locked ? (
        <p className="text-[11px] text-muted-foreground">Locked by LLM_SETTINGS_LOCK. Change it in the environment.</p>
      ) : (
        <Button size="sm" onClick={save} disabled={saving} className="self-start text-xs">
          {saving ? "Saving…" : "Save LLM settings"}
        </Button>
      )}
      {status && <p className={`text-[11px] ${status.ok ? "text-emerald-600" : "text-destructive"}`}>{status.text}</p>}
    </div>
  );
}
