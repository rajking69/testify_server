import { getRedisClient, isRedisAvailable } from './redis';

interface CacheOptions {
  ttl?: number; // TTL in seconds
  keyPrefix?: string;
}

/**
 * Generic cache-aside wrapper for read-heavy data
 * @param key - Cache key
 * @param fetcher - Async function to fetch data on cache miss
 * @param options - Cache options (TTL, key prefix)
 */
export async function getOrSetCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: CacheOptions = {}
): Promise<T> {
  const { ttl = 300, keyPrefix = 'testify:cache' } = options; // Default 5 min TTL
  const fullKey = `${keyPrefix}:${key}`;

  // Try cache first if Redis is available
  if (isRedisAvailable()) {
    try {
      const redis = getRedisClient();
      if (redis) {
        const cached = await redis.get(fullKey);
        if (cached) {
          return JSON.parse(cached) as T;
        }
      }
    } catch (error) {
      console.warn('[Cache] Redis error on get, falling back to DB:', error);
    }
  }

  // Cache miss - fetch from database
  const data = await fetcher();

  // Store in cache if Redis is available
  if (isRedisAvailable()) {
    try {
      const redis = getRedisClient();
      if (redis) {
        await redis.setex(fullKey, ttl, JSON.stringify(data));
      }
    } catch (error) {
      console.warn('[Cache] Redis error on set:', error);
    }
  }

  return data;
}

/**
 * Invalidate a specific cache key
 */
export async function invalidateCache(key: string, keyPrefix: string = 'testify:cache'): Promise<void> {
  if (!isRedisAvailable()) return;

  try {
    const redis = getRedisClient();
    if (redis) {
      await redis.del(`${keyPrefix}:${key}`);
    }
  } catch (error) {
    console.warn('[Cache] Redis error on invalidate:', error);
  }
}

/**
 * Invalidate multiple cache keys by pattern
 */
export async function invalidateCachePattern(pattern: string, keyPrefix: string = 'testify:cache'): Promise<void> {
  if (!isRedisAvailable()) return;

  try {
    const redis = getRedisClient();
    if (redis) {
      const keys = await redis.keys(`${keyPrefix}:${pattern}`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
  } catch (error) {
    console.warn('[Cache] Redis error on pattern invalidate:', error);
  }
}

/**
 * Cache keys for different data types
 */
export const CacheKeys = {
  // Subjects
  SUBJECTS: 'subjects',
  
  // Plans
  PLANS: 'plans',
  PLANS_BY_ROLE: (role: string) => `plans:${role}`,
  
  // Admin analytics
  ADMIN_DASHBOARD: 'admin:dashboard',
  ADMIN_ANALYTICS: 'admin:analytics',
  
  // Teacher revenue
  TEACHER_REVENUE: (teacherId: string) => `teacher:revenue:${teacherId}`,
};

/**
 * Default TTLs in seconds
 */
export const CacheTTL = {
  SHORT: 60,        // 1 minute
  MEDIUM: 300,      // 5 minutes
  LONG: 1800,       // 30 minutes
  VERY_LONG: 3600,  // 1 hour
};