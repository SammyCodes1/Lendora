import "server-only";

import { Redis } from "@upstash/redis";

let redis: Redis | null = null;

const URL_KEYS = [
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_URL",
  "KV_REST_API_URL",
] as const;

const TOKEN_KEYS = [
  "UPSTASH_REDIS_REST_TOKEN",
  "UPSTASH_REDIS_TOKEN",
  "KV_REST_API_TOKEN",
] as const;

/**
 * Read env by key at runtime. Dynamic lookup avoids Next/webpack inlining
 * `process.env.UPSTASH_*` to undefined when the secret was not present at
 * build time (Vercel "Sensitive" production vars).
 */
function readEnv(keys: readonly string[]): string | undefined {
  const env = process.env;
  for (const key of keys) {
    const raw = env[key];
    if (typeof raw !== "string") continue;
    const value = raw.trim().replace(/^["']|["']$/g, "");
    if (value && value !== "[SENSITIVE]") return value;
  }
  return undefined;
}

export function getRedis(): Redis {
  if (!redis) {
    const url = readEnv(URL_KEYS);
    const token = readEnv(TOKEN_KEYS);
    if (!url || !token) {
      throw new Error(
        "Redis env is missing. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or UPSTASH_REDIS_URL and UPSTASH_REDIS_TOKEN) on the server.",
      );
    }
    redis = new Redis({ url, token });
  }
  return redis;
}
