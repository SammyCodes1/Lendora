import "server-only";

import type { Redis } from "@upstash/redis";
import { getRedis } from "@/lib/server/redis";
import { isAddress } from "viem";

// ─── Key helpers ─────────────────────────────────────────────────────────────

/** slug -> dropId */
export function dropSlugKey(slug: string) {
  return `arcdrop:slug:${slug}`;
}

/** wallet -> sorted set of dropIds (score = createdAt ms) */
export function dropWalletKey(wallet: string) {
  return `arcdrop:user:${wallet.toLowerCase()}`;
}

// ─── Slug generation ──────────────────────────────────────────────────────────

const BASE62_CHARS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SLUG_LENGTH = 8;
const SLUG_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days
const WALLET_INDEX_CAP = 50;

function generateSlug(): string {
  const bytes = new Uint8Array(SLUG_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => BASE62_CHARS[b % 62]).join("");
}

export function isValidSlug(slug: string): boolean {
  return /^[0-9A-Za-z]{6,12}$/.test(slug);
}

// ─── Redis operations ─────────────────────────────────────────────────────────

function tryGetRedis(): Redis | { error: string } {
  try {
    return getRedis();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Redis client failed to start.";
    console.error("[lendrop] redis init failed", error);
    return { error: `Redis is unavailable — ${message}` };
  }
}

export type ResolvedDropSlug = {
  dropId: number;
  contract: string | null;
};

function parseSlugValue(raw: unknown): ResolvedDropSlug | null {
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
    return { dropId: raw, contract: null };
  }
  if (typeof raw === "string") {
    const asNumber = parseInt(raw, 10);
    if (String(asNumber) === raw && asNumber > 0) {
      return { dropId: asNumber, contract: null };
    }
    try {
      return parseSlugValue(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === "object") {
    const value = raw as { dropId?: unknown; contract?: unknown };
    const dropId =
      typeof value.dropId === "number"
        ? value.dropId
        : typeof value.dropId === "string"
          ? parseInt(value.dropId, 10)
          : NaN;
    if (!Number.isInteger(dropId) || dropId < 1) return null;
    const contract =
      typeof value.contract === "string" && isAddress(value.contract)
        ? value.contract
        : null;
    return { dropId, contract };
  }
  return null;
}

/** Store slug → dropId and index the drop under the creator's wallet. */
export async function storeDropSlug(input: {
  dropId: number;
  creatorWallet: string;
  contract?: string;
}): Promise<{ slug: string } | { error: string }> {
  if (!isAddress(input.creatorWallet)) {
    return { error: "Invalid creator wallet address." };
  }
  if (!Number.isInteger(input.dropId) || input.dropId < 1) {
    return { error: "Invalid drop ID." };
  }

  const redisOrError = tryGetRedis();
  if ("error" in redisOrError) {
    return redisOrError;
  }
  const redis = redisOrError;

  try {
    // Try up to 5 times in case of slug collision (astronomically unlikely for
    // 62^8 ≈ 218 trillion combinations, but be defensive).
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = generateSlug();
      const slugKey = dropSlugKey(slug);

      // Only set if key doesn't already exist (NX = "not exists").
      const payload = input.contract
        ? { dropId: input.dropId, contract: input.contract }
        : input.dropId;
      const set = await redis.set(slugKey, payload, {
        ex: SLUG_TTL_SECONDS,
        nx: true,
      });

      if (set === null) continue; // collision, try again

      // Index under the creator's wallet (sorted set, score = now ms).
      const walletKey = dropWalletKey(input.creatorWallet);
      await redis.zadd(walletKey, {
        score: Date.now(),
        member: String(input.dropId),
      });
      // Cap the index so the wallet key doesn't grow unbounded.
      await redis.zremrangebyrank(walletKey, 0, -(WALLET_INDEX_CAP + 1));
      await redis.expire(walletKey, SLUG_TTL_SECONDS);

      return { slug };
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Redis write failed.";
    console.error("[lendrop] redis write failed", error);
    return { error: `Redis is unavailable — ${message}` };
  }

  return { error: "Could not generate a unique slug. Please try again." };
}

/** Resolve a slug to its dropId (and contract, when stored). */
export async function resolveDropSlug(
  slug: string,
): Promise<ResolvedDropSlug | null> {
  if (!isValidSlug(slug)) return null;
  const redisOrError = tryGetRedis();
  if ("error" in redisOrError) return null;
  const redis = redisOrError;
  const raw = await redis.get<unknown>(dropSlugKey(slug));
  if (raw === null || raw === undefined) return null;
  return parseSlugValue(raw);
}

/** Get all dropIds created by a wallet (most recent first). */
export async function listWalletDropIds(wallet: string): Promise<number[]> {
  if (!isAddress(wallet)) return [];
  const redisOrError = tryGetRedis();
  if ("error" in redisOrError) return [];
  const redis = redisOrError;
  // zrange with REV returns highest scores first (most recently created).
  const members = await redis.zrange<(string | number)[]>(
    dropWalletKey(wallet),
    0,
    WALLET_INDEX_CAP - 1,
    { rev: true },
  );
  return members
    .map((m) => (typeof m === "number" ? m : parseInt(String(m), 10)))
    .filter((id) => Number.isInteger(id) && id > 0);
}
