"use client";

import { useState, useEffect } from "react";
import AppShell from "@/components/AppShell";
import QueryWorkspace from "@/components/QueryWorkspace";
import { fetchSchema } from "@/lib/api";
import type { SchemaResponse } from "@/lib/types";

export default function Home() {
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(true);

  useEffect(() => {
    fetchSchema()
      .then(setSchema)
      .catch((e) => setSchemaError(e.message))
      .finally(() => setSchemaLoading(false));
  }, []);

  return (
    <AppShell schema={schema} schemaLoading={schemaLoading} schemaError={schemaError}>
      <QueryWorkspace schema={schema} />
    </AppShell>
  );
}
