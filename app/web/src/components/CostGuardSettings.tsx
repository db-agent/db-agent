import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveCostGuard } from "@/lib/api";
import type { CostGuard } from "@/lib/types";

const MB = 1024 ** 2;

type Row = { on: boolean; value: string };

// What the number means, per limit. 'to' converts the number typed into what the server stores.
const LIMITS = [
  { key: "maxRows", label: "Rows", unit: "rows", to: (n: number) => n, from: (n: number) => n,
    hint: "Held when the estimate is above this and the query returns row for row (SELECT *). Grouped queries are exempt." },
  { key: "maxBytes", label: "Data scanned", unit: "MB", to: (n: number) => n * MB, from: (n: number) => n / MB,
    hint: "Held when the estimated size of the data is above this." },
  { key: "maxCostUsd", label: "Warehouse cost", unit: "USD", to: (n: number) => n, from: (n: number) => n,
    hint: "Held when the high end of the estimated compute cost is above this." },
] as const;

type Key = (typeof LIMITS)[number]["key"];

function toRows(guard: CostGuard): Record<Key, Row> {
  const out = {} as Record<Key, Row>;
  for (const l of LIMITS) {
    const current = guard.limits[l.key];
    const shown = current > 0 ? current : guard.defaults[l.key];
    out[l.key] = { on: current > 0, value: String(l.from(shown)) };
  }
  return out;
}

export function CostGuardSettings({ guard }: { guard?: CostGuard }) {
  const [rows, setRows] = useState<Record<Key, Row> | null>(guard ? toRows(guard) : null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (guard) setRows(toRows(guard));
  }, [guard]);

  if (!guard || !rows) return null;

  async function save() {
    if (!rows) return;
    setSaving(true);
    setStatus(null);
    try {
      const body: Record<string, number> = {};
      for (const l of LIMITS) {
        const r = rows[l.key];
        const n = Number(r.value);
        if (r.on && (!Number.isFinite(n) || n <= 0)) throw new Error(`${l.label}: enter a number above 0, or switch it off.`);
        body[l.key] = r.on ? l.to(n) : 0;
      }
      const next = await saveCostGuard(body);
      setRows(toRows(next));
      setStatus({ ok: true, text: "Saved. Applies to the next question, until this app restarts." });
    } catch (exc) {
      setStatus({ ok: false, text: exc instanceof Error ? exc.message : String(exc) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 pt-1">
      <p className="text-[11px] text-muted-foreground">
        A query waits for approval when its estimate is over any limit that is on, or when no estimate is available.
      </p>
      {LIMITS.map((l) => (
        <div key={l.key}>
          <label className="flex items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={rows[l.key].on}
              disabled={guard.locked}
              onChange={(e) => setRows({ ...rows, [l.key]: { ...rows[l.key], on: e.target.checked } })}
            />
            {l.label}
          </label>
          <div className="mt-1 flex items-center gap-2">
            <Input
              type="number"
              min={0}
              value={rows[l.key].value}
              disabled={guard.locked || !rows[l.key].on}
              onChange={(e) => setRows({ ...rows, [l.key]: { ...rows[l.key], value: e.target.value } })}
              className="h-7 text-xs"
            />
            <span className="text-[11px] text-muted-foreground">{l.unit}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{l.hint}</p>
        </div>
      ))}
      {guard.locked ? (
        <p className="text-[11px] text-muted-foreground">Locked by COST_GUARD_LOCK. Change it in the environment.</p>
      ) : (
        <Button size="sm" onClick={save} disabled={saving} className="self-start text-xs">
          {saving ? "Saving…" : "Save limits"}
        </Button>
      )}
      {status && (
        <p className={`text-[11px] ${status.ok ? "text-emerald-600" : "text-destructive"}`}>{status.text}</p>
      )}
    </div>
  );
}
