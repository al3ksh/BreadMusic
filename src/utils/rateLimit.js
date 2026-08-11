function createFixedWindowRateLimiter({ windowMs, max, maxEntries = 5000 }) {
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new TypeError('windowMs must be positive');
  if (!Number.isFinite(max) || max <= 0) throw new TypeError('max must be positive');

  const entries = new Map();

  function prune(now) {
    if (entries.size <= maxEntries) return;
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(key);
      if (entries.size <= maxEntries) break;
    }
  }

  return {
    check(key, now = Date.now()) {
      const normalizedKey = String(key || 'unknown');
      let entry = entries.get(normalizedKey);
      if (!entry || entry.expiresAt <= now) {
        entry = { count: 0, expiresAt: now + windowMs };
      }

      entry.count += 1;
      entries.set(normalizedKey, entry);
      prune(now);

      return {
        allowed: entry.count <= max,
        retryAfterMs: Math.max(0, entry.expiresAt - now),
      };
    },
    clear() {
      entries.clear();
    },
  };
}

module.exports = { createFixedWindowRateLimiter };
