const windows = new Map<string, { count: number; reset: number }>();

/** Development limiter only; production must use a shared Redis/edge-backed limiter. */
export function rateLimit(key: string, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  const current = windows.get(key);
  if (!current || current.reset <= now) {
    windows.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}
