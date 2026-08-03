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
  return parts.filter(Boolean).join(" <- caused by: ") || String(exc);
}
