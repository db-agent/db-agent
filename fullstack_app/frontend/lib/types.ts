// types.ts — Mirrors the Pydantic models in backend/app/models.py
// Keep these in sync with the API contract.

export interface ValidationResult {
  is_valid: boolean;
  errors: string[];
}

export interface Timings {
  llm_ms: number;
  validation_ms: number;
  execution_ms: number;
  total_ms: number;
}

export interface QueryResponse {
  question: string;
  schema_context: string;
  sql: string;
  validation: ValidationResult;
  explanation: string;
  rows: Record<string, unknown>[];
  row_count: number;
  timings: Timings;
  error?: string | null;
}

export interface QueryRequest {
  question: string;
  limit?: number;
}

export interface SchemaColumn {
  name: string;
  type: string;
}

export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
  row_count?: number | null;
}

export interface SchemaResponse {
  tables: SchemaTable[];
  db_url_display: string;
}

export interface HealthResponse {
  status: string;
  db_connected: boolean;
  version: string;
}
