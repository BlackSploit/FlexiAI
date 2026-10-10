import "server-only";

/**
 * In-memory token bucket (§4.3): 10 requests per 10 s per key (ip + token hash), used by join.*.
 * Per web instance; enough for a single Dokploy service.
 */
type Bucket = { tokens: number; updated: number };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

export function rateLimit(key: string, capacity = 10, windowMs = 10_000, now = Date.now()): boolean {
  const refillPerMs = capacity / windowMs;
  const b = buckets.get(key) ?? { tokens: capacity, updated: now };
  b.tokens = Math.min(capacity, b.tokens + (now - b.updated) * refillPerMs);
  b.updated = now;
  if (buckets.size > MAX_KEYS) buckets.clear();        // crude bound against unbounded growth
  buckets.set(key, b);
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

export function resetRateLimits() {
  buckets.clear();
}
