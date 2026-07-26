import type { AppConfig, MemoryRecord, PipelineOutput, Schema } from "./types";

export async function fetchConfig(): Promise<AppConfig> {
  const res = await fetch("/api/config");
  return res.json();
}

export async function fetchSchema(): Promise<Schema> {
  const res = await fetch("/api/schema");
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

export const EXAMPLE_QUESTIONS = [
  "How many customers are there?",
  "Show the top 5 products by price",
  "List all orders placed in 2024",
  "Which customers have placed the most orders?",
  "Total revenue per product",
];
