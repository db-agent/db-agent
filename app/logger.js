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

// Node's `pg` (and other libraries doing multi-attempt connects, e.g.
// trying both IPv4 and IPv6) throws an AggregateError when every attempt
// fails — its own .message is empty/unhelpful ("AggregateError"), with the
// actual reason (ECONNREFUSED, auth failure, etc.) buried in .errors[].
// Found this the hard way: a deliberately-unreachable Postgres host
// surfaced as just "AggregateError" in the UI, which is exactly the kind
// of unpredictable, unreadable error state that shouldn't reach a user.
export function describeError(exc) {
  if (exc?.errors?.length) {
    return exc.errors.map((e) => e.message || String(e)).join("; ");
  }
  return String(exc?.message || exc);
}
