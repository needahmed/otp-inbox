import Redis from "ioredis";

let redisClient: Redis | null = null;

function redisUrl(): string {
  return process.env.REDIS_URL ?? "redis://localhost:6379";
}

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(redisUrl(), {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    redisClient.on("error", (err) => {
      console.error("[Redis] Connection error:", err.message);
    });
  }
  return redisClient;
}

export function createRedisClient(name: string): Redis {
  const client = new Redis(redisUrl(), {
    connectionName: name,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  client.on("error", (err) => {
    console.error(`[Redis:${name}] Connection error:`, err.message);
  });

  return client;
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
