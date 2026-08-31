import { NextResponse } from "next/server";
import { formatUnits, getAddress, isAddress } from "viem";
import deployments from "@/constants/deployments.json";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { ARC_TESTNET_CONTRACTS } from "@/constants/contracts";
import { ARC_DEX_ROUTERS, ARC_DEX_TOKENS } from "@/lib/arcDex";
import { getRedis } from "@/lib/server/redis";

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
  decoded_input?: {
    method_call?: string | null;
    method_id?: string | null;
    parameters?: Array<{
      name: string;
      type: string;
      value: unknown;
    }> | null;
  } | null;
};

type ExplorerTransactionsPage = {
  items: ExplorerTransaction[];
  next_page_params: Record<string, string | number> | null;
};

type ExplorerTokenTransfer = {
  transaction_hash?: string;
  timestamp?: string;
  block_number?: number;
  method?: string | null;
  from?: ExplorerAddress | null;
  to?: ExplorerAddress | null;
  token?: {
    address_hash?: string;
    symbol?: string;
    name?: string;
    decimals?: string | number;
  } | null;
  total?: {
    value?: string;
    decimals?: string | number;
  } | null;
};

const EXPLORER_API = "https://testnet.arcscan.app/api/v2";
const MAX_TRANSACTION_PAGES = 10;
const MAX_TRANSACTIONS = 250;

const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number }> = {
  "0x3600000000000000000000000000000000000000": { symbol: "USDC", decimals: 6 },
  "0x89b50855aa3be2f677cd6303cec089b5f319d72a": { symbol: "EURC", decimals: 6 },
  "0xe9185f0c5f296ed1797aae4238d26ccabeadb86c": { symbol: "USYC", decimals: 6 },
  "0x175cdb1d338945f0d851a741ccf787d343e57952": { symbol: "USDT", decimals: 18 },
  "0xf0c4a4ce82a5746abaad9425360ab04fbba432bf": { symbol: "cirBTC", decimals: 8 },
  "0x6bad029528233595d856f03d31f19f9dc10b68d1": { symbol: "aUSDC", decimals: 6 },
  "0xfd9bb99809ea2d6d8f06381ea90a5b195ec93cf9": { symbol: "dUSDC", decimals: 6 },
  "0xa97374a23f9d18422446c9cbf53d06c986091b61": { symbol: "aEURC", decimals: 6 },
  "0xa45792794d8cfb8dcf8ee78713596513155ba51f": { symbol: "dEURC", decimals: 6 },
  "0x848b0c56bad3177fa1b9613c5dd2550e7f500da9": { symbol: "aUSDC", decimals: 6 },
  "0x4afda16d11ef44658356f6912b613a2423a6a868": { symbol: "dUSDC", decimals: 6 },
  "0xfd60f777558053601e315d578ab0efcbd0d4c5b9": { symbol: "aEURC", decimals: 6 },
  "0xb0b81b427be53d396ca323edbfcaaf225f2af3af": { symbol: "dEURC", decimals: 6 },
  "0x0d36d23f06db999a58f17484307504a1a5703f39": { symbol: "evUSDC", decimals: 6 },
  "0xca770509bbe31a4f55ac6c7a8bda97e8727b8d73": { symbol: "evEURC", decimals: 6 },
  "0xaa127deb9c3f72f8d5364b49458f6b14f0540d5b": { symbol: "USDC", decimals: 6 },
  "0x57fa5403192657ed5b950c1cd4f06f361f38b14a": { symbol: "EURC", decimals: 6 },
};

function formatTokenAmount(rawAmount: string | bigint | number, decimals: number = 6): string {
  try {
    const rawBig = typeof rawAmount === "bigint" ? rawAmount : BigInt(String(rawAmount).split(".")[0]);
    const formatted = formatUnits(rawBig, decimals);
    const num = Number(formatted);
    if (!Number.isFinite(num)) return formatted;
    return num.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 6,
    });
  } catch {
    return String(rawAmount);
  }
}

function extractTxAmount(transaction: ExplorerTransaction): {
  amount: string | null;
  asset: string | null;
  formattedAmount: string | null;
} {
  if (transaction.decoded_input?.parameters && Array.isArray(transaction.decoded_input.parameters)) {
    const params: Record<string, unknown> = {};
    for (const p of transaction.decoded_input.parameters) {
      if (p && typeof p.name === "string") {
        params[p.name] = p.value;
      }
    }

    if (params.amount && params.asset && typeof params.asset === "string") {
      const tokenInfo = KNOWN_TOKENS[params.asset.toLowerCase()] ?? { symbol: "USDC", decimals: 6 };
      const formatted = formatTokenAmount(String(params.amount), tokenInfo.decimals);
      return {
        amount: formatted,
        asset: tokenInfo.symbol,
        formattedAmount: `${formatted} ${tokenInfo.symbol}`,
      };
    }

    if (params._dx) {
      const i = Number(params.i ?? 0);
      const symbol = i === 1 ? "EURC" : "USDC";
      const formatted = formatTokenAmount(String(params._dx), 6);
      return {
        amount: formatted,
        asset: symbol,
        formattedAmount: `${formatted} ${symbol}`,
      };
    }

    if (params.amountIn) {
      const tokenInStr = typeof params.tokenIn === "string" ? params.tokenIn.toLowerCase() : "";
      const tokenInfo = tokenInStr ? KNOWN_TOKENS[tokenInStr] : null;
      const decimals = tokenInfo?.decimals ?? 6;
      const symbol = tokenInfo?.symbol ?? "USDC";
      const formatted = formatTokenAmount(String(params.amountIn), decimals);
      return {
        amount: formatted,
        asset: symbol,
        formattedAmount: `${formatted} ${symbol}`,
      };
    }

    if (params.value != null && (params.to || params.spender)) {
      const toContract = transaction.to?.hash ? transaction.to.hash.toLowerCase() : "";
      const tokenInfo = toContract ? KNOWN_TOKENS[toContract] : null;
      const decimals = tokenInfo?.decimals ?? 6;
      const symbol = tokenInfo?.symbol ?? "USDC";
      const rawVal = String(params.value);
      if (rawVal.length <= 30) {
        const formatted = formatTokenAmount(rawVal, decimals);
        return {
          amount: formatted,
          asset: symbol,
          formattedAmount: `${formatted} ${symbol}`,
        };
      }
    }

    if (params.assets || params.amount) {
      const val = String(params.assets || params.amount);
      const toContract = transaction.to?.hash ? transaction.to.hash.toLowerCase() : "";
      const tokenInfo = toContract ? KNOWN_TOKENS[toContract] : null;
      const decimals = tokenInfo?.decimals ?? 6;
      const symbol = tokenInfo?.symbol ?? "USDC";
      const formatted = formatTokenAmount(val, decimals);
      return {
        amount: formatted,
        asset: symbol,
        formattedAmount: `${formatted} ${symbol}`,
      };
    }
  }

  if (transaction.value && transaction.value !== "0") {
    const formatted = formatTokenAmount(transaction.value, 18);
    return {
      amount: formatted,
      asset: "USDC",
      formattedAmount: `${formatted} USDC`,
    };
  }

  return {
    amount: null,
    asset: null,
    formattedAmount: null,
  };
}

async function getWalletPaidRequests(wallet: string) {
  try {
    const redis = getRedis();
    const ids = await redis.lrange<string>(`payreq:wallet:${wallet.toLowerCase()}`, 0, 40);
    if (!ids || ids.length === 0) return [];
    const requests = [];
    for (const id of ids) {
      const data = await redis.get<Record<string, unknown>>(`payreq:${id}`);
      if (data && typeof data === "object") {
        requests.push(data);
      }
    }
    return requests;
  } catch {
    return [];
  }
}

async function fetchTokenTransfers(address: string): Promise<ExplorerTokenTransfer[]> {
  try {
    const url = `${EXPLORER_API}/addresses/${address}/token-transfers`;
    const res = await explorerJson<{ items?: ExplorerTokenTransfer[] }>(url);
    return res.items ?? [];
  } catch {
    return [];
  }
}

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

function formatMethodName(method: string): string {
  const cleaned = method.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return cleaned
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function labelForMethod(method: string, toAddress?: string | null, direction?: "in" | "out" | "self"): string {
  const normalized = method.toLowerCase();
  if (!normalized) return "Contract Interaction";
  if (normalized.includes("approve")) return "Approval";
  if (normalized.includes("supply")) return "Supply";
  if (normalized.includes("borrow")) return "Borrow";
  if (normalized.includes("repay")) return "Repay";
  if (normalized.includes("withdraw")) {
    const toLower = toAddress?.toLowerCase();
    const isEarn =
      toLower &&
      (toLower === (deployments.earnVaults?.USDC as string)?.toLowerCase() ||
        toLower === (deployments.earnVaults?.EURC as string)?.toLowerCase());
    return isEarn ? "Earn Withdraw" : "Withdraw";
  }
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
    return "Domain Mint";
  }
  if (normalized.includes("burn")) return "Burn";
  if (normalized.includes("liquidat")) return "Liquidation";
  if (normalized.includes("multisend") || normalized.includes("sendbatch")) return "MultiSend";
  if (normalized.includes("spoken")) return "Spoken Pay";
  if (normalized.includes("list")) return "Marketplace Listing";
  if (normalized.includes("buy") || normalized.includes("purchase")) {
    return "Marketplace Purchase";
  }
  if (normalized.includes("claim")) return "Claim";
  if (normalized.includes("deposit")) return "Earn Deposit";
  if (normalized === "transfer" || normalized === "transferfrom") {
    return direction === "in" ? "Transfer Received" : "Transfer";
  }
  return formatMethodName(method);
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

  const [transfers, payRequests] = await Promise.all([
    fetchTokenTransfers(address),
    getWalletPaidRequests(address),
  ]);

  const paidRequestsByHash = new Map<string, Record<string, unknown>>();
  for (const r of payRequests) {
    if (typeof r.txHash === "string" && r.status === "paid") {
      paidRequestsByHash.set(r.txHash.toLowerCase(), r);
    }
  }

  const transactions = [];
  const seenHashes = new Set<string>();
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
      const txHashLower = transaction.hash.toLowerCase();

      const from = normalizedHash(transaction.from?.hash);
      const to = normalizedHash(
        transaction.to?.hash ?? transaction.created_contract?.hash,
      );

      const matchingPayReq = paidRequestsByHash.get(txHashLower);
      const isAppAddress = to && APP_ADDRESSES.has(to);

      if (!isAppAddress && !matchingPayReq) continue;

      seenHashes.add(txHashLower);

      const method = cleanMethod(transaction);
      const direction: "in" | "out" | "self" =
        matchingPayReq
          ? (String(matchingPayReq.recipient).toLowerCase() === addressKey ? "in" : "out")
          : from === addressKey && to === addressKey
            ? "self"
            : from === addressKey
              ? "out"
              : "in";

      const label = matchingPayReq ? "Request Pay" : labelForMethod(method, to, direction);

      let { amount, asset, formattedAmount } = extractTxAmount(transaction);
      let memo: string | null = null;

      if (matchingPayReq) {
        amount = String(matchingPayReq.amount ?? amount);
        asset = String(matchingPayReq.asset ?? asset ?? "USDC");
        formattedAmount = `${amount} ${asset}`;
        memo = typeof matchingPayReq.memo === "string" ? matchingPayReq.memo : null;
      }

      transactions.push({
        hash: transaction.hash,
        label,
        method: matchingPayReq ? "request_pay" : method || null,
        status: statusFor(transaction),
        direction,
        from: (matchingPayReq?.paidBy as string) ?? transaction.from?.hash ?? null,
        to: (matchingPayReq?.recipient as string) ?? transaction.to?.hash ?? transaction.created_contract?.hash ?? null,
        timestamp: transaction.timestamp ?? null,
        blockNumber: transaction.block_number ?? null,
        value: transaction.value ?? null,
        fee:
          typeof transaction.fee === "string"
            ? transaction.fee
            : transaction.fee?.value ?? null,
        amount,
        asset,
        formattedAmount,
        memo,
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

  for (const transfer of transfers) {
    if (!transfer.transaction_hash) continue;
    const hashLower = transfer.transaction_hash.toLowerCase();

    const transferTo = transfer.to?.hash?.toLowerCase();
    const isIncoming = transferTo === addressKey;

    const matchingPayReq = paidRequestsByHash.get(hashLower);

    const tokenInfo = transfer.token?.address_hash
      ? KNOWN_TOKENS[transfer.token.address_hash.toLowerCase()]
      : null;
    const decimals = Number(transfer.total?.decimals ?? transfer.token?.decimals ?? tokenInfo?.decimals ?? 6);
    const symbol = transfer.token?.symbol ?? tokenInfo?.symbol ?? "USDC";
    const rawVal = transfer.total?.value ?? "0";
    const formatted = formatTokenAmount(rawVal, decimals);

    if (seenHashes.has(hashLower)) {
      const existing = transactions.find((t) => t.hash.toLowerCase() === hashLower);
      if (existing) {
        if (!existing.formattedAmount && formatted && symbol) {
          existing.amount = formatted;
          existing.asset = symbol;
          existing.formattedAmount = `${formatted} ${symbol}`;
        }
        if (matchingPayReq) {
          existing.label = "Request Pay";
          existing.method = "request_pay";
          existing.memo = typeof matchingPayReq.memo === "string" ? matchingPayReq.memo : existing.memo;
          if (matchingPayReq.amount && matchingPayReq.asset) {
            existing.amount = String(matchingPayReq.amount);
            existing.asset = String(matchingPayReq.asset);
            existing.formattedAmount = `${matchingPayReq.amount} ${matchingPayReq.asset}`;
          }
        }
      }
    } else {
      if (isIncoming || matchingPayReq) {
        seenHashes.add(hashLower);
        const amount = matchingPayReq ? String(matchingPayReq.amount) : formatted;
        const asset = matchingPayReq ? String(matchingPayReq.asset) : symbol;
        const formattedAmount = matchingPayReq ? `${matchingPayReq.amount} ${matchingPayReq.asset}` : `${formatted} ${symbol}`;
        const memo = typeof matchingPayReq?.memo === "string" ? matchingPayReq.memo : null;
        const label = matchingPayReq ? "Request Pay" : isIncoming ? "Transfer Received" : "Transfer";

        transactions.push({
          hash: transfer.transaction_hash,
          label,
          method: matchingPayReq ? "request_pay" : "transfer",
          status: "Success",
          direction: isIncoming ? "in" : "out",
          from: (matchingPayReq?.paidBy as string) ?? transfer.from?.hash ?? null,
          to: (matchingPayReq?.recipient as string) ?? transfer.to?.hash ?? address,
          timestamp: transfer.timestamp ?? null,
          blockNumber: transfer.block_number ?? null,
          value: null,
          fee: null,
          amount,
          asset,
          formattedAmount,
          memo,
        });
      }
    }
  }

  for (const payReq of payRequests) {
    if (typeof payReq.txHash === "string" && payReq.status === "paid") {
      const hashLower = payReq.txHash.toLowerCase();
      if (!seenHashes.has(hashLower)) {
        seenHashes.add(hashLower);
        const isIncoming = String(payReq.recipient).toLowerCase() === addressKey;
        transactions.push({
          hash: payReq.txHash,
          label: "Request Pay",
          method: "request_pay",
          status: "Success",
          direction: isIncoming ? "in" : "out",
          from: (payReq.paidBy as string) ?? null,
          to: (payReq.recipient as string) ?? address,
          timestamp: typeof payReq.createdAt === "number" ? new Date(payReq.createdAt).toISOString() : null,
          blockNumber: null,
          value: null,
          fee: null,
          amount: String(payReq.amount ?? ""),
          asset: String(payReq.asset ?? "USDC"),
          formattedAmount: `${payReq.amount} ${payReq.asset}`,
          memo: typeof payReq.memo === "string" ? payReq.memo : null,
        });
      }
    }
  }

  transactions.sort((a, b) => {
    const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return timeB - timeA;
  });

  return NextResponse.json({
    address,
    transactions,
    historyComplete: nextUrl === null,
    pagesRead,
  });
}
