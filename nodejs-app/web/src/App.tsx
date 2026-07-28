import { useEffect, useRef, useState } from "react";
import { ChatTurn } from "@/components/ChatTurn";
import { Sidebar } from "@/components/Sidebar";
import { Suggestions } from "@/components/Suggestions";
import { Button } from "@/components/ui/button";
import { ask, fetchConfig, fetchSchema } from "@/lib/api";
import type { AppConfig, Conversation, Schema, Turn } from "@/lib/types";
import { ArrowUp, Lightbulb, X } from "lucide-react";

const CONVERSATIONS_KEY = "dbagent.conversations";

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((c): c is Conversation => {
      if (!c || typeof c !== "object") return false;
      const obj = c as Record<string, unknown>;
      return (
        typeof obj.id === "string" &&
        typeof obj.title === "string" &&
        Array.isArray(obj.turns) &&
        typeof obj.createdAt === "string"
      );
    });
  } catch {
    return [];
  }
}

function titleFromQuestion(q: string): string {
  return q.length > 48 ? `${q.slice(0, 48)}…` : q;
}

function EmptyState({
  config,
  schema,
  onAsk,
}: {
  config: AppConfig | null;
  schema: Schema | null;
  onAsk: (q: string) => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center text-muted-foreground">
      <div>
        <img src="/logo.png" alt="" className="mx-auto mb-3 size-12 rounded-xl" />
        <p className="mb-1 font-semibold text-foreground">No queries yet</p>
        <p className="text-sm">Type a question below, or pick a suggestion.</p>
      </div>
      <Suggestions config={config} schema={schema} onAsk={onAsk} />
    </div>
  );
}

function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [schema, setSchema] = useState<Schema | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations);
  const [activeId, setActiveId] = useState<string | null>(() => loadConversations()[0]?.id ?? null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSuggestionsPanel, setShowSuggestionsPanel] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const activeConversation = conversations.find((c) => c.id === activeId) ?? null;
  const turns = activeConversation?.turns ?? [];

  useEffect(() => {
    fetchConfig().then(setConfig).catch(() => setConfig(null));
    fetchSchema().then(setSchema).catch(() => setSchema(null));
  }, []);

  useEffect(() => {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  function updateTurns(conversationId: string, updater: (turns: Turn[]) => Turn[]) {
    setConversations((prev) =>
      prev.map((c) => (c.id === conversationId ? { ...c, turns: updater(c.turns) } : c))
    );
  }

  function handleNewChat() {
    setActiveId(null);
    setQuestion("");
  }

  async function handleAsk(q: string) {
    if (!q.trim() || busy) return;
    setBusy(true);
    setQuestion("");

    let conversationId = activeId;
    if (!conversationId) {
      conversationId = crypto.randomUUID();
      const conversation: Conversation = {
        id: conversationId,
        title: titleFromQuestion(q),
        turns: [],
        createdAt: new Date().toISOString(),
      };
      setConversations((prev) => [conversation, ...prev]);
      setActiveId(conversationId);
    }

    const id = crypto.randomUUID();
    updateTurns(conversationId, (prev) => [...prev, { id, question: q, output: null }]);

    try {
      const output = await ask(q);
      updateTurns(conversationId, (prev) => prev.map((t) => (t.id === id ? { ...t, output } : t)));
    } catch (exc) {
      updateTurns(conversationId, (prev) =>
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
      <Sidebar
        config={config}
        schema={schema}
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onNewChat={handleNewChat}
      />

      <main className="flex flex-1 flex-col">
        <div className="flex justify-end px-4 pt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSuggestionsPanel((v) => !v)}
            className="gap-1.5 text-xs text-muted-foreground"
          >
            <Lightbulb className="size-3.5 text-[var(--brand-orange)]" />
            Suggestions
          </Button>
        </div>
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-y-auto px-6 pt-2">
          {turns.length === 0 ? (
            <EmptyState config={config} schema={schema} onAsk={handleAsk} />
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

      {showSuggestionsPanel && (
        <aside className="flex h-screen w-72 shrink-0 flex-col overflow-y-auto border-l bg-sidebar px-4 py-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Suggestions</h2>
            <button
              type="button"
              onClick={() => setShowSuggestionsPanel(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close suggestions panel"
            >
              <X className="size-4" />
            </button>
          </div>
          <Suggestions config={config} schema={schema} onAsk={handleAsk} variant="panel" />
        </aside>
      )}
    </div>
  );
}

export default App;
