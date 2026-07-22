import "server-only";

import { NextResponse } from "next/server";

type RateLimitOptions = {
  scope: string;
  limit: number;
  windowMs: number;
  key?: string;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const MAX_BUCKETS = 5_000;
const buckets = new Map<string, Bucket>();

function requestAddress(request: Request) {
  const direct =
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-vercel-forwarded-for");
  if (direct) return direct.split(",")[0].trim();
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}

function prune(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  while (buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next().value as string | undefined;
    if (!oldest) break;
    buckets.delete(oldest);
  }
}

export function enforceRateLimit(
  request: Request,
  { scope, limit, windowMs, key }: RateLimitOptions,
) {
  const now = Date.now();
  prune(now);
  const bucketKey = `${scope}:${requestAddress(request)}:${key ?? "request"}`;
  const existing = buckets.get(bucketKey);
  const bucket =
    existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  buckets.delete(bucketKey);
  buckets.set(bucketKey, bucket);

  if (bucket.count <= limit) return null;

  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000));
  return NextResponse.json(
    { error: "Too many requests. Please retry shortly." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "Cache-Control": "no-store",
      },
    },
  );
}
