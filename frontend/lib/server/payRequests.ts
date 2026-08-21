import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import {
  createPublicClient,
  erc20Abi,
  fallback,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseEventLogs,
  parseUnits,
  type Address,
  type Hash,
} from "viem";
import { arcTestnet } from "viem/chains";
import deployments from "@/constants/deployments.json";
import { ARC_DEX_TOKENS } from "@/lib/arcDex";
import {
  DEFAULT_EXPIRY_SECONDS,
  displayPayDomain,
  effectivePayRequestStatus,
  isPayRequestAsset,
  isStoredPayRequestId,
  newManageToken,
  newPayRequestId,
  normalizeDomainLabel,
  parsePayAmount,
  payRequestPath,
  publicPayRequest,
  sanitizePayMemo,
  type PayRequest,
  type PayRequestAsset,
  type StoredPayRequest,
} from "@/lib/payRequest";
import { getRedis } from "@/lib/server/redis";

const walletDomainAddress = deployments.WalletDomain as Address;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const REQUEST_TTL_SECONDS = 40 * 24 * 60 * 60;
const WALLET_INDEX_CAP = 40;

const domainAbi = parseAbi([
  "function resolveDomain(string name) view returns (address)",
  "function primaryDomainOf(address owner) view returns (string)",
]);

const arcRpcUrls = Array.from(
  new Set(
    [
      process.env.ARC_TESTNET_RPC_URL,
      process.env.NEXT_PUBLIC_RPC_URL,
      ...arcTestnet.rpcUrls.default.http,
      "https://rpc.drpc.testnet.arc.network",
      "https://rpc.quicknode.testnet.arc.network",
      "https://rpc.blockdaemon.testnet.arc.network",
    ].filter((url): url is string => Boolean(url)),
  ),
);

const arcClient = createPublicClient({
  chain: arcTestnet,
  transport: fallback(
    arcRpcUrls.map((url) =>
      http(url, {
        retryCount: 0,
        timeout: 12_000,
      }),
    ),
    { retryCount: 1, retryDelay: 250 },
  ),
});

function requestKey(id: string) {
  return `payreq:${id}`;
}

function walletIndexKey(address: string) {
  return `payreq:wallet:${address.toLowerCase()}`;
}

function hashManageToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function tokensMatch(storedHash: string, token: string) {
  const actual = Buffer.from(hashManageToken(token), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function tryGetRedis() {
  try {
    return getRedis();
  } catch {
    return null;
  }
}

export async function resolvePayDomain(value: string) {
  const domain = normalizeDomainLabel(value);
  if (!domain) return null;
  const resolved = await arcClient.readContract({
    address: walletDomainAddress,
    abi: domainAbi,
    functionName: "resolveDomain",
    args: [domain],
  });
  if (!isAddress(resolved) || resolved === ZERO_ADDRESS) return null;
  return {
    address: getAddress(resolved),
    domain: displayPayDomain(domain),
  };
}

export async function primaryPayDomain(owner: Address) {
  try {
    const primary = (await arcClient.readContract({
      address: walletDomainAddress,
      abi: domainAbi,
      functionName: "primaryDomainOf",
      args: [owner],
    })) as string;
    return primary ? displayPayDomain(primary) : undefined;
  } catch {
    return undefined;
  }
}

function asStored(value: unknown): StoredPayRequest | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<StoredPayRequest>;
  if (
    typeof row.id !== "string" ||
    !isStoredPayRequestId(row.id) ||
    !isPayRequestAsset(row.asset) ||
    typeof row.amount !== "string" ||
    typeof row.recipient !== "string" ||
    typeof row.createdBy !== "string" ||
    typeof row.createdAt !== "number" ||
    typeof row.expiresAt !== "number" ||
    typeof row.manageTokenHash !== "string"
  ) {
    return null;
  }
  return {
    id: row.id,
    asset: row.asset,
    amount: row.amount,
    recipient: row.recipient,
    recipientDomain:
      typeof row.recipientDomain === "string" ? row.recipientDomain : undefined,
    memo: typeof row.memo === "string" ? row.memo : undefined,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    status: effectivePayRequestStatus({
      status: row.status ?? "open",
      expiresAt: row.expiresAt,
    }),
    paidBy: typeof row.paidBy === "string" ? row.paidBy : undefined,
    txHash: typeof row.txHash === "string" ? row.txHash : undefined,
    manageTokenHash: row.manageTokenHash,
  };
}

export async function getStoredPayRequest(id: string) {
  if (!isStoredPayRequestId(id)) return null;
  const redis = tryGetRedis();
  if (!redis) return null;
  const stored = asStored(await redis.get(requestKey(id)));
  return stored;
}

export async function getPublicPayRequest(id: string) {
  const stored = await getStoredPayRequest(id);
  return stored ? publicPayRequest(stored) : null;
}

export async function listWalletPayRequests(wallet: Address) {
  const redis = tryGetRedis();
  if (!redis) return [];
  const ids = await redis.lrange<string>(walletIndexKey(wallet), 0, WALLET_INDEX_CAP - 1);
  const rows: PayRequest[] = [];
  for (const id of ids) {
    const stored = await getStoredPayRequest(id);
    if (stored && stored.createdBy.toLowerCase() === wallet.toLowerCase()) {
      rows.push(publicPayRequest(stored));
    }
  }
  return rows;
}

export async function createStoredPayRequest(input: {
  createdBy: string;
  asset: PayRequestAsset;
  amount: string;
  memo?: string;
  expiresInSeconds?: number;
  domain?: string;
}): Promise<{
  request: PayRequest;
  urlPath: string;
  manageToken?: string;
  stored: boolean;
}> {
  if (!isAddress(input.createdBy)) {
    throw new Error("Connect a wallet to create a request.");
  }
  const createdBy = getAddress(input.createdBy);
  const amount = parsePayAmount(input.amount);
  if (!amount) {
    throw new Error("Enter a valid USDC or EURC amount.");
  }
  const memo = sanitizePayMemo(input.memo);
  let recipientDomain: string | undefined;
  if (input.domain) {
    const resolved = await resolvePayDomain(input.domain);
    if (!resolved) {
      throw new Error(`The .lendora name "${input.domain}" is not registered.`);
    }
    if (resolved.address.toLowerCase() !== createdBy.toLowerCase()) {
      throw new Error("That .lendora name does not resolve to your connected wallet.");
    }
    recipientDomain = resolved.domain;
  } else {
    recipientDomain = await primaryPayDomain(createdBy);
  }

  const now = Date.now();
  const expiresIn = input.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS;
  const request: PayRequest = {
    id: newPayRequestId(),
    asset: input.asset,
    amount,
    recipient: createdBy,
    recipientDomain,
    memo,
    createdBy,
    createdAt: now,
    expiresAt: now + Math.min(Math.max(expiresIn, 60 * 60), 30 * 24 * 60 * 60) * 1000,
    status: "open",
  };

  const redis = tryGetRedis();
  if (!redis) {
    return {
      request: { ...request, id: `link:${createdBy.toLowerCase()}` },
      urlPath: payRequestPath({ ...request, stored: false }),
      stored: false,
    };
  }

  const manageToken = newManageToken();
  const stored: StoredPayRequest = {
    ...request,
    manageTokenHash: hashManageToken(manageToken),
  };
  await redis.set(requestKey(request.id), stored, { ex: REQUEST_TTL_SECONDS });
  const indexKey = walletIndexKey(createdBy);
  await redis.lpush(indexKey, request.id);
  await redis.ltrim(indexKey, 0, WALLET_INDEX_CAP - 1);
  await redis.expire(indexKey, REQUEST_TTL_SECONDS);

  return {
    request: publicPayRequest(stored),
    urlPath: payRequestPath({ ...request, stored: true }),
    manageToken,
    stored: true,
  };
}

export async function cancelStoredPayRequest(id: string, manageToken: string) {
  const stored = await getStoredPayRequest(id);
  if (!stored) throw new Error("That request was not found.");
  if (!tokensMatch(stored.manageTokenHash, manageToken)) {
    throw new Error("You cannot cancel this request.");
  }
  if (stored.status === "paid") {
    throw new Error("This request is already paid.");
  }
  const redis = tryGetRedis();
  if (!redis) throw new Error("Request storage is unavailable.");
  const next: StoredPayRequest = { ...stored, status: "cancelled" };
  await redis.set(requestKey(id), next, { ex: REQUEST_TTL_SECONDS });
  return publicPayRequest(next);
}

export async function markPayRequestPaid(input: {
  id: string;
  txHash: string;
  payer: string;
}) {
  const stored = await getStoredPayRequest(input.id);
  if (!stored) throw new Error("That request was not found.");
  const status = effectivePayRequestStatus(stored);
  if (status === "cancelled") throw new Error("This request was cancelled.");
  if (status === "expired") throw new Error("This request has expired.");
  if (status === "paid") return publicPayRequest(stored);
  if (!isAddress(input.payer)) throw new Error("Payer wallet is invalid.");
  if (!/^0x[a-fA-F0-9]{64}$/.test(input.txHash)) {
    throw new Error("Transaction hash is invalid.");
  }

  const token = ARC_DEX_TOKENS[stored.asset];
  const expected = parseUnits(stored.amount, 6);
  const receipt = await arcClient.getTransactionReceipt({
    hash: input.txHash as Hash,
  });
  if (receipt.status !== "success") {
    throw new Error("That transaction did not succeed.");
  }
  const transfers = parseEventLogs({
    abi: erc20Abi,
    logs: receipt.logs,
    eventName: "Transfer",
  });
  const paid = transfers.some(
    (log) =>
      log.address.toLowerCase() === token.address.toLowerCase() &&
      log.args.to?.toLowerCase() === stored.recipient.toLowerCase() &&
      typeof log.args.value === "bigint" &&
      log.args.value >= expected,
  );
  if (!paid) {
    throw new Error(
      `That transaction did not pay ${stored.amount} ${stored.asset} to this request.`,
    );
  }

  const redis = tryGetRedis();
  if (!redis) throw new Error("Request storage is unavailable.");
  const next: StoredPayRequest = {
    ...stored,
    status: "paid",
    paidBy: getAddress(input.payer),
    txHash: input.txHash,
  };
  await redis.set(requestKey(input.id), next, { ex: REQUEST_TTL_SECONDS });
  return publicPayRequest(next);
}

export async function resolvePayRef(ref: string): Promise<{
  kind: "request" | "domain" | "address";
  request?: PayRequest;
  domain?: string;
  address?: Address;
}> {
  const trimmed = decodeURIComponent(ref).trim();
  if (isStoredPayRequestId(trimmed)) {
    const request = await getPublicPayRequest(trimmed);
    return { kind: "request", request: request ?? undefined };
  }
  if (isAddress(trimmed)) {
    return { kind: "address", address: getAddress(trimmed) };
  }
  const resolved = await resolvePayDomain(trimmed);
  if (resolved) {
    return {
      kind: "domain",
      domain: resolved.domain,
      address: resolved.address,
    };
  }
  return { kind: "domain" };
}
