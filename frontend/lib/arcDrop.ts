// Shared ArcDrop types and helpers used by both the dashboard create page
// and the public claim page.

export type DropMode = 0 | 1; // 0 = EQUAL_SPLIT, 1 = CLAIM_ALL
export const DROP_MODE_EQUAL_SPLIT: DropMode = 0;
export const DROP_MODE_CLAIM_ALL: DropMode = 1;

export type DropAsset = "USDC" | "EURC";

export type DropClaim = {
  claimant: string;
  amount: string;
  claimantsCount: string;
  txHash: string;
  blockNumber: string;
};

/** Shape returned by GET /api/drop/[slug] */
export type ApiDrop = {
  dropId: number;
  contract?: string;
  allowlistEnabled?: boolean;
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
  claims?: DropClaim[];
};

export const ARCSCAN_ADDRESS_BASE = "https://testnet.arcscan.app/address/";

export function truncateDropAddress(address: string) {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

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

/** Hosts that serve the same Lendrop app and share Redis slugs. */
export const DROP_SHARE_ORIGINS = [
  "https://www.arclend.cv",
  "https://lendora-alpha.vercel.app",
] as const;

export function dropPath(slug: string) {
  return `/drop/${encodeURIComponent(slug)}`;
}

export function dropUrlOnOrigin(origin: string, slug: string) {
  return `${origin.replace(/\/$/, "")}${dropPath(slug)}`;
}

export function allDropShareUrls(slug: string) {
  return DROP_SHARE_ORIGINS.map((origin) => dropUrlOnOrigin(origin, slug));
}

export function clientDropUrl(slug: string) {
  if (typeof window !== "undefined") {
    return dropUrlOnOrigin(window.location.origin, slug);
  }
  return dropUrlOnOrigin(DROP_SHARE_ORIGINS[0], slug);
}

function originFromHost(hostHeader: string | null | undefined): string | null {
  if (!hostHeader) return null;
  const host = hostHeader.split(",")[0]!.trim().toLowerCase();
  const hostname = host.replace(/:\d+$/, "");
  if (hostname === "www.arclend.cv" || hostname === "arclend.cv") {
    return "https://www.arclend.cv";
  }
  if (hostname === "lendora-alpha.vercel.app") {
    return "https://lendora-alpha.vercel.app";
  }
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `http://${host}`;
  }
  return null;
}

/** Prefer the host the user is on so copied links match that domain. */
export function dropOriginFromRequest(request: Request): string {
  const originHeader = request.headers.get("origin");
  if (originHeader) {
    try {
      const mapped = originFromHost(new URL(originHeader).host);
      if (mapped) return mapped;
    } catch {
      // ignore invalid Origin
    }
  }
  const forwarded =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  return originFromHost(forwarded) ?? DROP_SHARE_ORIGINS[0];
}

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

export const LENDROP_MY_DROPS_KEY = "lendora:arcdrop:my-drops";
export const LENDROP_MY_DROPS_CAP = 50;
export const DEFAULT_LENDROP_EXPIRY_SECONDS = 7 * 24 * 60 * 60;
export const MAX_LENDROP_EXPIRY_SECONDS = 90 * 24 * 60 * 60;
export const MAX_LENDROP_CLAIMANTS = 10_000;
export const MAX_LENDROP_ALLOWLIST = 200;

export type SavedLendrop = {
  dropId: number;
  slug: string;
  url: string;
  asset: DropAsset;
  totalAmount: string;
  mode: DropMode;
  maxClaimants: number;
  expiresAt: number;
  createdAt: number;
  remainingAmount?: string;
  claimantsCount?: number;
  active?: boolean;
  contract?: string;
  allowlistCount?: number;
};

export function readSavedLendrops(): SavedLendrop[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LENDROP_MY_DROPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedLendrop[];
    return Array.isArray(parsed) ? parsed.slice(0, LENDROP_MY_DROPS_CAP) : [];
  } catch {
    return [];
  }
}

export function writeSavedLendrops(rows: SavedLendrop[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    LENDROP_MY_DROPS_KEY,
    JSON.stringify(rows.slice(0, LENDROP_MY_DROPS_CAP)),
  );
}

export function prependSavedLendrop(drop: SavedLendrop) {
  const next = [
    drop,
    ...readSavedLendrops().filter((row) => row.dropId !== drop.dropId),
  ];
  writeSavedLendrops(next);
  return next;
}

export function formatLendropExpiry(expirySeconds: number) {
  if (expirySeconds <= 0) return "Never";
  const known = DROP_EXPIRY_OPTIONS.find((option) => option.seconds === expirySeconds);
  if (known) return known.label;
  if (expirySeconds % (24 * 60 * 60) === 0) {
    const days = expirySeconds / (24 * 60 * 60);
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (expirySeconds % 3600 === 0) {
    const hours = expirySeconds / 3600;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${expirySeconds} seconds`;
}
