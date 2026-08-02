// SqlEngineIcon.tsx — maps a SQL engine's `type` (from sqlEngineInfo, see
// server.js's /api/config) to a representative icon + short label, used in
// the sidebar's "Database" field.
//
// These are generic lucide-react icons (already a dependency), not official
// brand logos — bundling real AWS/Databricks/etc. trademarked assets needs
// a legitimately-sourced logo file, which this repo doesn't have. Swapping
// in a real logo later is a one-line change per entry once you have one:
// replace the `icon` value with an <img src="/logos/whatever.svg" />,
// nothing else needs to change.
//
// Extensible on purpose: a future engine (e.g. a Databricks Lakebase
// backend) just adds one entry here, keyed by whatever `type` string its
// sqlEngines/*.js file returns from describe().

import { Cloud, Database, HardDrive } from "lucide-react";
import type { ReactNode } from "react";

interface SqlEngineIconEntry {
  icon: ReactNode;
  label: string;
}

const REGISTRY: Record<string, SqlEngineIconEntry> = {
  sqlite: {
    icon: <HardDrive className="size-3.5 text-muted-foreground" />,
    label: "Local file",
  },
  "minio-duckdb": {
    icon: <Cloud className="size-3.5 text-[var(--brand-azure)]" />,
    label: "S3-compatible object storage",
  },
  postgres: {
    icon: <Database className="size-3.5 text-[var(--brand-orange)]" />,
    label: "Postgres (or Databricks Lakebase)",
  },
};

const FALLBACK: SqlEngineIconEntry = {
  icon: <Database className="size-3.5 text-muted-foreground" />,
  label: "Database",
};

export function getSqlEngineIcon(type: string | undefined): SqlEngineIconEntry {
  if (!type) return FALLBACK;
  return REGISTRY[type] ?? FALLBACK;
}
