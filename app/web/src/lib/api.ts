import type { AppConfig, BenchmarkCase, MemoryRecord, PipelineOutput, Schema } from "./types";

export async function fetchConfig(): Promise<AppConfig> {
  const res = await fetch("/api/config");
  return res.json();
}

export async function saveSqlConnection(connection: {
  host: string;
  httpPath: string;
  token: string;
  catalog: string;
  schema: string;
}): Promise<{
  ok: boolean;
  sqlEngineInfo: AppConfig["sqlEngineInfo"];
  databricks: NonNullable<AppConfig["databricks"]>;
  error?: string;
}> {
  const res = await fetch("/api/sql-connection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(connection),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body;
}

export async function fetchSchema(): Promise<Schema> {
  const res = await fetch("/api/schema");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export async function ask(question: string): Promise<PipelineOutput> {
  const res = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export async function executeSql(
  sql: string,
  question?: string
): Promise<{
  sql: string | null;
  columns: string[] | null;
  rows: Record<string, unknown>[] | null;
  error: string | null;
  status?: string | null;
  validation?: { isSafe: boolean; reason: string };
}> {
  const res = await fetch("/api/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql, question }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && !body.sql && !body.error) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body;
}

export async function fetchMemories(tables: string[]): Promise<MemoryRecord[]> {
  const res = await fetch(`/api/memories?tables=${encodeURIComponent(tables.join(","))}`);
  if (!res.ok) return [];
  return res.json();
}

export async function sendFeedback(feedback: {
  question: string;
  sql: string | null;
  rating: "up" | "down";
  comment?: string;
}): Promise<boolean> {
  const res = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(feedback),
  });
  return res.ok;
}

export async function fetchExampleQuestions(): Promise<string[]> {
  const res = await fetch("/api/example-questions");
  if (!res.ok) return [];
  return res.json();
}

export async function fetchBenchmarks(): Promise<BenchmarkCase[]> {
  const res = await fetch("/api/benchmarks");
  if (!res.ok) return [];
  return res.json();
}

export async function addBenchmark(question: string, groundTruthSql: string): Promise<BenchmarkCase> {
  const res = await fetch("/api/benchmarks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, groundTruthSql }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export async function deleteBenchmark(id: string): Promise<void> {
  const res = await fetch(`/api/benchmarks/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
}
