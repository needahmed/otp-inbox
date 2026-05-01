import Redis from "ioredis";

let redisClient: Redis | null = null;

export function getRedis(): Redis {
  if (!redisClient) {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    redisClient = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    redisClient.on("error", (err) => {
      console.error("[Redis] Connection error:", err.message);
    });
  }
  return redisClient;
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await getRedis().set(key, JSON.stringify(value), "EX", ttlSeconds);
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await getRedis().get(key);
  if (!raw) return null;
  return JSON.parse(raw) as T;
}

export async function cacheDel(key: string): Promise<void> {
  await getRedis().del(key);
}

export async function publishEvent(channel: string, data: unknown): Promise<void> {
  await getRedis().publish(channel, JSON.stringify(data));
}
