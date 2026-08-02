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
