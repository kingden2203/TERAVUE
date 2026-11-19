/** Tiny TTL cache with in-flight de-duplication and stale-on-error fallback. */
export class TTLCache {
  constructor(ttlMs, max = 5000) {
    this.ttl = ttlMs;
    this.max = max;
    this.m = new Map();
    this.inflight = new Map();
  }

  get(k, allowStale = false) {
    const e = this.m.get(k);
    if (!e) return undefined;
    if (!allowStale && Date.now() - e.t > this.ttl) return undefined;
    return e.v;
  }

  set(k, v) {
    if (this.m.size >= this.max) this.m.delete(this.m.keys().next().value);
    this.m.set(k, { v, t: Date.now() });
  }

  async wrap(k, fn) {
    const hit = this.get(k);
    if (hit !== undefined) return hit;
    if (this.inflight.has(k)) return this.inflight.get(k);
    const p = (async () => {
      try {
        const v = await fn();
        this.set(k, v);
        return v;
      } catch (err) {
        const stale = this.get(k, true);
        if (stale !== undefined) return stale;
        throw err;
      } finally {
        this.inflight.delete(k);
      }
    })();
    this.inflight.set(k, p);
    return p;
  }
}
