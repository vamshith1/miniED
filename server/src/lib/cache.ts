import { Redis } from "ioredis";
import { env } from "../config/env.js";

/**
 * Small cache with two backends:
 *  - Redis, when REDIS_URL is set and reachable (Docker / production)
 *  - an in-memory Map otherwise, so the app still works on a machine
 *    without Redis. It's fine for one process, but isn't shared between
 *    servers, so production should always use Redis.
 */
interface CacheDriver {
  name: "redis" | "memory";
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(keys: string[]): Promise<void>;
}

class MemoryDriver implements CacheDriver {
  name = "memory" as const;
  private store = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string) {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return hit.value;
  }
  async set(key: string, value: string, ttlSeconds: number) {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
  async del(keys: string[]) {
    keys.forEach((k) => this.store.delete(k));
  }
}

class RedisDriver implements CacheDriver {
  name = "redis" as const;
  constructor(private client: Redis) {}
  get(key: string) {
    return this.client.get(key);
  }
  async set(key: string, value: string, ttlSeconds: number) {
    await this.client.set(key, value, "EX", ttlSeconds);
  }
  async del(keys: string[]) {
    if (keys.length) await this.client.del(...keys);
  }
}

let driver: CacheDriver = new MemoryDriver();
export let redis: Redis | null = null;

// Call once at startup. Tries Redis for up to 2 seconds, then falls back to memory.
export async function initCache() {
  if (!env.REDIS_URL) {
    console.warn("Cache: REDIS_URL not set, using in-memory cache");
    return driver.name;
  }
  const client = new Redis(env.REDIS_URL, { lazyConnect: true, connectTimeout: 2000, maxRetriesPerRequest: 1 });
  try {
    await client.connect();
    await client.ping();
    redis = client;
    driver = new RedisDriver(client);
    console.log("Cache: connected to Redis");
  } catch {
    client.disconnect();
    console.warn(`Cache: Redis not reachable at ${env.REDIS_URL}, using in-memory cache`);
  }
  return driver.name;
}

export const cacheDriverName = () => driver.name;

/**
 * Returns the cached value for `key`, or runs `load()`, caches the result
 * for `ttlSeconds` and returns it. `hit` says which one happened.
 * If the cache itself fails, it falls back to `load()`: a cache problem
 * should slow the app down, not break it.
 */
export async function getOrSet<T>(key: string, ttlSeconds: number, load: () => Promise<T>) {
  try {
    const cached = await driver.get(key);
    if (cached !== null) return { value: JSON.parse(cached) as T, hit: true };
  } catch (err) {
    console.error("Cache read failed:", err);
  }
  const value = await load();
  try {
    await driver.set(key, JSON.stringify(value), ttlSeconds);
  } catch (err) {
    console.error("Cache write failed:", err);
  }
  return { value, hit: false };
}

export async function invalidate(...keys: string[]) {
  try {
    await driver.del(keys);
  } catch (err) {
    console.error("Cache invalidation failed:", err);
  }
}

// All cache keys in one place, so the code that writes data and the
// code that reads it always agree on names.
export const cacheKeys = {
  quizLeaderboard: (quizId: string) => `lb:quiz:${quizId}`,
  batchLeaderboard: (batchId: string) => `lb:batch:${batchId}`,
  dashboardStats: () => "dashboard:stats",
};
