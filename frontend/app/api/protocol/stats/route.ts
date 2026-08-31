import { NextResponse } from "next/server";
import {
  createPublicClient,
  decodeEventLog,
  decodeFunctionData,
  fallback,
  getAddress,
  http,
  isAddress,
  toEventSelector,
  toFunctionSelector,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";
import { arcTestnet } from "viem/chains";
import deployments from "@/constants/deployments.json";
import { ARC_TESTNET_CONTRACTS, ARC_TESTNET_METADATA } from "@/constants/contracts";
import domainMarketplaceJson from "@/constants/abis/DomainMarketplace.json";
import earnVaultJson from "@/constants/abis/EarnVault.json";
import lendingPoolJson from "@/constants/abis/LendingPool.json";
import positionNftJson from "@/constants/abis/PositionNFT.json";
import priceOracleJson from "@/constants/abis/MockPriceOracle.json";
import {
  ARC_DEX_ROUTERS,
  ARC_DEX_TOKENS,
  CURVE_ABI,
  V2_ROUTER_ABI,
  V3_ROUTER_ABI,
} from "@/lib/arcDex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPLORER_API = "https://testnet.arcscan.app/api";
const EXPLORER_V2 = "https://testnet.arcscan.app/api/v2";
const USD_SCALE = 1_000_000n;
const MAX_LOG_RESULTS = 1_000;
const MAX_PARTICIPANTS = 75;
const TRANSACTION_LIMIT = 10_000;
const CACHE_MS = 60_000;

const lendingPoolAbi = lendingPoolJson as Abi;
const earnVaultAbi = earnVaultJson as Abi;
const marketplaceAbi = domainMarketplaceJson as Abi;
const positionNftAbi = positionNftJson as Abi;
const priceOracleAbi = priceOracleJson as Abi;

type VolumeCategory =
  | "lending"
  | "borrowing"
  | "earn"
  | "swaps"
  | "bridges"
  | "liquidations"
  | "marketplace";

type TokenMeta = { address: Address; symbol: string; decimals: number };
type Price = { value: bigint; decimals: number };

type ExplorerLog = {
  address?: string;
  blockNumber?: string;
  data: Hex;
  logIndex?: string;
  timeStamp?: string;
  topics: Hex[];
  transactionHash: Hex;
};

type LegacyResponse<T> = {
  status?: string;
  message?: string;
  result?: T | string | null;
};

type LegacyTransaction = {
  blockNumber?: string;
  from?: string;
  to?: string;
  hash?: Hex;
  input?: Hex;
  timeStamp?: string;
  isError?: string;
  txreceipt_status?: string;
};

type TransferPage = {
  items: Array<{
    to?: { hash?: string };
    token?: { address_hash?: string };
    total?: { value?: string };
  }>;
};

type VolumeBucket = {
  lifetime: bigint;
  latest24h: bigint;
  previous24h: bigint;
  actions: number;
};

type Trend = {
  direction: "up" | "down" | "flat";
  percentage: number | null;
  comparison: string;
};

const TOKEN_BY_ADDRESS = new Map<string, TokenMeta>(
  Object.values(ARC_DEX_TOKENS).map((token) => [
    token.address.toLowerCase(),
    token,
  ]),
);

const NATIVE_USDC: TokenMeta = {
  address: ARC_TESTNET_CONTRACTS.USDC,
  symbol: "USDC",
  decimals: 6,
};

const CCTP_SELECTORS = new Set([
  toFunctionSelector(
    "depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)",
  ).toLowerCase(),
  toFunctionSelector(
    "depositForBurnWithHook(uint256,uint32,bytes32,address,bytes32,uint256,uint32,bytes)",
  ).toLowerCase(),
]);

const arcClient = createPublicClient({
  chain: arcTestnet,
  transport: fallback(
    Array.from(
      new Set([
        ARC_TESTNET_METADATA.rpcUrl,
        ...arcTestnet.rpcUrls.default.http,
      ]),
    ).map((url) =>
      http(url, {
        retryCount: 1,
        timeout: 12_000,
      }),
    ),
  ),
});

let cached:
  | { expiresAt: number; payload: Awaited<ReturnType<typeof buildStats>> }
  | null = null;
let inFlight: Promise<Awaited<ReturnType<typeof buildStats>>> | null = null;

function eventFromAbi(abi: Abi, name: string) {
  const event = abi.find(
    (item): item is AbiEvent => item.type === "event" && item.name === name,
  );
  if (!event) throw new Error("Missing " + name + " event in deployed ABI");
  return event;
}

function hexOrDecimal(value?: string) {
  if (!value) return 0;
  try {
    return Number(BigInt(value));
  } catch {
    return 0;
  }
}

function normalizedAddress(value?: string | null) {
  return value && isAddress(value) ? value.toLowerCase() : null;
}

function tokenForAddress(value: Address) {
  return TOKEN_BY_ADDRESS.get(value.toLowerCase()) ?? null;
}

async function explorerJson<T>(url: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        next: { revalidate: 60 },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        throw new Error("ArcScan request failed with " + response.status);
      }
      return response.json() as Promise<T>;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("ArcScan request failed");
}

async function queryLogs(
  contract: Address,
  abi: Abi,
  eventName: string,
  fromBlock: number,
) {
  const query = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    address: contract,
    fromBlock: String(fromBlock),
    toBlock: "latest",
    topic0: toEventSelector(eventFromAbi(abi, eventName)),
  });
  const response = await explorerJson<LegacyResponse<ExplorerLog[]>>(
    EXPLORER_API + "?" + query.toString(),
  );
  const logs = Array.isArray(response.result) ? response.result : [];
  return {
    contract,
    abi,
    eventName,
    logs,
    complete: logs.length < MAX_LOG_RESULTS,
  };
}

function decodedArgs(abi: Abi, eventName: string, log: ExplorerLog) {
  const decoded = decodeEventLog({
    abi,
    eventName,
    data: log.data,
    topics: log.topics as [Hex, ...Hex[]],
    strict: true,
  });
  return (decoded.args ?? {}) as Record<string, unknown>;
}

function addressArg(args: Record<string, unknown>, key: string) {
  const value = args[key];
  return typeof value === "string" && isAddress(value)
    ? getAddress(value)
    : null;
}

function bigintArg(args: Record<string, unknown>, key: string) {
  return typeof args[key] === "bigint" ? args[key] : null;
}

const fallbackOracleAddress = (
  (deployments as typeof deployments & { fallbackPriceOracle?: string })
    .fallbackPriceOracle ?? "0x0000000000000000000000000000000000000000"
) as Address;

function isValidUsdPrice(
  value: bigint,
  decimals: number,
): value is bigint {
  return value > 0n && decimals === 8;
}

/** Primary oracle first, then fallback — same policy as LendingPool._getPrice. */
async function oraclePrices(tokens: Address[]) {
  const primaryResults = await arcClient.multicall({
    allowFailure: true,
    contracts: tokens.map((token) => ({
      address: deployments.priceOracle as Address,
      abi: priceOracleAbi,
      functionName: "getPrice" as const,
      args: [token],
    })),
  });

  const resolved = primaryResults.map((result): Price | null => {
    if (result.status !== "success") return null;
    const [value, decimals] = result.result as readonly [bigint, number];
    return isValidUsdPrice(value, decimals) ? { value, decimals } : null;
  });

  const missingIndexes = resolved
    .map((price, index) => (price ? -1 : index))
    .filter((index) => index >= 0);

  if (
    missingIndexes.length === 0 ||
    fallbackOracleAddress === "0x0000000000000000000000000000000000000000" ||
    fallbackOracleAddress.toLowerCase() ===
      (deployments.priceOracle as string).toLowerCase()
  ) {
    return resolved;
  }

  const fallbackResults = await arcClient.multicall({
    allowFailure: true,
    contracts: missingIndexes.map((index) => ({
      address: fallbackOracleAddress,
      abi: priceOracleAbi,
      functionName: "getPrice" as const,
      args: [tokens[index]],
    })),
  });

  missingIndexes.forEach((tokenIndex, resultIndex) => {
    const result = fallbackResults[resultIndex];
    if (result?.status !== "success") return;
    const [value, decimals] = result.result as readonly [bigint, number];
    if (isValidUsdPrice(value, decimals)) {
      resolved[tokenIndex] = { value, decimals };
    }
  });

  return resolved;
}

function toUsdMicro(amount: bigint, token: TokenMeta, price: Price) {
  return (
    (amount * price.value * USD_SCALE) /
    (10n ** BigInt(token.decimals) * 10n ** BigInt(price.decimals))
  );
}

function trend(current: bigint, previous: bigint, comparison: string): Trend {
  if (current === previous) {
    return { direction: "flat", percentage: 0, comparison };
  }
  const direction = current > previous ? "up" : "down";
  if (previous === 0n) {
    return { direction, percentage: null, comparison };
  }
  const difference = current > previous ? current - previous : previous - current;
  const percentage = Number((difference * 10_000n) / previous) / 100;
  return { direction, percentage, comparison };
}

async function blockAt(timestamp: number) {
  const query = new URLSearchParams({
    module: "block",
    action: "getblocknobytime",
    timestamp: String(timestamp),
    closest: "before",
  });
  try {
    const response = await explorerJson<
      LegacyResponse<{ blockNumber?: string }>
    >(EXPLORER_API + "?" + query.toString());
    if (
      !response.result ||
      typeof response.result !== "object" ||
      !response.result.blockNumber
    ) {
      return null;
    }
    return BigInt(response.result.blockNumber);
  } catch {
    return null;
  }
}

async function marketSnapshot(blockNumber?: bigint) {
  const markets = Object.values(deployments.markets);
  const results = await arcClient.multicall({
    allowFailure: true,
    blockNumber,
    contracts: markets.flatMap((market) => {
      const priceCalls = [
        {
          address: deployments.priceOracle as Address,
          abi: priceOracleAbi,
          functionName: "getPrice" as const,
          args: [market.asset as Address],
        },
      ];
      if (
        fallbackOracleAddress !==
          "0x0000000000000000000000000000000000000000" &&
        fallbackOracleAddress.toLowerCase() !==
          (deployments.priceOracle as string).toLowerCase()
      ) {
        priceCalls.push({
          address: fallbackOracleAddress,
          abi: priceOracleAbi,
          functionName: "getPrice" as const,
          args: [market.asset as Address],
        });
      }
      return [
        {
          address: deployments.lendingPool as Address,
          abi: lendingPoolAbi,
          functionName: "getReserveData" as const,
          args: [market.asset as Address],
        },
        ...priceCalls,
      ];
    }),
  });

  const callsPerMarket =
    fallbackOracleAddress !== "0x0000000000000000000000000000000000000000" &&
    fallbackOracleAddress.toLowerCase() !==
      (deployments.priceOracle as string).toLowerCase()
      ? 3
      : 2;

  let complete = true;
  const snapshots = markets.map((market, index) => {
      const offset = index * callsPerMarket;
      const reserve = results[offset];
      const primaryPrice = results[offset + 1];
      const fallbackPrice =
        callsPerMarket === 3 ? results[offset + 2] : undefined;

      if (reserve.status !== "success") {
        complete = false;
        return { tvl: 0n, borrowed: 0n };
      }

      let valuePrice: Price | null = null;
      if (primaryPrice?.status === "success") {
        const [price, priceDecimals] = primaryPrice.result as readonly [
          bigint,
          number,
        ];
        if (isValidUsdPrice(price, priceDecimals)) {
          valuePrice = { value: price, decimals: priceDecimals };
        }
      }
      if (!valuePrice && fallbackPrice?.status === "success") {
        const [price, priceDecimals] = fallbackPrice.result as readonly [
          bigint,
          number,
        ];
        if (isValidUsdPrice(price, priceDecimals)) {
          valuePrice = { value: price, decimals: priceDecimals };
        }
      }
      if (!valuePrice) {
        complete = false;
        return { tvl: 0n, borrowed: 0n };
      }

      const data = reserve.result as {
        totalLiquidity: bigint;
        totalBorrowed: bigint;
      };
      const token = tokenForAddress(getAddress(market.asset));
      if (!token) {
        complete = false;
        return { tvl: 0n, borrowed: 0n };
      }
      return {
        tvl: toUsdMicro(data.totalLiquidity, token, valuePrice),
        borrowed: toUsdMicro(data.totalBorrowed, token, valuePrice),
      };
  });
  const totals = snapshots.reduce(
    (sum, value) => ({
      tvl: sum.tvl + value.tvl,
      borrowed: sum.borrowed + value.borrowed,
    }),
    { tvl: 0n, borrowed: 0n },
  );
  return { ...totals, complete };
}

function decodeSwap(target: string, input: Hex) {
  try {
    if (target === ARC_DEX_ROUTERS.curve.toLowerCase()) {
      const decoded = decodeFunctionData({ abi: CURVE_ABI, data: input });
      if (decoded.functionName !== "exchange") return null;
      const [i, j, amountIn] = decoded.args;
      const tokens = [ARC_DEX_TOKENS.USDC, ARC_DEX_TOKENS.EURC] as const;
      const tokenIn = tokens[Number(i)];
      const tokenOut = tokens[Number(j)];
      return tokenIn && tokenOut ? { tokenIn, tokenOut, amountIn } : null;
    }
    if (target === ARC_DEX_ROUTERS.xylo.toLowerCase()) {
      const decoded = decodeFunctionData({ abi: V2_ROUTER_ABI, data: input });
      if (decoded.functionName !== "swapExactTokensForTokens") return null;
      const [amountIn, , path] = decoded.args;
      const tokenIn = path[0] ? tokenForAddress(path[0]) : null;
      const last = path.at(-1);
      const tokenOut = last ? tokenForAddress(last) : null;
      return tokenIn && tokenOut ? { tokenIn, tokenOut, amountIn } : null;
    }
    if (target === ARC_DEX_ROUTERS.v3.toLowerCase()) {
      const decoded = decodeFunctionData({ abi: V3_ROUTER_ABI, data: input });
      if (decoded.functionName !== "exactInputSingle") return null;
      const params = decoded.args[0];
      const tokenIn = tokenForAddress(params.tokenIn);
      const tokenOut = tokenForAddress(params.tokenOut);
      return tokenIn && tokenOut
        ? { tokenIn, tokenOut, amountIn: params.amountIn }
        : null;
    }
  } catch {
    return null;
  }
  return null;
}

function bridgeAmount(input: Hex) {
  if (input.length < 10 + 64 * 4) return null;
  if (!CCTP_SELECTORS.has(input.slice(0, 10).toLowerCase())) return null;
  try {
    const amount = BigInt("0x" + input.slice(10, 74));
    const burnTokenWord = input.slice(10 + 64 * 3, 10 + 64 * 4);
    const burnToken = "0x" + burnTokenWord.slice(-40);
    return burnToken.toLowerCase() === ARC_TESTNET_CONTRACTS.USDC.toLowerCase()
      ? amount
      : null;
  } catch {
    return null;
  }
}

async function swapOutputAmount(
  transactionHash: Hex,
  participant: string,
  tokenOut: TokenMeta,
) {
  try {
    const response = await explorerJson<TransferPage>(
      EXPLORER_V2 + "/transactions/" + transactionHash + "/token-transfers",
    );
    return response.items.reduce((sum, transfer) => {
      const recipient = normalizedAddress(transfer.to?.hash);
      const token = normalizedAddress(transfer.token?.address_hash);
      const value = transfer.total?.value;
      return recipient === participant &&
        token === tokenOut.address.toLowerCase() &&
        value &&
        /^\d+$/.test(value)
        ? sum + BigInt(value)
        : sum;
    }, 0n);
  } catch {
    return 0n;
  }
}

async function participantTransactions(address: string, fromBlock: number) {
  const query = new URLSearchParams({
    module: "account",
    action: "txlist",
    address,
    startblock: String(fromBlock),
    endblock: "99999999",
    page: "1",
    offset: String(TRANSACTION_LIMIT),
    sort: "asc",
  });
  const response = await explorerJson<LegacyResponse<LegacyTransaction[]>>(
    EXPLORER_API + "?" + query.toString(),
  );
  const transactions = Array.isArray(response.result) ? response.result : [];
  return {
    transactions,
    complete: transactions.length < TRANSACTION_LIMIT,
  };
}

async function buildStats() {
  const now = Math.floor(Date.now() / 1_000);
  const latestWindowStart = now - 86_400;
  const previousWindowStart = now - 172_800;

  const [[usdcPrice, eurcPrice, cirBtcPrice], historicalBlock] =
    await Promise.all([
      oraclePrices([
        ARC_DEX_TOKENS.USDC.address,
        ARC_DEX_TOKENS.EURC.address,
        ARC_DEX_TOKENS.cirBTC.address,
      ]),
      blockAt(latestWindowStart),
    ]);

  const prices = new Map<string, Price>();
  if (usdcPrice) prices.set(ARC_DEX_TOKENS.USDC.address.toLowerCase(), usdcPrice);
  if (eurcPrice) prices.set(ARC_DEX_TOKENS.EURC.address.toLowerCase(), eurcPrice);
  if (cirBtcPrice) prices.set(ARC_DEX_TOKENS.cirBTC.address.toLowerCase(), cirBtcPrice);
  // Peg USDT at $1.00. USDT has 18 decimals so price must be expressed
  // as 10^18 with decimals=18 so that toUsdMicro cancels correctly.
  prices.set(ARC_DEX_TOKENS.USDT.address.toLowerCase(), {
    value: 10n ** BigInt(ARC_DEX_TOKENS.USDT.decimals),
    decimals: ARC_DEX_TOKENS.USDT.decimals,
  });

  const marketFromBlock =
    (
      deployments as typeof deployments & {
        marketTokenDeploymentBlock?: number;
      }
    ).marketTokenDeploymentBlock ?? deployments.deploymentBlock;

  const logRequests = [
    queryLogs(deployments.lendingPool as Address, lendingPoolAbi, "Supply", marketFromBlock),
    queryLogs(deployments.lendingPool as Address, lendingPoolAbi, "Withdraw", marketFromBlock),
    queryLogs(deployments.lendingPool as Address, lendingPoolAbi, "Borrow", marketFromBlock),
    queryLogs(deployments.lendingPool as Address, lendingPoolAbi, "Repay", marketFromBlock),
    queryLogs(deployments.lendingPool as Address, lendingPoolAbi, "LiquidationCall", marketFromBlock),
    ...Object.values(deployments.earnVaults).flatMap((vault) => [
      queryLogs(vault as Address, earnVaultAbi, "Deposit", deployments.earnVaultDeploymentBlock),
      queryLogs(vault as Address, earnVaultAbi, "Withdraw", deployments.earnVaultDeploymentBlock),
    ]),
    queryLogs(deployments.DomainMarketplace as Address, marketplaceAbi, "DomainPurchased", deployments.domainMarketplaceDeploymentBlock),
    queryLogs(deployments.PositionNFT as Address, positionNftAbi, "Transfer", marketFromBlock),
  ];

  const settledLogs = await Promise.allSettled(logRequests);
  const volume: VolumeBucket = {
    lifetime: 0n,
    latest24h: 0n,
    previous24h: 0n,
    actions: 0,
  };
  const categoryVolume = new Map<VolumeCategory, bigint>();
  const seen = new Set<string>();
  const participants = new Map<string, number>();
  const positionLogs: ExplorerLog[] = [];
  let eventHistoryComplete = true;
  let valuationComplete = true;

  const rememberParticipant = (candidate: Address | null, block: number) => {
    if (!candidate) return;
    const key = candidate.toLowerCase();
    const existing = participants.get(key);
    if (existing === undefined || block < existing) participants.set(key, block);
  };

  const addNotional = (
    category: VolumeCategory,
    actionId: string,
    token: TokenMeta,
    amount: bigint,
    timestamp: number,
  ) => {
    if (amount <= 0n || seen.has(actionId)) return;
    seen.add(actionId);
    const price = prices.get(token.address.toLowerCase());
    if (!price) {
      valuationComplete = false;
      return;
    }
    const usd = toUsdMicro(amount, token, price);
    volume.lifetime += usd;
    volume.actions += 1;
    if (timestamp >= latestWindowStart) volume.latest24h += usd;
    else if (timestamp >= previousWindowStart) volume.previous24h += usd;
    categoryVolume.set(category, (categoryVolume.get(category) ?? 0n) + usd);
  };

  for (const settled of settledLogs) {
    if (settled.status === "rejected") {
      eventHistoryComplete = false;
      continue;
    }
    const query = settled.value;
    if (!query.complete) eventHistoryComplete = false;
    if (query.abi === positionNftAbi) {
      positionLogs.push(...query.logs);
      continue;
    }

    query.logs.forEach((log, index) => {
      try {
        const args = decodedArgs(query.abi, query.eventName, log);
        const block = hexOrDecimal(log.blockNumber);
        const timestamp = hexOrDecimal(log.timeStamp);
        const actionId =
          query.contract.toLowerCase() +
          ":" +
          log.transactionHash +
          ":" +
          (log.logIndex ?? String(index));

        if (query.abi === lendingPoolAbi) {
          if (query.eventName === "Supply" || query.eventName === "Borrow" || query.eventName === "Repay") {
            rememberParticipant(addressArg(args, "onBehalfOf"), block);
          } else if (query.eventName === "Withdraw") {
            rememberParticipant(addressArg(args, "user"), block);
          } else if (query.eventName === "LiquidationCall") {
            rememberParticipant(addressArg(args, "user"), block);
            rememberParticipant(addressArg(args, "liquidator"), block);
          }

          if (query.eventName === "LiquidationCall") {
            const asset = addressArg(args, "debtAsset");
            const amount = bigintArg(args, "debtCovered");
            const token = asset ? tokenForAddress(asset) : null;
            if (token && amount !== null) addNotional("liquidations", actionId, token, amount, timestamp);
            return;
          }
          const asset = addressArg(args, "asset");
          const amount = bigintArg(args, "amount");
          const token = asset ? tokenForAddress(asset) : null;
          if (token && amount !== null) {
            addNotional(
              query.eventName === "Supply" || query.eventName === "Withdraw" ? "lending" : "borrowing",
              actionId,
              token,
              amount,
              timestamp,
            );
          }
          return;
        }

        if (query.abi === earnVaultAbi) {
          rememberParticipant(addressArg(args, "owner"), block);
          const amount = bigintArg(args, "assets");
          const vault = query.contract.toLowerCase();
          const marketKey = Object.entries(deployments.earnVaults).find(
            ([, address]) => address.toLowerCase() === vault,
          )?.[0];
          const token =
            marketKey && marketKey in ARC_DEX_TOKENS
              ? ARC_DEX_TOKENS[marketKey as keyof typeof ARC_DEX_TOKENS]
              : null;
          if (!token) { valuationComplete = false; return; }
          if (amount !== null) addNotional("earn", actionId, token, amount, timestamp);
          return;
        }

        if (query.abi === marketplaceAbi) {
          rememberParticipant(addressArg(args, "seller"), block);
          rememberParticipant(addressArg(args, "buyer"), block);
          const amount = bigintArg(args, "price");
          if (amount !== null) addNotional("marketplace", actionId, NATIVE_USDC, amount, timestamp);
        }
      } catch {
        eventHistoryComplete = false;
      }
    });
  }

  const countPositions = (maximumBlock?: bigint) => {
    let active = 0n;
    for (const log of positionLogs) {
      const block = BigInt(log.blockNumber ?? "0x0");
      if (maximumBlock !== undefined && block > maximumBlock) continue;
      try {
        const args = decodedArgs(positionNftAbi, "Transfer", log);
        const from = addressArg(args, "from");
        const to = addressArg(args, "to");
        if (from === "0x0000000000000000000000000000000000000000") active += 1n;
        if (to === "0x0000000000000000000000000000000000000000") active -= 1n;
      } catch {
        eventHistoryComplete = false;
      }
    }
    return active > 0n ? active : 0n;
  };

  const participantEntries = Array.from(participants.entries());
  let routeHistoryComplete = participantEntries.length <= MAX_PARTICIPANTS;
  const selectedParticipants = participantEntries.slice(0, MAX_PARTICIPANTS);
  for (let index = 0; index < selectedParticipants.length; index += 6) {
    const batch = selectedParticipants.slice(index, index + 6);
    const histories = await Promise.allSettled(
      batch.map(([participant, firstBlock]) => participantTransactions(participant, firstBlock)),
    );
    for (let itemIndex = 0; itemIndex < histories.length; itemIndex += 1) {
      const history = histories[itemIndex];
      const participant = batch[itemIndex][0];
      if (history.status === "rejected") {
        routeHistoryComplete = false;
        continue;
      }
      if (!history.value.complete) routeHistoryComplete = false;
      for (const transaction of history.value.transactions) {
        const target = normalizedAddress(transaction.to);
        const sender = normalizedAddress(transaction.from);
        const hash = transaction.hash;
        const input = transaction.input;
        if (
          sender !== participant ||
          !target ||
          !hash ||
          !input ||
          transaction.isError === "1" ||
          transaction.txreceipt_status === "0"
        ) continue;
        const timestamp = hexOrDecimal(transaction.timeStamp);

        if (target === ARC_TESTNET_CONTRACTS.CCTP_TOKEN_MESSENGER_V2.toLowerCase()) {
          const amount = bridgeAmount(input);
          if (amount !== null) addNotional("bridges", "bridge:" + hash, ARC_DEX_TOKENS.USDC, amount, timestamp);
          continue;
        }
        if (
          target !== ARC_DEX_ROUTERS.curve.toLowerCase() &&
          target !== ARC_DEX_ROUTERS.xylo.toLowerCase() &&
          target !== ARC_DEX_ROUTERS.v3.toLowerCase()
        ) continue;

        const swap = decodeSwap(target, input);
        if (!swap) continue;
        if (prices.has(swap.tokenIn.address.toLowerCase())) {
          addNotional("swaps", "swap:" + hash, swap.tokenIn, swap.amountIn, timestamp);
          continue;
        }
        if (prices.has(swap.tokenOut.address.toLowerCase())) {
          const amountOut = await swapOutputAmount(hash, participant, swap.tokenOut);
          if (amountOut > 0n) {
            addNotional("swaps", "swap:" + hash, swap.tokenOut, amountOut, timestamp);
            continue;
          }
        }
        valuationComplete = false;
      }
    }
  }

  const currentSnapshot = await marketSnapshot();
  const historicalSnapshot = historicalBlock
    ? await marketSnapshot(historicalBlock).catch(() => ({
        tvl: currentSnapshot.tvl,
        borrowed: currentSnapshot.borrowed,
        complete: false,
      }))
    : {
        tvl: currentSnapshot.tvl,
        borrowed: currentSnapshot.borrowed,
        complete: false,
      };
  if (!currentSnapshot.complete || !historicalSnapshot.complete) {
    valuationComplete = false;
  }
  const activePositions = countPositions();
  const historicalPositions = countPositions(historicalBlock ?? undefined);

  return {
    stats: {
      tvl: {
        valueUsdMicro: currentSnapshot.tvl.toString(),
        trend: trend(currentSnapshot.tvl, historicalSnapshot.tvl, "vs 24h ago"),
      },
      totalVolume: {
        valueUsdMicro: volume.lifetime.toString(),
        trend: trend(
          volume.lifetime,
          volume.lifetime > volume.latest24h
            ? volume.lifetime - volume.latest24h
            : 0n,
          "vs 24h ago",
        ),
      },
      totalBorrowed: {
        valueUsdMicro: currentSnapshot.borrowed.toString(),
        trend: trend(currentSnapshot.borrowed, historicalSnapshot.borrowed, "vs 24h ago"),
      },
      activePositions: {
        value: activePositions.toString(),
        trend: trend(activePositions, historicalPositions, "vs 24h ago"),
      },
    },
    volume: {
      actionCount: volume.actions,
      latest24hUsdMicro: volume.latest24h.toString(),
      previous24hUsdMicro: volume.previous24h.toString(),
      categories: Object.fromEntries(
        Array.from(categoryVolume.entries()).map(([key, value]) => [key, value.toString()]),
      ),
    },
    coverage: {
      complete: eventHistoryComplete && routeHistoryComplete && valuationComplete,
      eventHistoryComplete,
      routeHistoryComplete,
      valuationComplete,
      participantCount: participants.size,
      indexedParticipantCount: selectedParticipants.length,
      methodology:
        "Lifetime volume counts one canonical notional for Lendora supply, withdraw, borrow, repay, liquidation, earn deposit/withdraw, and marketplace purchase events. Swap and Arc-origin bridge amounts are included only for wallets after their first canonical Lendora event and only through the exact routes configured by Lendora. Approvals, failed transactions, fees, internal transfers, interest accrual, rewards, and both sides of a single action are excluded.",
      routeAttribution:
        "Swap and CCTP contracts are shared infrastructure. Route activity is attributable to known Lendora participants and configured routes, but cannot prove which frontend initiated it without an Lendora-owned routing contract.",
    },
    updatedAt: new Date().toISOString(),
  };
}

export async function GET() {
  try {
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return NextResponse.json(cached.payload, {
        headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
      });
    }
    inFlight ??= buildStats().finally(() => {
      inFlight = null;
    });
    const payload = await inFlight;
    cached = { payload, expiresAt: now + CACHE_MS };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (error) {
    if (cached) {
      return NextResponse.json(cached.payload, {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300",
          "X-ArcLend-Stats": "stale",
        },
      });
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Protocol statistics are unavailable.",
      },
      { status: 503 },
    );
  }
}
