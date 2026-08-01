export interface SchemaColumn {
  name: string;
  type: string;
  sampleValues?: string[];
}

export type Schema = Record<string, SchemaColumn[]>;

export interface Validation {
  isSafe: boolean;
  reason: string;
}

export interface PipelineOutput {
  question: string;
  schemaContext: string;
  sql: string | null;
  explanation: string | null;
  validation: Validation | null;
  columns: string[] | null;
  rows: Record<string, unknown>[] | null;
  error: string | null;
  repairAttempts: number;
}

export interface SqlEngineInfo {
  type: string;
  location: string;
  endpoint?: string;
}

export interface AppConfig {
  llmBaseUrl: string;
  llmModel: string;
  dbPath: string;
  sqlEngine: string;
  sqlEngineInfo: SqlEngineInfo;
  memoryEnabled: boolean;
  dbagentId: string;
  memoryBackend: string;
}

export interface Turn {
  id: string;
  question: string;
  output: PipelineOutput | null; // null while pending
}

export interface Conversation {
  id: string;
  title: string; // derived from the first question asked
  turns: Turn[];
  createdAt: string;
}

export interface MemoryRecord {
  recordId: string;
  sourceAgent: string;
  sourceDbKind: string;
  createdAt: string;
  ttlEpoch: number;
  entities: string[];
  insightSummary: string;
  suggestedFollowups: string[];
}

export interface BenchmarkRunResult {
  status: "pass" | "fail";
  at: string;
  sql: string | null;
  reason?: string;
}

export interface BenchmarkCase {
  id: string;
  question: string;
  groundTruthSql: string;
  source: "seed" | "user" | "feedback";
  createdAt: string | null;
  lastRun: BenchmarkRunResult | null;
}
