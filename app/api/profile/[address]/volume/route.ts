import { NextResponse } from "next/server";
import {
  decodeEventLog,
  getAddress,
  isAddress,
  toEventSelector,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";
import deployments from "@/constants/deployments.json";
import domainMarketplaceJson from "@/constants/abis/DomainMarketplace.json";
import earnVaultJson from "@/constants/abis/EarnVault.json";
import lendingPoolJson from "@/constants/abis/LendingPool.json";
import priceOracleJson from "@/constants/abis/MockPriceOracle.json";
import swapPoolJson from "@/constants/abis/SwapPool.json";
import { ARC_DEX_TOKENS } from "@/lib/arcDex";
import { enforceRateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPLORER_LEGACY_API = "https://testnet.arcscan.app/api";
const MAX_LOG_RESULTS = 1_000;
const USD_SCALE = 1_000_000n;

const lendingPoolAbi = lendingPoolJson as Abi;
const earnVaultAbi = earnVaultJson as Abi;
const domainMarketplaceAbi = domainMarketplaceJson as Abi;
const priceOracleAbi = priceOracleJson as Abi;
const swapPoolAbi = swapPoolJson as Abi;

type CategoryId =
  | "lending"
  | "borrowing"
  | "earn"
  | "liquidations"
  | "marketplace"
  | "swap";

type TokenMeta = {
  address: Address;
  symbol: string;
  decimals: number;
};

type Price = {
  value: bigint;
  decimals: number;
  source: "oracle" | "stablecoin";
};

type HistoricalPrice = Price & {
  blockNumber: bigint;
  logIndex: bigint;
};

type ExplorerLog = {
  address?: string;
  blockNumber?: string;
  data: Hex;
  logIndex?: string;
  topics: Hex[];
  transactionHash: Hex;
};

type LegacyLogsResponse = {
  status?: string;
  message?: string;
  result?: ExplorerLog[] | string;
};

type CategoryAccumulator = {
  id: CategoryId;
  usdMicro: bigint;
  actions: Set<string>;
  unpricedActions: number;
};

type AssetAccumulator = {
  symbol: string;
  amountMicro: bigint;
  usdMicro: bigint;
  actions: Set<string>;
};

const CATEGORY_ORDER: CategoryId[] = [
  "lending",
  "borrowing",
  "earn",
  "liquidations",
  "marketplace",
  "swap",
];

const CATEGORY_LABELS: Record<CategoryId, string> = {
  lending: "Lending",
  borrowing: "Borrowing",
  earn: "Earn pools",
  liquidations: "Liquidations",
  marketplace: "Marketplace",
  swap: "Swap pool",
};

const STABLECOIN_SYMBOLS = new Set(["USDC", "EURC", "USDT"]);

const TOKEN_BY_ADDRESS = new Map<string, TokenMeta>(
  Object.values(ARC_DEX_TOKENS).map((token) => [
    token.address.toLowerCase(),
    token,
  ]),
);

const NATIVE_USDC: TokenMeta = {
  address: ARC_DEX_TOKENS.USDC.address,
  symbol: "USDC",
  decimals: 6,
};

function categoryAccumulator(id: CategoryId): CategoryAccumulator {
  return {
    id,
    usdMicro: 0n,
    actions: new Set<string>(),
    unpricedActions: 0,
  };
}

function eventFromAbi(abi: Abi, name: string) {
  const event = abi.find(
    (item): item is AbiEvent => item.type === "event" && item.name === name,
  );
  if (!event) throw new Error("Missing " + name + " event in deployed ABI");
  return event;
}

function paddedAddressTopic(address: Address): Hex {
  return ("0x" + address.slice(2).toLowerCase().padStart(64, "0")) as Hex;
}

async function explorerJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    // Always re-query ArcScan so profile volume updates after new txs.
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error("ArcScan request failed with " + response.status);
  }
  return response.json() as Promise<T>;
}

async function queryLogs({
  contract,
  abi,
  eventName,
  fromBlock,
  user,
  userTopic,
}: {
  contract: Address;
  abi: Abi;
  eventName: string;
  fromBlock: number;
  user?: Address;
  userTopic?: 1 | 2 | 3;
}) {
  const event = eventFromAbi(abi, eventName);
  const query = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    address: contract,
    fromBlock: String(fromBlock),
    toBlock: "latest",
    topic0: toEventSelector(event),
  });
  if (user && userTopic) {
    query.set("topic" + userTopic, paddedAddressTopic(user));
    query.set("topic0_" + userTopic + "_opr", "and");
  }

  const response = await explorerJson<LegacyLogsResponse>(
    EXPLORER_LEGACY_API + "?" + query.toString(),
  );
  const logs = Array.isArray(response.result) ? response.result : [];
  return {
    logs,
    complete: logs.length < MAX_LOG_RESULTS,
    abi,
    eventName,
  };
}

function decodedArgs(
  abi: Abi,
  eventName: string,
  log: ExplorerLog,
): Record<string, unknown> {
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

function explorerBigInt(value?: string) {
  if (!value) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

async function oraclePriceHistory(token: Address) {
  const query = await queryLogs({
    contract: deployments.priceOracle as Address,
    abi: priceOracleAbi,
    eventName: "PriceUpdated",
    fromBlock: 0,
    user: token,
    userTopic: 1,
  });
  let complete = query.complete;
  const prices: HistoricalPrice[] = [];

  for (const log of query.logs) {
    try {
      const args = decodedArgs(query.abi, query.eventName, log);
      const value = bigintArg(args, "price");
      const blockNumber = explorerBigInt(log.blockNumber);
      const logIndex = explorerBigInt(log.logIndex) ?? 0n;
      if (value === null || blockNumber === null) {
        complete = false;
        continue;
      }
      prices.push({
        value,
        decimals: 8,
        source: "oracle",
        blockNumber,
        logIndex,
      });
    } catch {
      complete = false;
    }
  }

  prices.sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex < b.logIndex
        ? -1
        : a.logIndex > b.logIndex
          ? 1
          : 0
      : a.blockNumber < b.blockNumber
        ? -1
        : 1,
  );
  return { complete, prices };
}

function priceAtBlock(
  histories: Map<string, HistoricalPrice[]>,
  token: TokenMeta,
  blockNumber: bigint | null,
): Price | null {
  // Stablecoins on Arc Testnet: peg at $1 so volume still updates when oracle
  // PriceUpdated history is sparse or missing.
  if (STABLECOIN_SYMBOLS.has(token.symbol)) {
    return { value: 1n, decimals: 0, source: "stablecoin" };
  }
  if (blockNumber === null) return null;

  const prices = histories.get(token.address.toLowerCase()) ?? [];
  for (let index = prices.length - 1; index >= 0; index -= 1) {
    const price = prices[index];
    if (price.blockNumber <= blockNumber) return price;
  }
  return null;
}

function toUsdMicro(amount: bigint, token: TokenMeta, price: Price) {
  return (
    (amount * price.value * USD_SCALE) /
    (10n ** BigInt(token.decimals) * 10n ** BigInt(price.decimals))
  );
}

function toTokenMicro(amount: bigint, decimals: number) {
  if (decimals === 6) return amount;
  if (decimals > 6) return amount / 10n ** BigInt(decimals - 6);
  return amount * 10n ** BigInt(6 - decimals);
}

function normalizedAddress(value?: string | null) {
  return value && isAddress(value) ? value.toLowerCase() : null;
}

function tokenForAddress(value: Address) {
  return TOKEN_BY_ADDRESS.get(value.toLowerCase()) ?? null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: rawAddress } = await params;
  const limited = enforceRateLimit(request, {
    scope: "profile-volume",
    key: rawAddress.toLowerCase(),
    limit: 8,
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
  const categories = new Map<CategoryId, CategoryAccumulator>(
    CATEGORY_ORDER.map((id) => [id, categoryAccumulator(id)]),
  );
  const assets = new Map<string, AssetAccumulator>();
  const seenActions = new Set<string>();
  const warnings: string[] = [];
  let valuationComplete = true;

  const oracleTokens = Object.values(ARC_DEX_TOKENS).filter(
    (token) => token.symbol !== "USDT",
  );
  const settledPriceHistories = await Promise.allSettled(
    oracleTokens.map((token) => oraclePriceHistory(token.address)),
  );
  const priceHistories = new Map<string, HistoricalPrice[]>();
  let oracleHistoryComplete = true;

  settledPriceHistories.forEach((result, index) => {
    if (result.status === "rejected") {
      oracleHistoryComplete = false;
      return;
    }
    if (!result.value.complete) oracleHistoryComplete = false;
    priceHistories.set(
      oracleTokens[index].address.toLowerCase(),
      result.value.prices,
    );
  });

  const addVolume = (
    categoryId: CategoryId,
    actionId: string,
    token: TokenMeta,
    amount: bigint,
    blockNumber: bigint | null,
  ) => {
    if (amount <= 0n || seenActions.has(actionId)) return;
    seenActions.add(actionId);

    const category = categories.get(categoryId)!;
    category.actions.add(actionId);
    const price = priceAtBlock(priceHistories, token, blockNumber);
    const usdMicro = price ? toUsdMicro(amount, token, price) : 0n;
    if (!price) {
      category.unpricedActions += 1;
      valuationComplete = false;
    }
    category.usdMicro += usdMicro;

    const asset =
      assets.get(token.symbol) ??
      {
        symbol: token.symbol,
        amountMicro: 0n,
        usdMicro: 0n,
        actions: new Set<string>(),
      };
    asset.amountMicro += toTokenMicro(amount, token.decimals);
    asset.usdMicro += usdMicro;
    asset.actions.add(actionId);
    assets.set(token.symbol, asset);
  };

  const logQueries = [
    queryLogs({
      contract: deployments.lendingPool as Address,
      abi: lendingPoolAbi,
      eventName: "Supply",
      fromBlock: deployments.deploymentBlock,
      user: address,
      userTopic: 3,
    }),
    queryLogs({
      contract: deployments.lendingPool as Address,
      abi: lendingPoolAbi,
      eventName: "Withdraw",
      fromBlock: deployments.deploymentBlock,
      user: address,
      userTopic: 2,
    }),
    queryLogs({
      contract: deployments.lendingPool as Address,
      abi: lendingPoolAbi,
      eventName: "Borrow",
      fromBlock: deployments.deploymentBlock,
      user: address,
      userTopic: 3,
    }),
    queryLogs({
      contract: deployments.lendingPool as Address,
      abi: lendingPoolAbi,
      eventName: "Repay",
      fromBlock: deployments.deploymentBlock,
      user: address,
      userTopic: 3,
    }),
    queryLogs({
      contract: deployments.lendingPool as Address,
      abi: lendingPoolAbi,
      eventName: "LiquidationCall",
      fromBlock: deployments.deploymentBlock,
    }),
    ...Object.values(deployments.earnVaults).flatMap((vault) => [
      queryLogs({
        contract: vault as Address,
        abi: earnVaultAbi,
        eventName: "Deposit",
        fromBlock: deployments.earnVaultDeploymentBlock,
        user: address,
        userTopic: 2,
      }),
      queryLogs({
        contract: vault as Address,
        abi: earnVaultAbi,
        eventName: "Withdraw",
        fromBlock: deployments.earnVaultDeploymentBlock,
        user: address,
        userTopic: 3,
      }),
    ]),
    queryLogs({
      contract: deployments.DomainMarketplace as Address,
      abi: domainMarketplaceAbi,
      eventName: "DomainPurchased",
      fromBlock: deployments.domainMarketplaceDeploymentBlock,
      user: address,
      userTopic: 2,
    }),
    queryLogs({
      contract: deployments.DomainMarketplace as Address,
      abi: domainMarketplaceAbi,
      eventName: "DomainPurchased",
      fromBlock: deployments.domainMarketplaceDeploymentBlock,
      user: address,
      userTopic: 3,
    }),
    // ArcLend-native SwapPool — attributed to ArcLend (not shared public routers).
    ...(deployments.SwapPool && deployments.swapPoolDeploymentBlock
      ? [
          queryLogs({
            contract: deployments.SwapPool as Address,
            abi: swapPoolAbi,
            eventName: "Swap",
            fromBlock: deployments.swapPoolDeploymentBlock,
            user: address,
            userTopic: 1,
          }),
          queryLogs({
            contract: deployments.SwapPool as Address,
            abi: swapPoolAbi,
            eventName: "LiquidityAdded",
            fromBlock: deployments.swapPoolDeploymentBlock,
            user: address,
            userTopic: 1,
          }),
          queryLogs({
            contract: deployments.SwapPool as Address,
            abi: swapPoolAbi,
            eventName: "LiquidityRemoved",
            fromBlock: deployments.swapPoolDeploymentBlock,
            user: address,
            userTopic: 1,
          }),
        ]
      : []),
  ];

  let logHistoryComplete = true;
  const settledLogQueries = await Promise.allSettled(logQueries);
  settledLogQueries.forEach((result) => {
    if (result.status === "rejected") {
      logHistoryComplete = false;
      return;
    }
    const query = result.value;
    if (!query.complete) logHistoryComplete = false;

    query.logs.forEach((log, index) => {
      try {
        const args = decodedArgs(query.abi, query.eventName, log);
        const suffix =
          log.logIndex ?? query.eventName + ":" + String(index);
        const actionId =
          query.eventName + ":" + log.transactionHash + ":" + suffix;
        const blockNumber = explorerBigInt(log.blockNumber);

        if (
          query.abi === lendingPoolAbi &&
          (query.eventName === "Supply" || query.eventName === "Withdraw")
        ) {
          const asset = addressArg(args, "asset");
          const amount = bigintArg(args, "amount");
          const token = asset ? tokenForAddress(asset) : null;
          if (token && amount !== null) {
            addVolume("lending", actionId, token, amount, blockNumber);
          }
          return;
        }

        if (
          query.abi === lendingPoolAbi &&
          (query.eventName === "Borrow" || query.eventName === "Repay")
        ) {
          const asset = addressArg(args, "asset");
          const amount = bigintArg(args, "amount");
          const token = asset ? tokenForAddress(asset) : null;
          if (token && amount !== null) {
            addVolume("borrowing", actionId, token, amount, blockNumber);
          }
          return;
        }

        if (
          query.abi === earnVaultAbi &&
          (query.eventName === "Deposit" || query.eventName === "Withdraw")
        ) {
          const amount = bigintArg(args, "assets");
          const vaultAddress = normalizedAddress(log.address);
          const vaultEntry = Object.entries(deployments.earnVaults).find(
            ([, vault]) => vault.toLowerCase() === vaultAddress,
          );
          const token = vaultEntry
            ? ARC_DEX_TOKENS[
                vaultEntry[0] as keyof typeof ARC_DEX_TOKENS
              ]
            : null;
          if (token && amount !== null) {
            addVolume("earn", actionId, token, amount, blockNumber);
          }
          return;
        }

        if (query.eventName === "LiquidationCall") {
          const borrower = addressArg(args, "user");
          const liquidator = addressArg(args, "liquidator");
          if (
            borrower?.toLowerCase() !== address.toLowerCase() &&
            liquidator?.toLowerCase() !== address.toLowerCase()
          ) {
            return;
          }
          const debtAsset = addressArg(args, "debtAsset");
          const amount = bigintArg(args, "debtCovered");
          const token = debtAsset ? tokenForAddress(debtAsset) : null;
          if (token && amount !== null) {
            addVolume("liquidations", actionId, token, amount, blockNumber);
          }
          return;
        }

        if (query.eventName === "DomainPurchased") {
          const amount = bigintArg(args, "price");
          if (amount !== null) {
            addVolume("marketplace", actionId, NATIVE_USDC, amount, blockNumber);
          }
          return;
        }

        if (query.abi === swapPoolAbi && query.eventName === "Swap") {
          const tokenIn = addressArg(args, "tokenIn");
          const amountIn = bigintArg(args, "amountIn");
          const token = tokenIn ? tokenForAddress(tokenIn) : null;
          if (token && amountIn !== null) {
            addVolume("swap", actionId, token, amountIn, blockNumber);
          }
          return;
        }

        if (
          query.abi === swapPoolAbi &&
          (query.eventName === "LiquidityAdded" ||
            query.eventName === "LiquidityRemoved")
        ) {
          const amountA = bigintArg(args, "amountA");
          const amountB = bigintArg(args, "amountB");
          // One LP action; sum both asset notionals into volume.
          if (amountA !== null && amountA > 0n) {
            addVolume("swap", actionId, ARC_DEX_TOKENS.USDC, amountA, blockNumber);
          }
          if (amountB !== null && amountB > 0n) {
            // Second leg: credit EURC without double-counting the action id.
            const secondaryId = actionId + ":B";
            if (!seenActions.has(secondaryId) && amountB > 0n) {
              seenActions.add(secondaryId);
              const category = categories.get("swap")!;
              const price = priceAtBlock(
                priceHistories,
                ARC_DEX_TOKENS.EURC,
                blockNumber,
              );
              const usdMicro = price
                ? toUsdMicro(amountB, ARC_DEX_TOKENS.EURC, price)
                : 0n;
              if (!price) {
                category.unpricedActions += 1;
                valuationComplete = false;
              }
              category.usdMicro += usdMicro;
              const asset =
                assets.get("EURC") ??
                {
                  symbol: "EURC",
                  amountMicro: 0n,
                  usdMicro: 0n,
                  actions: new Set<string>(),
                };
              asset.amountMicro += toTokenMicro(amountB, 6);
              asset.usdMicro += usdMicro;
              asset.actions.add(actionId);
              assets.set("EURC", asset);
            }
          }
        }
      } catch {
        logHistoryComplete = false;
      }
    });
  });

  if (!logHistoryComplete) {
    warnings.push(
      "One or more protocol event queries were incomplete; the displayed total is a lower bound.",
    );
  }

  if (!oracleHistoryComplete) {
    warnings.push(
      "One or more oracle price-history queries were incomplete; the displayed USD total may be understated.",
    );
  }
  if (!valuationComplete) {
    warnings.push(
      "At least one action used an asset without a verified USD price; its token amount is shown but excluded from the USD total.",
    );
  }

  const totalUsdMicro = CATEGORY_ORDER.reduce(
    (sum, id) => sum + categories.get(id)!.usdMicro,
    0n,
  );
  const actionCount = CATEGORY_ORDER.reduce(
    (sum, id) => sum + categories.get(id)!.actions.size,
    0,
  );

  return NextResponse.json({
    address,
    totalUsdMicro: totalUsdMicro.toString(),
    actionCount,
    categories: CATEGORY_ORDER.map((id) => {
      const category = categories.get(id)!;
      return {
        id,
        label: CATEGORY_LABELS[id],
        usdMicro: category.usdMicro.toString(),
        actionCount: category.actions.size,
        unpricedActions: category.unpricedActions,
        attribution: "protocol-event",
      };
    }),
    assets: Array.from(assets.values())
      .sort((a, b) => (a.usdMicro === b.usdMicro ? 0 : a.usdMicro > b.usdMicro ? -1 : 1))
      .map((asset) => ({
        symbol: asset.symbol,
        amountMicro: asset.amountMicro.toString(),
        usdMicro: asset.usdMicro.toString(),
        actionCount: asset.actions.size,
      })),
    coverage: {
      complete:
        logHistoryComplete &&
        oracleHistoryComplete &&
        valuationComplete,
      protocolEventsComplete: logHistoryComplete,
      oracleHistoryComplete,
      valuationComplete,
      methodology:
        "Gross lifetime notional counts one amount for every successful ArcLend protocol event: supply, withdraw, borrow, repay, earn deposit, earn withdrawal, liquidation, marketplace purchase, and ArcLend SwapPool swap / LP add / LP remove. Entry and exit actions are both counted, so this is activity volume rather than net deposits or TVL.",
      valuation:
        "USDC, EURC, and USDT use a $1 stablecoin convention. Other assets use the latest ArcLend oracle price available at that action's block.",
      scope:
        "Only ArcLend-deployed contracts are counted. Shared public DEX routers (Curve, Xylo, Tower, Synthra) and bridges are excluded because they cannot be reliably attributed to ArcLend alone.",
      exclusions: [
        "Wallet transfers unrelated to ArcLend",
        "Swaps and bridges through shared public routes (Curve, Xylo, Tower, Synthra, CCTP)",
        "Approvals, fees, aToken/debt-token minting, and internal transfers",
        "The collateral side of a liquidation",
        "Failed or reverted transactions",
        "Referral accounting events that duplicate an earn-vault deposit",
        "Claims, rewards, and interest accrual that are not new user notional",
      ],
      warnings,
    },
    updatedAt: new Date().toISOString(),
  });
}
