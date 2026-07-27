export interface SchemaColumn {
  name: string;
  type: string;
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

export interface AppConfig {
  llmBaseUrl: string;
  llmModel: string;
  dbPath: string;
  memoryEnabled: boolean;
  dbagentId: string;
  memoryBackend: string;
}

export interface Turn {
  id: string;
  question: string;
  output: PipelineOutput | null; // null while pending
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
