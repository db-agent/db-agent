"use client";

import { Database, Table, Hash, ChevronDown, ChevronRight, AlertCircle } from "lucide-react";
import { useState } from "react";
import type { SchemaResponse, SchemaTable } from "@/lib/types";
import clsx from "clsx";

interface Props {
  schema: SchemaResponse | null;
  loading: boolean;
  error: string | null;
}

function TableItem({ table }: { table: SchemaTable }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm hover:bg-slate-100 transition-colors group"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Table size={14} className="text-brand-500 shrink-0" />
          <span className="font-medium text-slate-700 truncate">{table.name}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {table.row_count != null && (
            <span className="text-xs text-slate-400">{table.row_count.toLocaleString()}</span>
          )}
          {open ? (
            <ChevronDown size={12} className="text-slate-400" />
          ) : (
            <ChevronRight size={12} className="text-slate-400" />
          )}
        </div>
      </button>

      {open && (
        <div className="ml-5 mb-1 space-y-0.5">
          {table.columns.map((col) => (
            <div
              key={col.name}
              className="flex items-center justify-between px-2 py-1.5 rounded text-xs"
            >
              <span className="text-slate-600 font-mono">{col.name}</span>
              <span className="text-slate-400 uppercase text-[10px] tracking-wide font-mono">
                {col.type}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ schema, loading, error }: Props) {
  return (
    <aside className="w-64 shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-hidden hidden lg:flex">
      {/* Section heading */}
      <div className="px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Database size={14} className="text-slate-400" />
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Schema Browser
          </span>
        </div>
        {schema && (
          <p className="mt-1 text-[11px] text-slate-400 font-mono truncate">
            {schema.db_url_display}
          </p>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading && (
          <div className="space-y-2 p-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-8 w-full rounded-lg" />
            ))}
          </div>
        )}

        {error && (
          <div className="m-2 p-3 bg-red-50 border border-red-100 rounded-lg">
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle size={14} />
              <span className="text-xs font-medium">Connection error</span>
            </div>
            <p className="mt-1 text-xs text-red-500">{error}</p>
          </div>
        )}

        {schema && !loading && !error && (
          <div className="space-y-0.5">
            {schema.tables.map((table) => (
              <TableItem key={table.name} table={table} />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-slate-100">
        <div className="flex items-center gap-1.5">
          <div className={clsx(
            "w-2 h-2 rounded-full",
            schema ? "bg-emerald-400" : loading ? "bg-amber-400" : "bg-red-400"
          )} />
          <span className="text-xs text-slate-500">
            {schema
              ? `${schema.tables.length} tables`
              : loading
              ? "Connecting..."
              : "Disconnected"}
          </span>
        </div>
      </div>
    </aside>
  );
}
