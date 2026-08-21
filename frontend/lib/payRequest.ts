export type PayRequestAsset = "USDC" | "EURC";
export type PayRequestStatus = "open" | "paid" | "cancelled" | "expired";

export type PayRequest = {
  id: string;
  asset: PayRequestAsset;
  amount: string;
  recipient: string;
  recipientDomain?: string;
  memo?: string;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  status: PayRequestStatus;
  paidBy?: string;
  txHash?: string;
};

export type StoredPayRequest = PayRequest & {
  manageTokenHash: string;
};

export const PAY_REQUEST_ID_PREFIX = "rq_";
export const MAX_PAY_REQUEST_AMOUNT = 1_000_000;
export const MAX_PAY_REQUEST_MEMO = 120;
export const DEFAULT_EXPIRY_SECONDS = 7 * 24 * 60 * 60;
export const PAY_REQUEST_EXPIRY_OPTIONS = [
  { label: "24 hours", seconds: 24 * 60 * 60 },
  { label: "7 days", seconds: DEFAULT_EXPIRY_SECONDS },
  { label: "30 days", seconds: 30 * 24 * 60 * 60 },
] as const;

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

export function isPayRequestAsset(value: unknown): value is PayRequestAsset {
  return value === "USDC" || value === "EURC";
}

export function isStoredPayRequestId(value: string) {
  return /^rq_[a-f0-9]{16}$/i.test(value.trim());
}

export function normalizeDomainLabel(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\.(?:lendora|arclend|arc)$/, "");
  if (!DOMAIN_RE.test(normalized)) return null;
  return normalized;
}

export function displayPayDomain(name: string) {
  const label = normalizeDomainLabel(name);
  return label ? `${label}.lendora` : "";
}

export function parsePayAmount(value: string) {
  const trimmed = value.trim();
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(trimmed)) return null;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_PAY_REQUEST_AMOUNT) {
    return null;
  }
  return trimmed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

export function sanitizePayMemo(value: unknown) {
  if (typeof value !== "string") return undefined;
  const memo = value.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  if (!memo) return undefined;
  return memo.slice(0, MAX_PAY_REQUEST_MEMO);
}

export function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newPayRequestId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `${PAY_REQUEST_ID_PREFIX}${toHex(bytes)}`;
}

export function newManageToken() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export function publicPayRequest(
  request: StoredPayRequest | PayRequest,
): PayRequest {
  return {
    id: request.id,
    asset: request.asset,
    amount: request.amount,
    recipient: request.recipient,
    recipientDomain: request.recipientDomain,
    memo: request.memo,
    createdBy: request.createdBy,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    status: effectivePayRequestStatus(request),
    paidBy: request.paidBy,
    txHash: request.txHash,
  };
}

export function effectivePayRequestStatus(
  request: Pick<PayRequest, "status" | "expiresAt">,
): PayRequestStatus {
  if (request.status === "open" && Date.now() >= request.expiresAt) {
    return "expired";
  }
  return request.status;
}

export function payRequestPath(request: {
  id?: string;
  stored?: boolean;
  recipient: string;
  recipientDomain?: string;
  amount: string;
  asset: PayRequestAsset;
  memo?: string;
}) {
  if (request.stored && request.id && isStoredPayRequestId(request.id)) {
    return `/pay/${request.id}`;
  }
  const params = new URLSearchParams({
    a: request.amount,
    t: request.asset,
    to: request.recipient,
  });
  if (request.memo) params.set("m", request.memo);
  const domain = request.recipientDomain
    ? displayPayDomain(request.recipientDomain)
    : "";
  if (domain) return `/pay/${domain}?${params.toString()}`;
  return `/pay/${request.recipient}?${params.toString()}`;
}

export function fallbackPayRequestFromSearch(input: {
  ref: string;
  amount?: string | string[];
  asset?: string | string[];
  memo?: string | string[];
  to?: string | string[];
}): PayRequest | null {
  const first = (value?: string | string[]) =>
    Array.isArray(value) ? value[0] : value;
  const amount = parsePayAmount(first(input.amount) ?? "");
  const assetRaw = (first(input.asset) ?? "USDC").toUpperCase();
  if (!amount || !isPayRequestAsset(assetRaw)) return null;

  const domain = normalizeDomainLabel(input.ref);
  const to = first(input.to)?.trim();
  const recipient = to && /^0x[a-fA-F0-9]{40}$/.test(to) ? to : "";
  if (!domain && !recipient) return null;

  return {
    id: `link:${domain ?? recipient.toLowerCase()}`,
    asset: assetRaw,
    amount,
    recipient: recipient || "0x0000000000000000000000000000000000000000",
    recipientDomain: domain ? `${domain}.lendora` : undefined,
    memo: sanitizePayMemo(first(input.memo)),
    createdBy: recipient || "0x0000000000000000000000000000000000000000",
    createdAt: Date.now(),
    expiresAt: Date.now() + DEFAULT_EXPIRY_SECONDS * 1000,
    status: "open",
  };
}

export function paySiteOrigin() {
  if (typeof window !== "undefined") return window.location.origin;
  const production =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null);
  return production ?? "https://lendora-alpha.vercel.app";
}

export function absolutePayUrl(path: string) {
  return `${paySiteOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}

export function truncatePayAddress(address: string) {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatPayExpiry(expiresAt: number) {
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return "Expired";
  const hours = Math.round(remaining / (60 * 60 * 1000));
  if (hours < 48) return `${Math.max(1, hours)}h left`;
  const days = Math.round(hours / 24);
  return `${days}d left`;
}
