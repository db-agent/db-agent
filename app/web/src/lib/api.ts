import type { AbStatus, AppConfig, BenchmarkCase, Knowledge, MemoryRecord, OntologyState, PipelineOutput, ScanResult, Schema } from "./types";

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

export async function ask(question: string, sql?: string): Promise<PipelineOutput> {
  const res = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, sql }),
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

export async function exportCsv(sql: string): Promise<{ name: string; bytes: number }> {
  const res = await fetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Export failed (${res.status})`);
  }
  const name =
    /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] ?? "query.csv";
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  // Must be in the DOM for Firefox, and the URL must outlive the click:
  // revoking it synchronously can make the browser save an empty file.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { name, bytes: blob.size };
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

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  return body as T;
}

export async function fetchOntology(): Promise<OntologyState> {
  return json(await fetch("/api/ontology"));
}

export async function scanDatabase(): Promise<{ at: string; scan: ScanResult; merged: Knowledge }> {
  return json(await fetch("/api/ontology/scan", { method: "POST" }));
}

export async function saveOntology(knowledge: Knowledge): Promise<{ ok: boolean; backup: string | null }> {
  return json(
    await fetch("/api/ontology", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(knowledge),
    })
  );
}

export async function fetchAbCases(): Promise<{ model: string; total: number; eligible: { id: string; question: string }[] }> {
  return json(await fetch("/api/ab/cases"));
}

export async function startAbTest(): Promise<{ id: string; total: number }> {
  return json(await fetch("/api/ab/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
}

export async function fetchAbStatus(): Promise<AbStatus> {
  return json(await fetch("/api/ab/status"));
}

export async function cancelAbTest(): Promise<void> {
  await fetch("/api/ab/cancel", { method: "POST" });
}
