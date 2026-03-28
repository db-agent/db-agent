import { Database } from "lucide-react";
import type { SchemaResponse } from "@/lib/types";

interface Props {
  schema: SchemaResponse | null;
  loading: boolean;
}

export default function SchemaPanel({ schema, loading }: Props) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Database size={15} className="text-slate-400" />
        <span className="text-sm font-semibold text-slate-700">Database Schema</span>
      </div>

      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-6 w-full rounded" />
          ))}
        </div>
      )}

      {schema && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {schema.tables.map((table) => (
            <div key={table.name} className="p-3 bg-slate-50 rounded-lg border border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-700">{table.name}</span>
                {table.row_count != null && (
                  <span className="text-[10px] text-slate-400">{table.row_count} rows</span>
                )}
              </div>
              <div className="space-y-1">
                {table.columns.map((col) => (
                  <div key={col.name} className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-slate-600">{col.name}</span>
                    <span className="text-[10px] text-slate-400 uppercase font-mono">{col.type}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
