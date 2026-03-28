"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2 } from "lucide-react";

interface Props {
  onSubmit: (question: string) => void;
  loading: boolean;
  initialValue?: string;
}

export default function QueryInput({ onSubmit, loading, initialValue = "" }: Props) {
  const [value, setValue] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initialValue) setValue(initialValue);
  }, [initialValue]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [value]);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    onSubmit(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-slate-500 mb-2">
            Ask a question about your data
          </label>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Show total revenue by product category this year"
            rows={2}
            className="w-full px-0 py-0 bg-transparent border-none text-sm text-slate-900 placeholder:text-slate-400
                       focus:outline-none resize-none leading-relaxed"
            disabled={loading}
          />
        </div>
        <button
          onClick={handleSubmit}
          disabled={loading || !value.trim()}
          className="btn-primary shrink-0 mt-5"
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              <span className="hidden sm:inline">Thinking...</span>
            </>
          ) : (
            <>
              <Send size={16} />
              <span className="hidden sm:inline">Run</span>
            </>
          )}
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Press <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-500 font-mono text-[10px]">Enter</kbd> to run &middot;{" "}
        <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-500 font-mono text-[10px]">Shift+Enter</kbd> for new line
      </p>
    </div>
  );
}
