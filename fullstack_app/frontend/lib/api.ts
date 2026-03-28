// api.ts — Typed API client for the DB-Agent backend.
//
// All requests go through /api/* which Next.js rewrites to the backend
// (see next.config.ts). In production, point NEXT_PUBLIC_API_URL to
// your API Gateway URL.

import type { QueryRequest, QueryResponse, SchemaResponse, HealthResponse } from "./types";

const API_BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body.detail || body.error || message;
    } catch {}
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

export function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/health");
}

export function fetchSchema(): Promise<SchemaResponse> {
  return request<SchemaResponse>("/schema");
}

export function submitQuery(payload: QueryRequest): Promise<QueryResponse> {
  return request<QueryResponse>("/query", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
