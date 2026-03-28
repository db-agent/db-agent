"use client";

import { useState } from "react";
import QueryInput from "./QueryInput";
import ExamplePrompts from "./ExamplePrompts";
import SqlPanel from "./SqlPanel";
import ValidationBadge from "./ValidationBadge";
import ResultsTable from "./ResultsTable";
import ExplanationPanel from "./ExplanationPanel";
import { submitQuery } from "@/lib/api";
import type { QueryResponse, SchemaResponse } from "@/lib/types";
import { AlertCircle, Clock } from "lucide-react";

interface Props {
  schema: SchemaResponse | null;
}

export default function QueryWorkspace({ schema }: Props) {
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleQuery = async (question: string) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await submitQuery({ question, limit: 100 });
      setResult(response);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Page heading */}
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Query Workspace</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Ask a question in plain English — the AI will generate and execute the SQL.
        </p>
      </div>

      {/* Query input */}
      <QueryInput onSubmit={handleQuery} loading={loading} />

      {/* Example prompts (shown when no result yet) */}
      {!result && !loading && !error && (
        <ExamplePrompts onSelect={handleQuery} />
      )}

      {/* Loading skeleton */}
      {loading && <LoadingState />}

      {/* Error state */}
      {error && !loading && (
        <div className="card p-4 flex items-start gap-3 border-red-200 bg-red-50">
          <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-700">Request failed</p>
            <p className="mt-0.5 text-sm text-red-600">{error}</p>
          </div>
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <div className="space-y-4">
          {/* Timing bar */}
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <div className="flex items-center gap-1.5">
              <Clock size={12} />
              <span>Total {result.timings.total_ms}ms</span>
            </div>
            <span>LLM {result.timings.llm_ms}ms</span>
            <span>Exec {result.timings.execution_ms}ms</span>
            <span className="ml-auto text-slate-500 font-medium">
              {result.row_count} row{result.row_count !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Validation badge */}
          <ValidationBadge validation={result.validation} />

          {/* SQL panel */}
          <SqlPanel sql={result.sql} />

          {/* Explanation */}
          <ExplanationPanel explanation={result.explanation} />

          {/* Results table */}
          {result.rows.length > 0 && (
            <ResultsTable rows={result.rows} />
          )}

          {/* Empty result */}
          {result.rows.length === 0 && result.validation.is_valid && !result.error && (
            <div className="card p-8 text-center">
              <p className="text-sm text-slate-500">Query returned no rows.</p>
            </div>
          )}

          {/* Pipeline error */}
          {result.error && (
            <div className="card p-4 flex items-start gap-3 border-amber-200 bg-amber-50">
              <AlertCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-700">Pipeline error</p>
                <p className="mt-0.5 text-sm text-amber-600">{result.error}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <div className="card p-5 space-y-3">
        <div className="skeleton h-4 w-24 rounded" />
        <div className="skeleton h-12 w-full rounded" />
        <div className="skeleton h-12 w-3/4 rounded" />
      </div>
      <div className="card p-5 space-y-3">
        <div className="skeleton h-4 w-20 rounded" />
        <div className="skeleton h-24 w-full rounded" />
      </div>
      <div className="card p-5 space-y-2">
        <div className="skeleton h-4 w-32 rounded" />
        <div className="skeleton h-8 w-full rounded" />
        <div className="skeleton h-8 w-full rounded" />
        <div className="skeleton h-8 w-full rounded" />
      </div>
    </div>
  );
}
