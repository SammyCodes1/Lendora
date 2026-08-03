import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { ARC_DEX_TOKENS } from "@/lib/arcDex";
import { enforceRateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExplorerToken = {
  address_hash: string;
  decimals: string | null;
  icon_url: string | null;
  name: string | null;
  symbol: string | null;
  type: string;
};

type TokenBalance = {
  token: ExplorerToken;
  value: string;
};

type TokenTransfer = {
  from?: { hash?: string };
  to?: { hash?: string };
  token?: ExplorerToken;
  total?: { decimals?: string; value?: string };
  transaction_hash?: string;
};

type TransfersPage = {
  items: TokenTransfer[];
  next_page_params: Record<string, string | number> | null;
};

const EXPLORER_API = "https://testnet.arcscan.app/api/v2";
const MAX_TRANSFER_PAGES = 10;
const trackedTokens = new Map(
  Object.values(ARC_DEX_TOKENS).map((token) => [
    token.address.toLowerCase(),
    token,
  ]),
);

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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: rawAddress } = await params;
  const limited = enforceRateLimit(request, {
    scope: "profile",
    key: rawAddress.toLowerCase(),
    limit: 10,
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
  const balancesPromise = explorerJson<TokenBalance[]>(
    `${EXPLORER_API}/addresses/${address}/token-balances`,
  );

  const volume = Object.fromEntries(
    Object.keys(ARC_DEX_TOKENS).map((symbol) => [
      symbol,
      { outgoing: 0n, incoming: 0n, transactions: new Set<string>() },
    ]),
  ) as Record<
    keyof typeof ARC_DEX_TOKENS,
    {
      outgoing: bigint;
      incoming: bigint;
      transactions: Set<string>;
    }
  >;

  let nextUrl: string | null =
    `${EXPLORER_API}/addresses/${address}/token-transfers`;
  let pagesRead = 0;

  while (nextUrl && pagesRead < MAX_TRANSFER_PAGES) {
    const page: TransfersPage = await explorerJson<TransfersPage>(nextUrl);
    pagesRead += 1;

    for (const transfer of page.items) {
      const tokenAddress = transfer.token?.address_hash?.toLowerCase();
      const tracked = tokenAddress ? trackedTokens.get(tokenAddress) : null;
      const rawValue = transfer.total?.value;
      if (!tracked || !rawValue || !/^\d+$/.test(rawValue)) continue;

      const entry = volume[tracked.symbol];
      const value = BigInt(rawValue);
      if (transfer.from?.hash?.toLowerCase() === addressKey) {
        entry.outgoing += value;
        if (transfer.transaction_hash) {
          entry.transactions.add(transfer.transaction_hash);
        }
      }
      if (transfer.to?.hash?.toLowerCase() === addressKey) {
        entry.incoming += value;
      }
    }

    if (!page.next_page_params) {
      nextUrl = null;
    } else {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(page.next_page_params)) {
        query.set(key, String(value));
      }
      nextUrl = `${EXPLORER_API}/addresses/${address}/token-transfers?${query}`;
    }
  }

  const balances = (await balancesPromise)
    .filter(
      (entry) =>
        entry.token.type === "ERC-20" &&
        /^\d+$/.test(entry.value) &&
        BigInt(entry.value) > 0n,
    )
    .map((entry) => ({
      address: entry.token.address_hash,
      name: entry.token.name ?? "Unknown token",
      symbol: entry.token.symbol ?? "TOKEN",
      decimals: Number(entry.token.decimals ?? 0),
      iconUrl: entry.token.icon_url,
      value: entry.value,
    }));

  return NextResponse.json({
    address,
    balances,
    volume: Object.fromEntries(
      Object.entries(volume).map(([symbol, entry]) => [
        symbol,
        {
          outgoing: entry.outgoing.toString(),
          incoming: entry.incoming.toString(),
          transactionCount: entry.transactions.size,
        },
      ]),
    ),
    historyComplete: nextUrl === null,
    pagesRead,
  });
}
