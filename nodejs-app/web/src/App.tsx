import { useEffect, useRef, useState } from "react";
import { ChatTurn } from "@/components/ChatTurn";
import { Sidebar } from "@/components/Sidebar";
import { Button } from "@/components/ui/button";
import { ask, fetchConfig, fetchSchema } from "@/lib/api";
import type { AppConfig, Schema, Turn } from "@/lib/types";
import { ArrowUp, Database } from "lucide-react";

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center text-muted-foreground">
      <Database className="mb-3 size-10" />
      <p className="mb-1 font-semibold text-foreground">No queries yet</p>
      <p className="text-sm">
        Type a question below, or pick an example from the sidebar.
      </p>
    </div>
  );
}

function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [schema, setSchema] = useState<Schema | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchConfig().then(setConfig);
    fetchSchema().then(setSchema);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  async function handleAsk(q: string) {
    if (!q.trim() || busy) return;
    setBusy(true);
    setQuestion("");

    const id = crypto.randomUUID();
    setTurns((prev) => [...prev, { id, question: q, output: null }]);

    try {
      const output = await ask(q);
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, output } : t)));
    } catch (exc) {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                output: {
                  question: q,
                  schemaContext: "",
                  sql: null,
                  explanation: null,
                  validation: null,
                  columns: null,
                  rows: null,
                  error: String((exc as Error).message ?? exc),
                  repairAttempts: 0,
                },
              }
            : t
        )
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar config={config} schema={schema} onAsk={handleAsk} />

      <main className="flex flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-y-auto px-6 pt-8">
          {turns.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              {turns.map((t) => (
                <ChatTurn key={t.id} turn={t} />
              ))}
              <div ref={chatEndRef} />
            </>
          )}
        </div>

        <div className="px-6 pb-6 pt-2">
          <form
            className="mx-auto flex w-full max-w-4xl items-center gap-2 rounded-[28px] border bg-background px-4 py-2 shadow-sm transition-shadow focus-within:shadow-md"
            onSubmit={(e) => {
              e.preventDefault();
              handleAsk(question);
            }}
          >
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question about your data …"
              disabled={busy}
              autoFocus
              className="flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
            />
            <Button
              type="submit"
              size="icon"
              className="size-8 shrink-0 rounded-full"
              disabled={busy || !question.trim()}
            >
              <ArrowUp className="size-4" />
            </Button>
          </form>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            DB Agent can make mistakes. Consider checking important information.
          </p>
        </div>
      </main>
    </div>
  );
}

export default App;
