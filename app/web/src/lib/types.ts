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

export interface CostEstimate {
  usd?: number;
  usdLow?: number;
  usdHigh?: number;
  dbu?: number;
  durationMs?: number;
  scanRows?: number;
  dbuPerHour?: number | null;
  pricePerDbu?: number | null;
  warehouseSize?: string | null;
  warehouseType?: string | null;
  sku?: string | null;
  historySamples?: number;
  confidence?: "low" | "moderate";
  notes?: string[];
  error?: string;
}

export interface PlanScan {
  table: string;
  scanType: string;
  indexName?: string | null;
  filtered: boolean;
  tableRows?: number | null;
  estimatedRows?: number | null;
  bounded?: boolean;
}

export interface PlanWarning {
  code: string;
  table?: string | null;
  message: string;
}

export interface QueryAnalysis {
  engine?: string;
  scans?: PlanScan[];
  warnings?: PlanWarning[];
  totalCost?: number | null;
  /** Rows the query actually returned, when the result was not cut off by the row cap. */
  actualRows?: number | null;
  cost?: CostEstimate | null;
  scanRows?: number | null;
  sizeInBytes?: number | null;
  sizeLabel?: string | null;
  rowCount?: number | null;
  rawPlan?: string | null;
  error?: string | null;
}

export interface UsageEstimate {
  model?: string;
  calls?: number;
  inputTokens?: number;
  outputTokens?: number;
  missing?: number;
  llmUsdEstimate?: number | null;
  warehouseUsdEstimate?: number | null;
}

export type PipelineStatus = "awaiting_approval" | "complete" | "rejected";

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
  analysis?: QueryAnalysis | null;
  status?: PipelineStatus | null;
  approvalReason?: string | null;
  usage?: UsageEstimate | null;
}

export interface SqlEngineInfo {
  type: string;
  location: string;
  endpoint?: string;
  catalog?: string;
  schema?: string;
  httpPath?: string;
}

export interface DatabricksConfig {
  host: string;
  httpPath: string;
  catalog: string;
  schema: string;
  tokenConfigured: boolean;
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
  databricks?: DatabricksConfig;
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

export interface Knowledge {
  descriptions: Record<string, string>;
  expressions: Record<string, string>;
  examples: { question: string; sql: string }[];
  instructions: string[];
}

export interface ScanTable {
  name: string;
  key: string;
  columns: number;
  described: number;
  hasPk: boolean;
  foreignKeys: number;
  score: number;
  issues: string[];
  sensitive: string[];
}

export interface ScanTodo {
  kind: "code-meaning" | "table-description" | "sensitive";
  table: string;
  column: string | null;
  ask: string;
}

export interface ScanResult {
  summary: {
    tables: number;
    columns: number;
    describedColumns: number;
    describedShare: number;
    foreignKeys: number;
    tablesWithoutPrimaryKey: number;
    sensitiveColumns: number;
    overall: number;
  };
  tables: ScanTable[];
  fixes: ScanTable[];
  todo: ScanTodo[];
}

export interface OntologyState {
  path: string;
  exists: boolean;
  knowledge: Knowledge;
  lastScan: { at: string; summary: ScanResult["summary"] } | null;
}

export interface AbArm {
  status: "pass" | "wrong" | "error" | "blocked" | "held";
  sql: string | null;
  ms: number;
  tokens: number;
  repairs?: number;
  detail?: string;
}

export interface AbSummaryArm {
  pass: number;
  total: number;
  percent: number;
  held: number;
  tokens: number;
  avgMs: number;
}

export interface AbStatus {
  status: "idle" | "running" | "done" | "cancelled" | "error";
  id?: string;
  model?: string;
  total?: number;
  done?: number;
  current?: string | null;
  error?: string;
  results?: { id: string; question: string; groundTruthSql?: string; off?: AbArm; on?: AbArm; skipped?: string }[];
  summary?: { off: AbSummaryArm; on: AbSummaryArm; skipped: number };
}
