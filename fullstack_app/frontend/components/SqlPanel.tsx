"use client";

import { useState } from "react";
import { Code2, Copy, Check } from "lucide-react";

interface Props {
  sql: string;
}

export default function SqlPanel({ sql }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!sql) return null;

  return (
    <div className="card overflow-hidden">
      <div className="card-header justify-between">
        <div className="flex items-center gap-2">
          <Code2 size={15} className="text-slate-400" />
          <span className="text-sm font-semibold text-slate-700">Generated SQL</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
        >
          {copied ? (
            <>
              <Check size={13} className="text-emerald-500" />
              <span className="text-emerald-600">Copied</span>
            </>
          ) : (
            <>
              <Copy size={13} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <div className="p-4 bg-slate-950 overflow-x-auto">
        <pre className="text-sm font-mono text-slate-100 leading-relaxed whitespace-pre-wrap">
          <code>{sql}</code>
        </pre>
      </div>
    </div>
  );
}
