import Redis from 'ioredis';
import { env } from '../config/env';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis | null {
  if (redisClient) return redisClient;

  const redisUrl = process.env.REDIS_URL || process.env.REDIS_URI;
  if (!redisUrl) {
    console.warn('[Redis] REDIS_URL not configured, caching and socket scaling will be disabled');
    return null;
  }

  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });

    redisClient.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });

    redisClient.on('connect', () => {
      console.log('[Redis] Connected successfully');
    });

    return redisClient;
  } catch (error) {
    console.error('[Redis] Failed to initialize client:', error);
    return null;
  }
}

export async function connectRedis(): Promise<Redis | null> {
  const client = getRedisClient();
  if (!client) return null;

  try {
    await client.connect();
    return client;
  } catch (error) {
    console.error('[Redis] Failed to connect:', error);
    return null;
  }
}

export function isRedisAvailable(): boolean {
  return getRedisClient() !== null;
}

export default getRedisClient;