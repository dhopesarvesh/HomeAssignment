// Metrics registry for Prometheus monitoring
const metrics = {
  httpRequestsTotal: new Map(), // key: "method:path:status" -> count
  httpRequestDurationSeconds: [], // array of { method, path, durationMs }
  bookingAttemptsTotal: 0,
  bookingSuccessTotal: 0,
  bookingConflictTotal: 0,
  idempotencyReplaysTotal: 0,
};

export function recordHttpRequest(method, path, status, durationMs) {
  // Normalize path to prevent high cardinality (e.g. replace UUIDs with :id)
  const normalizedPath = path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id");
  const key = `${method}:${normalizedPath}:${status}`;
  metrics.httpRequestsTotal.set(key, (metrics.httpRequestsTotal.get(key) || 0) + 1);

  if (metrics.httpRequestDurationSeconds.length > 500) {
    metrics.httpRequestDurationSeconds.shift();
  }
  metrics.httpRequestDurationSeconds.push({ method, path: normalizedPath, durationMs });
}

export function recordBookingAttempt() {
  metrics.bookingAttemptsTotal++;
}

export function recordBookingSuccess() {
  metrics.bookingSuccessTotal++;
}

export function recordBookingConflict() {
  metrics.bookingConflictTotal++;
}

export function recordIdempotencyReplay() {
  metrics.idempotencyReplaysTotal++;
}

export function getPrometheusMetrics() {
  const lines = [];

  lines.push("# HELP http_requests_total Total number of HTTP requests processed");
  lines.push("# TYPE http_requests_total counter");
  for (const [key, count] of metrics.httpRequestsTotal.entries()) {
    const [method, path, status] = key.split(":");
    lines.push(`http_requests_total{method="${method}",path="${path}",status="${status}"} ${count}`);
  }

  lines.push("\n# HELP booking_attempts_total Total appointment booking attempts");
  lines.push("# TYPE booking_attempts_total counter");
  lines.push(`booking_attempts_total ${metrics.bookingAttemptsTotal}`);

  lines.push("\n# HELP booking_success_total Successful appointment bookings");
  lines.push("# TYPE booking_success_total counter");
  lines.push(`booking_success_total ${metrics.bookingSuccessTotal}`);

  lines.push("\n# HELP booking_conflicts_total Slot booking conflicts encountered");
  lines.push("# TYPE booking_conflicts_total counter");
  lines.push(`booking_conflicts_total ${metrics.bookingConflictTotal}`);

  lines.push("\n# HELP idempotency_replays_total Number of idempotent cached responses replayed");
  lines.push("# TYPE idempotency_replays_total counter");
  lines.push(`idempotency_replays_total ${metrics.idempotencyReplaysTotal}`);

  return lines.join("\n") + "\n";
}
