"use client";

import { Table2 } from "lucide-react";

interface Props {
  rows: Record<string, unknown>[];
}

export default function ResultsTable({ rows }: Props) {
  if (rows.length === 0) return null;

  const columns = Object.keys(rows[0]);

  return (
    <div className="card overflow-hidden">
      <div className="card-header">
        <Table2 size={15} className="text-slate-400" />
        <span className="text-sm font-semibold text-slate-700">Results</span>
        <span className="ml-auto badge bg-slate-100 text-slate-500">
          {rows.length} row{rows.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              {columns.map((col) => (
                <th
                  key={col}
                  className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-slate-50 transition-colors">
                {columns.map((col) => (
                  <td
                    key={col}
                    className="px-4 py-2.5 text-slate-700 whitespace-nowrap font-mono text-xs"
                  >
                    {formatCell(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}
