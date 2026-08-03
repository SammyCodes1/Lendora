import { Redis } from "@upstash/redis";

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    const url = process.env.UPSTASH_REDIS_URL;
    const token = process.env.UPSTASH_REDIS_TOKEN;
    if (!url || !token) {
      throw new Error("UPSTASH_REDIS_URL and UPSTASH_REDIS_TOKEN are required");
    }
    redis = new Redis({ url, token });
  }
  return redis;
}
