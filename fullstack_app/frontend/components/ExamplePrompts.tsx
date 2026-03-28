"use client";

import { Lightbulb } from "lucide-react";

const EXAMPLES = [
  "Show total revenue by product category",
  "Which customers placed the most orders?",
  "List the top 5 best-selling products",
  "Show orders placed in the last 30 days",
  "What is the average order value per city?",
  "Find customers who have never placed an order",
];

interface Props {
  onSelect: (question: string) => void;
}

export default function ExamplePrompts({ onSelect }: Props) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Lightbulb size={15} className="text-amber-400" />
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Example Questions
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            onClick={() => onSelect(example)}
            className="text-left px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-white
                       hover:border-brand-300 hover:shadow-sm transition-all text-sm text-slate-600
                       hover:text-slate-900 group"
          >
            <span className="group-hover:text-brand-700 transition-colors">{example}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
