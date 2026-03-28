"use client";

import Header from "./Header";
import Sidebar from "./Sidebar";
import type { SchemaResponse } from "@/lib/types";

interface Props {
  children: React.ReactNode;
  schema: SchemaResponse | null;
  schemaLoading: boolean;
  schemaError: string | null;
}

export default function AppShell({ children, schema, schemaLoading, schemaError }: Props) {
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar schema={schema} loading={schemaLoading} error={schemaError} />
        <main className="flex-1 overflow-y-auto bg-slate-50 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
