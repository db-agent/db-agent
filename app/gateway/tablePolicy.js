// gateway/tablePolicy.js: block SQL that mentions a table the caller may not see.
//
// Fail-closed text check, not a parser: the SQL is blocked if ANY identifier in it equals the
// name of a hidden table (qualified names count by their last part; strings and comments are
// ignored). A column that shares a name with a hidden table is blocked too. That is the safe
// direction. This is defense in depth: the database role is still the real boundary.

import { tokenize } from "../exampleFit.js";

export function makeGuard(hiddenTables) {
  const hidden = new Set(hiddenTables.map((t) => t.toLowerCase()));
  if (hidden.size === 0) return () => null;
  return (sql) => {
    for (const tok of tokenize(sql)) {
      if (hidden.has(tok.toLowerCase())) return `Blocked: table "${tok}" is not available to this caller.`;
    }
    return null;
  };
}
