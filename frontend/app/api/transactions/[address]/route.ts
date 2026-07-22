import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import deployments from "@/constants/deployments.json";
import { ARCANA_MARKETS_ADDRESS } from "@/constants/arcana";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { ARC_TESTNET_CONTRACTS } from "@/constants/contracts";
import { ARC_DEX_ROUTERS, ARC_DEX_TOKENS } from "@/lib/arcDex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExplorerAddress = {
  hash?: string;
};

type ExplorerTransaction = {
  hash?: string;
  timestamp?: string;
  block_number?: number;
  method?: string | null;
  method_call?: string | null;
  result?: string | null;
  status?: string | null;
  from?: ExplorerAddress | null;
  to?: ExplorerAddress | null;
  created_contract?: ExplorerAddress | null;
  value?: string | null;
  fee?: { value?: string | null } | string | null;
  tx_types?: string[] | null;
  transaction_types?: string[] | null;
};

type ExplorerTransactionsPage = {
  items: ExplorerTransaction[];
  next_page_params: Record<string, string | number> | null;
};

const EXPLORER_API = "https://testnet.arcscan.app/api/v2";
const MAX_TRANSACTION_PAGES = 10;
const MAX_TRANSACTIONS = 250;

function collectAddresses(value: unknown, addresses: Set<string>) {
  if (typeof value === "string") {
    if (isAddress(value)) {
      addresses.add(getAddress(value).toLowerCase());
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const child of Object.values(value)) {
    collectAddresses(child, addresses);
  }
}

function appAddresses() {
  const addresses = new Set<string>();
  collectAddresses(deployments, addresses);
  collectAddresses(ARC_TESTNET_CONTRACTS, addresses);
  collectAddresses(ARC_DEX_TOKENS, addresses);
  collectAddresses(ARC_DEX_ROUTERS, addresses);
  collectAddresses(ARCANA_MARKETS_ADDRESS, addresses);
  return addresses;
}

const APP_ADDRESSES = appAddresses();

async function explorerJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 30 },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`ArcScan request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function normalizedHash(value?: string) {
  return value && isAddress(value) ? getAddress(value).toLowerCase() : null;
}

function cleanMethod(transaction: ExplorerTransaction) {
  const raw =
    transaction.method ??
    transaction.method_call?.split("(")[0] ??
    transaction.tx_types?.[0] ??
    transaction.transaction_types?.[0] ??
    "";
  return raw.trim();
}

function labelForMethod(method: string) {
  const normalized = method.toLowerCase();
  if (!normalized) return "Contract interaction";
  if (normalized.includes("approve")) return "Approval";
  if (normalized.includes("supply")) return "Supply";
  if (normalized.includes("borrow")) return "Borrow";
  if (normalized.includes("repay")) return "Repay";
  if (normalized.includes("withdraw")) return "Withdraw";
  if (
    normalized.includes("swap") ||
    normalized.includes("exchange") ||
    normalized.includes("exactinput")
  ) {
    return "Swap";
  }
  if (normalized.includes("bridge") || normalized.includes("depositforburn")) {
    return "Bridge";
  }
  if (normalized.includes("mint") || normalized.includes("register")) {
    return "Domain mint";
  }
  if (normalized.includes("burn")) return "Burn";
  if (normalized.includes("list")) return "Marketplace listing";
  if (normalized.includes("buy") || normalized.includes("purchase")) {
    return "Marketplace purchase";
  }
  if (normalized.includes("claim")) return "Claim";
  if (normalized.includes("deposit")) return "Earn deposit";
  return method.replace(/_/g, " ");
}

function statusFor(transaction: ExplorerTransaction) {
  const raw = String(transaction.result ?? transaction.status ?? "").toLowerCase();
  if (raw.includes("success") || raw === "ok") return "Success";
  if (raw.includes("fail") || raw.includes("error") || raw.includes("revert")) {
    return "Failed";
  }
  return "Confirmed";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: rawAddress } = await params;
  const limited = enforceRateLimit(request, {
    scope: "transactions",
    key: rawAddress.toLowerCase(),
    limit: 15,
    windowMs: 60_000,
  });
  if (limited) return limited;

  if (!isAddress(rawAddress)) {
    return NextResponse.json(
      { error: "Invalid wallet address." },
      { status: 400 },
    );
  }

  const address = getAddress(rawAddress);
  const addressKey = address.toLowerCase();
  const transactions = [];
  let nextUrl: string | null = `${EXPLORER_API}/addresses/${address}/transactions`;
  let pagesRead = 0;

  while (
    nextUrl &&
    pagesRead < MAX_TRANSACTION_PAGES &&
    transactions.length < MAX_TRANSACTIONS
  ) {
    const page = await explorerJson<ExplorerTransactionsPage>(nextUrl);
    pagesRead += 1;

    for (const transaction of page.items) {
      if (!transaction.hash) continue;

      const from = normalizedHash(transaction.from?.hash);
      const to = normalizedHash(
        transaction.to?.hash ?? transaction.created_contract?.hash,
      );
      if (!to || !APP_ADDRESSES.has(to)) continue;

      const method = cleanMethod(transaction);
      transactions.push({
        hash: transaction.hash,
        label: labelForMethod(method),
        method: method || null,
        status: statusFor(transaction),
        direction:
          from === addressKey && to === addressKey
            ? "self"
            : from === addressKey
              ? "out"
              : "in",
        from: transaction.from?.hash ?? null,
        to: transaction.to?.hash ?? transaction.created_contract?.hash ?? null,
        timestamp: transaction.timestamp ?? null,
        blockNumber: transaction.block_number ?? null,
        value: transaction.value ?? null,
        fee:
          typeof transaction.fee === "string"
            ? transaction.fee
            : transaction.fee?.value ?? null,
      });

      if (transactions.length >= MAX_TRANSACTIONS) break;
    }

    if (!page.next_page_params) {
      nextUrl = null;
    } else {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(page.next_page_params)) {
        query.set(key, String(value));
      }
      nextUrl = `${EXPLORER_API}/addresses/${address}/transactions?${query}`;
    }
  }

  return NextResponse.json({
    address,
    transactions,
    historyComplete: nextUrl === null,
    pagesRead,
  });
}
