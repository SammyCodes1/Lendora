// Shared ArcDrop types and helpers used by both the dashboard create page
// and the public claim page.

export type DropMode = 0 | 1; // 0 = EQUAL_SPLIT, 1 = CLAIM_ALL
export const DROP_MODE_EQUAL_SPLIT: DropMode = 0;
export const DROP_MODE_CLAIM_ALL: DropMode = 1;

export type DropAsset = "USDC" | "EURC";

/** Shape returned by GET /api/drop/[slug] */
export type ApiDrop = {
  dropId: number;
  drop: {
    creator: string;
    asset: string; // hex address
    totalAmount: string; // bigint as string
    remainingAmount: string;
    mode: DropMode;
    maxClaimants: string;
    claimantsCount: string;
    perClaimAmount: string;
    active: boolean;
    createdAt: string;
    expiresAt: string; // "0" = no expiry
  };
};

export type DropStatus =
  | "active"
  | "fully_claimed"
  | "cancelled"
  | "expired";

/** 6-decimal token amounts → human-readable string */
export function formatDropAmount(raw: string, digits = 2): string {
  const n = BigInt(raw);
  const whole = n / 1_000_000n;
  const frac = n % 1_000_000n;
  const fracStr = frac.toString().padStart(6, "0").slice(0, digits);
  return `${whole.toLocaleString()}.${fracStr}`.replace(/\.?0+$/, "") || "0";
}

/** Human-readable string → 6-decimal bigint */
export function parseDropAmount(value: string): bigint | null {
  const trimmed = value.trim().replace(/,/g, "");
  if (!trimmed || !/^(?:\d+|\d*\.\d{0,6})$/.test(trimmed)) return null;
  try {
    const [whole = "0", frac = ""] = trimmed.split(".");
    const padded = frac.padEnd(6, "0").slice(0, 6);
    const result = BigInt(whole) * 1_000_000n + BigInt(padded);
    return result > 0n ? result : null;
  } catch {
    return null;
  }
}

export const ARCSCAN_TX_BASE = "https://testnet.arcscan.app/tx/";

export function effectiveDropStatus(drop: ApiDrop["drop"]): DropStatus {
  if (!drop.active) {
    // Distinguish cancelled vs fully-claimed by checking remainingAmount.
    // A cancelled drop has remainingAmount > 0 unless every slot happened to
    // be claimed in the same block — but the contract emits the right reason
    // in the DropClosed event. Since we don't have event logs here, we use
    // a heuristic: if claimantsCount == maxClaimants it was fully claimed.
    const claimed = BigInt(drop.claimantsCount);
    const max = BigInt(drop.maxClaimants);
    const remaining = BigInt(drop.remainingAmount);
    if (remaining === 0n || claimed >= max) return "fully_claimed";
    return "cancelled";
  }
  if (
    drop.expiresAt !== "0" &&
    Date.now() / 1000 >= Number(drop.expiresAt)
  ) {
    return "expired";
  }
  return "active";
}

export const DROP_EXPIRY_OPTIONS = [
  { label: "24 hours", seconds: 24 * 60 * 60 },
  { label: "7 days", seconds: 7 * 24 * 60 * 60 },
  { label: "30 days", seconds: 30 * 24 * 60 * 60 },
  { label: "Never", seconds: 0 },
] as const;
