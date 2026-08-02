import type { AppConfig, BenchmarkCase, MemoryRecord, PipelineOutput, Schema } from "./types";

export async function fetchConfig(): Promise<AppConfig> {
  const res = await fetch("/api/config");
  return res.json();
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
