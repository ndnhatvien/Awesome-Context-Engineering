/**
 * Adaptive Replacement Cache (ARC)
 *
 * Invented by Nimrod Megiddo & Dharmendra S. Modha (IBM Almaden Research Center).
 *
 * Advantages over standard LRU:
 * 1. Self-tuning between Recency (T1) and Frequency (T2) via target size p
 * 2. Scan-resistant: broad scans do not wipe out frequent items
 * 3. Ghost histories (B1, B2) track evicted keys to learn optimal cache allocation
 */

export interface ArcCacheStats {
  capacity: number;
  size: number;
  hits: number;
  misses: number;
  hitRatio: number;
  p: number;
  t1Size: number;
  t2Size: number;
  b1Size: number;
  b2Size: number;
}

export interface ArcCacheOptions<K, V> {
  capacity: number;
  defaultTtlMs?: number;
  onEvict?: (key: K, value: V) => void;
}

interface CacheEntry<V> {
  value: V;
  expiresAt?: number;
}

interface GhostEntry {
  expiresAt?: number;
}

export class AdaptiveReplacementCache<K, V> {
  private readonly capacity: number;
  private readonly defaultTtlMs?: number;
  private readonly onEvict?: (key: K, value: V) => void;

  // T1: Recent entries currently in cache
  private readonly t1 = new Map<K, CacheEntry<V>>();
  // T2: Frequent entries currently in cache (hit >= 2 times)
  private readonly t2 = new Map<K, CacheEntry<V>>();
  // B1: Ghost history of evicted recent keys
  private readonly b1 = new Map<K, GhostEntry>();
  // B2: Ghost history of evicted frequent keys
  private readonly b2 = new Map<K, GhostEntry>();

  // Learning target parameter for T1 size (0 <= p <= capacity)
  private p = 0;

  // Metrics
  private hits = 0;
  private misses = 0;

  constructor(options: ArcCacheOptions<K, V> | number) {
    if (typeof options === 'number') {
      if (options <= 0) {
        throw new Error('ARC cache capacity must be greater than 0');
      }
      this.capacity = options;
    } else {
      if (options.capacity <= 0) {
        throw new Error('ARC cache capacity must be greater than 0');
      }
      this.capacity = options.capacity;
      this.defaultTtlMs = options.defaultTtlMs;
      this.onEvict = options.onEvict;
    }
  }

  /**
   * Retrieves a value from the cache.
   * If found in T1, promotes it to T2 (frequency boost).
   * If found in T2, refreshes its position at MRU of T2.
   */
  get(key: K): V | undefined {
    const now = Date.now();

    // Check T1 (Recent)
    const entryT1 = this.t1.get(key);
    if (entryT1 !== undefined) {
      if (entryT1.expiresAt && now > entryT1.expiresAt) {
        this.t1.delete(key);
        this.misses++;
        return undefined;
      }

      // Hit in T1: promote to T2 (frequency)
      this.t1.delete(key);
      this.t2.set(key, entryT1);
      this.hits++;
      return entryT1.value;
    }

    // Check T2 (Frequent)
    const entryT2 = this.t2.get(key);
    if (entryT2 !== undefined) {
      if (entryT2.expiresAt && now > entryT2.expiresAt) {
        this.t2.delete(key);
        this.misses++;
        return undefined;
      }

      // Hit in T2: re-insert at MRU
      this.t2.delete(key);
      this.t2.set(key, entryT2);
      this.hits++;
      return entryT2.value;
    }

    // Cache Miss
    this.misses++;
    return undefined;
  }

  /**
   * Sets or updates a value in the cache with ARC adaptation.
   */
  set(key: K, value: V, ttlMs?: number): this {
    const effectiveTtl = ttlMs ?? this.defaultTtlMs;
    const expiresAt = effectiveTtl ? Date.now() + effectiveTtl : undefined;
    const entry: CacheEntry<V> = { value, expiresAt };

    // Case 1: Key already in T1
    if (this.t1.has(key)) {
      this.t1.delete(key);
      this.t2.set(key, entry);
      return this;
    }

    // Case 2: Key already in T2
    if (this.t2.has(key)) {
      this.t2.delete(key);
      this.t2.set(key, entry);
      return this;
    }

    // Case 3: Key in B1 (ghost recency hit -> enlarge T1 target p)
    if (this.b1.has(key)) {
      const delta =
        this.b1.size >= this.b2.size
          ? 1
          : Math.max(1, Math.floor(this.b2.size / Math.max(1, this.b1.size)));
      this.p = Math.min(this.capacity, this.p + delta);
      this.replace(key);
      this.b1.delete(key);
      this.t2.set(key, entry);
      return this;
    }

    // Case 4: Key in B2 (ghost frequency hit -> shrink T1 target p)
    if (this.b2.has(key)) {
      const delta =
        this.b2.size >= this.b1.size
          ? 1
          : Math.max(1, Math.floor(this.b1.size / Math.max(1, this.b2.size)));
      this.p = Math.max(0, this.p - delta);
      this.replace(key);
      this.b2.delete(key);
      this.t2.set(key, entry);
      return this;
    }

    // Case 5: Key completely absent from T1, T2, B1, B2
    const l1Size = this.t1.size + this.b1.size;
    const totalSize = l1Size + this.t2.size + this.b2.size;

    if (l1Size === this.capacity) {
      if (this.t1.size < this.capacity) {
        // Evict LRU of B1
        this.evictLru(this.b1);
        this.replace(key);
      } else {
        // Evict LRU of T1 and preserve in B1 ghost history
        const evicted = this.evictLruWithCallback(this.t1);
        if (evicted) {
          if (this.b1.size >= this.capacity) {
            this.evictLru(this.b1);
          }
          this.b1.set(evicted.key, { expiresAt: evicted.value.expiresAt });
          if (this.onEvict) {
            this.onEvict(evicted.key, evicted.value.value);
          }
        }
      }
    } else if (l1Size < this.capacity && totalSize >= this.capacity) {
      if (totalSize === 2 * this.capacity) {
        // Evict LRU of B2
        this.evictLru(this.b2);
      }
      this.replace(key);
    }

    // Place into T1 (recent)
    this.t1.set(key, entry);
    return this;
  }

  /**
   * ARC Replace routine: decides whether to evict from T1 or T2 based on target p.
   */
  private replace(key: K): void {
    if (
      this.t1.size > 0 &&
      (this.t1.size > this.p || (this.b2.has(key) && this.t1.size === this.p))
    ) {
      // Evict LRU from T1 to B1
      const evicted = this.evictLruWithCallback(this.t1);
      if (evicted) {
        this.b1.set(evicted.key, { expiresAt: evicted.value.expiresAt });
        if (this.onEvict) {
          this.onEvict(evicted.key, evicted.value.value);
        }
      }
    } else if (this.t2.size > 0) {
      // Evict LRU from T2 to B2
      const evicted = this.evictLruWithCallback(this.t2);
      if (evicted) {
        this.b2.set(evicted.key, { expiresAt: evicted.value.expiresAt });
        if (this.onEvict) {
          this.onEvict(evicted.key, evicted.value.value);
        }
      }
    }
  }

  /**
   * Evicts the oldest (first) item from a map.
   */
  private evictLru<T>(map: Map<K, T>): K | undefined {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) {
      map.delete(oldestKey);
      return oldestKey;
    }
    return undefined;
  }

  /**
   * Evicts the oldest item from a cache entry map and returns key & value.
   */
  private evictLruWithCallback(
    map: Map<K, CacheEntry<V>>,
  ): { key: K; value: CacheEntry<V> } | undefined {
    const iter = map.entries().next();
    if (!iter.done) {
      const [key, value] = iter.value;
      map.delete(key);
      return { key, value };
    }
    return undefined;
  }

  /**
   * Checks if key exists and is unexpired.
   */
  has(key: K): boolean {
    const now = Date.now();
    const entryT1 = this.t1.get(key);
    if (entryT1 !== undefined) {
      if (entryT1.expiresAt && now > entryT1.expiresAt) {
        this.t1.delete(key);
        return false;
      }
      return true;
    }

    const entryT2 = this.t2.get(key);
    if (entryT2 !== undefined) {
      if (entryT2.expiresAt && now > entryT2.expiresAt) {
        this.t2.delete(key);
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * Peeks value without modifying ARC recency or frequency.
   */
  peek(key: K): V | undefined {
    const now = Date.now();
    const entryT1 = this.t1.get(key);
    if (entryT1 !== undefined) {
      if (entryT1.expiresAt && now > entryT1.expiresAt) {
        this.t1.delete(key);
        return undefined;
      }
      return entryT1.value;
    }

    const entryT2 = this.t2.get(key);
    if (entryT2 !== undefined) {
      if (entryT2.expiresAt && now > entryT2.expiresAt) {
        this.t2.delete(key);
        return undefined;
      }
      return entryT2.value;
    }

    return undefined;
  }

  /**
   * Deletes a key from all lists.
   */
  delete(key: K): boolean {
    let deleted = false;
    if (this.t1.delete(key)) deleted = true;
    if (this.t2.delete(key)) deleted = true;
    this.b1.delete(key);
    this.b2.delete(key);
    return deleted;
  }

  /**
   * Clears all cache entries and ghost histories.
   */
  clear(): void {
    this.t1.clear();
    this.t2.clear();
    this.b1.clear();
    this.b2.clear();
    this.p = 0;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Current active entries count in cache (|T1| + |T2|).
   */
  get size(): number {
    return this.t1.size + this.t2.size;
  }

  /**
   * Cache telemetry statistics.
   */
  getStats(): ArcCacheStats {
    const totalRequests = this.hits + this.misses;
    const hitRatio = totalRequests > 0 ? this.hits / totalRequests : 0;

    return {
      capacity: this.capacity,
      size: this.size,
      hits: this.hits,
      misses: this.misses,
      hitRatio: Number(hitRatio.toFixed(4)),
      p: this.p,
      t1Size: this.t1.size,
      t2Size: this.t2.size,
      b1Size: this.b1.size,
      b2Size: this.b2.size,
    };
  }

  /**
   * Returns all active keys in cache.
   */
  keys(): K[] {
    return [...this.t1.keys(), ...this.t2.keys()];
  }
}
