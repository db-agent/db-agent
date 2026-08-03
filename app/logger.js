// logger.js — every log line gets a timestamp prefix, so wall-clock timing
// (e.g. "how long did text-to-SQL take end to end?") can be read straight
// off the log rather than requiring the app to compute and report
// durations itself. Deliberately just a timestamp prefix, not a logging
// framework — this app has one process, one log stream (stdout), no need
// for levels/transports/structured fields beyond what's already useful.

function timestamp() {
  return new Date().toISOString();
}

export function log(message) {
  console.log(`[${timestamp()}] ${message}`);
}

export function warn(message) {
  console.warn(`[${timestamp()}] ${message}`);
}

// Two things swallow the real reason behind a network/connection failure
// if you only read .message:
//   - AggregateError (Node's `pg`, and Node's own fetch on multi-attempt
//     connects) has an empty/unhelpful top-level .message, with the actual
//     reason (ECONNREFUSED, etc.) buried in .errors[].
//   - The OpenAI SDK's APIConnectionError always says exactly "Connection
//     error." and puts the real underlying error (frequently itself a
//     multi-level chain — a fetch TypeError wrapping a TLS/DNS/ECONNREFUSED
//     cause) on .cause, which callLlm()'s `describeError(exc)` was
//     discarding entirely. Found this while debugging a deployed app where
//     every LLM call failed with only "Connection error." in the logs —
//     no way to tell network egress, DNS, TLS, and auth failures apart.
// This walks both: the full .cause chain, unwrapping any AggregateError
// found at each level, and joins every level into one message so nothing
// in the chain is lost.
// Some errors embed the literal value that caused them — notably
// undici/fetch's "X is not a legal HTTP header value", which puts the
// full "Bearer <token>" string straight into .message. Redact anything
// that looks like a bearer token or a Databricks PAT (dapi...) before
// this ever reaches a log line, since logs (CI output, `databricks apps
// logs`) are far more widely readable than the process that raised it.
function redactSecrets(text) {
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bdapi[0-9a-f]{20,}\b/gi, "[redacted]");
}

export function describeError(exc) {
  const parts = [];
  let current = exc;
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current.errors?.length) {
      parts.push(current.errors.map((e) => e.message || String(e)).join("; "));
    } else if (current.message) {
      parts.push(current.message);
    } else {
      parts.push(String(current));
    }
    current = current.cause;
  }
  const joined = parts.filter(Boolean).join(" <- caused by: ") || String(exc);
  return redactSecrets(joined);
}
