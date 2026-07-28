import { useEffect, useState } from "react";
import { fetchExampleQuestions, fetchMemories } from "@/lib/api";
import type { AppConfig, MemoryRecord, Schema } from "@/lib/types";
import { Sparkles } from "lucide-react";

const MEMORY_POLL_MS = 60_000; // mirrors the Python app's st.cache_data(ttl=60)

// A single light, neutral border — minimalist by design. Kept as a
// "palette" of one so SuggestionChip's colorIndex plumbing still works if
// this ever needs to vary again.
const CHIP_COLORS = ["border-border/60"];

function SuggestionChip({
  text,
  colorIndex,
  onClick,
  icon,
  title,
  panel,
}: {
  text: string;
  colorIndex: number;
  onClick: () => void;
  icon?: React.ReactNode;
  title?: string;
  panel?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1.5 border bg-background text-left text-xs font-medium text-foreground transition-colors hover:bg-muted ${
        panel ? "w-full rounded-lg px-3 py-2" : "rounded-full px-3.5 py-2"
      } ${CHIP_COLORS[colorIndex % CHIP_COLORS.length]}`}
    >
      {icon}
      <span className={panel ? "line-clamp-2" : undefined}>{text}</span>
    </button>
  );
}

export function Suggestions({
  config,
  schema,
  onAsk,
  variant = "center",
}: {
  config: AppConfig | null;
  schema: Schema | null;
  onAsk: (q: string) => void;
  /** "center" — wrapped pills for the empty state. "panel" — a stacked
   * vertical list for the narrow always-visible side panel. */
  variant?: "center" | "panel";
}) {
  const panel = variant === "panel";
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [exampleQuestions, setExampleQuestions] = useState<string[]>([]);

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

  useEffect(() => {
    if (!schema) return;
    // Grounded in the actual schema (generated server-side, cached there
    // per schema signature) rather than hardcoded — a hardcoded list only
    // makes sense for the bundled demo DB.
    fetchExampleQuestions().then(setExampleQuestions);
  }, [schema]);

  const memoryFollowups = memories.flatMap((m) =>
    m.suggestedFollowups.map((q) => ({ q, sourceAgent: m.sourceAgent }))
  );

  let colorIndex = 0;

  const groupClass = panel ? "flex flex-col gap-2" : "flex flex-wrap justify-center gap-2";
  const labelClass = `mb-2 text-xs font-medium text-muted-foreground ${panel ? "" : "text-center"}`;

  return (
    <div className="w-full">
      {memoryFollowups.length > 0 && (
        <div className="mb-4">
          <p className={labelClass}>Suggested from other agents</p>
          <div className={groupClass}>
            {memoryFollowups.map(({ q, sourceAgent }, i) => (
              <SuggestionChip
                key={i}
                text={q}
                colorIndex={colorIndex++}
                onClick={() => onAsk(q)}
                icon={<Sparkles className="size-3 shrink-0" />}
                title={`from ${sourceAgent}`}
                panel={panel}
              />
            ))}
          </div>
        </div>
      )}

      {exampleQuestions.length > 0 && (
        <div>
          <p className={labelClass}>Try an example</p>
          <div className={groupClass}>
            {exampleQuestions.map((q) => (
              <SuggestionChip key={q} text={q} colorIndex={colorIndex++} onClick={() => onAsk(q)} panel={panel} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
