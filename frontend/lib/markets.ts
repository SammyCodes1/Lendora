import { formatUnits, type Address } from "viem";
import deployments from "@/constants/deployments.json";

export const LENDORA_A_TOKEN_NAME = "Lendora Interest Bearing Token";
export const LENDORA_A_TOKEN_SYMBOL = "aLNDR";
export const LENDORA_DEBT_TOKEN_NAME = "Lendora Variable Debt Token";
export const LENDORA_DEBT_TOKEN_SYMBOL = "debtLNDR";
export const LENDORA_POSITION_NFT_NAME = "Lendora Position Receipt";
export const LENDORA_POSITION_NFT_SYMBOL = "LNDPOS";

export function marketTokenFromBlock() {
  const recorded = (
    deployments as typeof deployments & { marketTokenDeploymentBlock?: number }
  ).marketTokenDeploymentBlock;
  return recorded ?? deployments.deploymentBlock;
}

export function arcscanTokenUrl(address: string) {
  return `https://testnet.arcscan.app/token/${address}`;
}

export function aTokenShareLabel(symbol: "USDC" | "EURC") {
  return `a${symbol}`;
}

export function debtTokenShareLabel(symbol: "USDC" | "EURC") {
  return `d${symbol}`;
}

export type MarketDefinition = {
  name: string;
  symbol: "USDC" | "EURC";
  address: Address;
  aToken: Address;
  debtToken: Address;
};

export const marketDefinitions: MarketDefinition[] = [
  {
    name: "USD Coin",
    symbol: "USDC",
    address: deployments.markets.USDC.asset as Address,
    aToken: deployments.markets.USDC.aToken as Address,
    debtToken: deployments.markets.USDC.debtToken as Address,
  },
  {
    name: "Euro Coin",
    symbol: "EURC",
    address: deployments.markets.EURC.asset as Address,
    aToken: deployments.markets.EURC.aToken as Address,
    debtToken: deployments.markets.EURC.debtToken as Address,
  },
];

export function marketSymbolForAddress(asset: Address) {
  return marketDefinitions.find((market) => market.address.toLowerCase() === asset.toLowerCase())?.symbol ?? "USDC";
}

/** Format an on-chain reserve cap (6-decimal units). 0 = uncapped. */
export function formatReserveCap(
  cap: bigint,
  isCapped: boolean,
  options?: { compact?: boolean },
) {
  if (!isCapped || cap === 0n) {
    return "Unlimited";
  }

  const amount = Number(formatUnits(cap, 6));
  if (options?.compact && amount >= 1_000_000) {
    return `${(amount / 1_000_000).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    })}M`;
  }
  if (options?.compact && amount >= 1_000) {
    return `${(amount / 1_000).toLocaleString(undefined, {
      maximumFractionDigits: 1,
    })}K`;
  }

  return amount.toLocaleString(undefined, {
    maximumFractionDigits: amount >= 100 ? 0 : 2,
  });
}

/** Format remaining capacity under a reserve cap. */
export function formatRemainingCap(
  remaining: bigint,
  isCapped: boolean,
  symbol?: string,
) {
  if (!isCapped) {
    return "Unlimited";
  }

  const amount = Number(formatUnits(remaining, 6));
  const formatted = amount.toLocaleString(undefined, {
    maximumFractionDigits: amount >= 100 ? 0 : 2,
  });
  return symbol ? `${formatted} ${symbol}` : formatted;
}

export type LendoraAssetFilter = "ALL" | "USDC" | "EURC";

export function filterLendoraMarkets<T extends { symbol: "USDC" | "EURC" }>(
  markets: T[],
  filter: LendoraAssetFilter,
) {
  if (filter === "ALL") return markets;
  return markets.filter((market) => market.symbol === filter);
}

/** Percent of cap filled. Falls back to utilization when the reserve is uncapped. */
export function capacityFilledPercent(
  used: bigint,
  cap: bigint,
  isCapped: boolean,
  fallbackUtilization: number,
) {
  if (isCapped && cap > 0n) {
    const percent = Number((used * 10_000n) / cap) / 100;
    return Math.max(0, Math.min(100, percent));
  }
  return Math.max(0, Math.min(100, fallbackUtilization));
}

/** Per-asset borrowable amount in 6-decimal units, matching BorrowModal caps. */
export function maxBorrowableAmount(
  market: {
    price: bigint;
    availableLiquidity: bigint;
    isBorrowCapped: boolean;
    remainingBorrowCap: bigint;
  },
  availableUsd: bigint,
) {
  const price = market.price > 0n ? market.price : 1n;
  const availableByCollateral = (availableUsd * 1_000_000n) / price;
  let maxBorrow =
    availableByCollateral < market.availableLiquidity
      ? availableByCollateral
      : market.availableLiquidity;
  if (market.isBorrowCapped && market.remainingBorrowCap < maxBorrow) {
    maxBorrow = market.remainingBorrowCap;
  }
  if (maxBorrow < 0n) return 0n;
  return maxBorrow;
}

const ASSET_UNIT = 1_000_000n;
const USD_DECIMALS = 8;
const MAX_UINT256 =
  0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn;

export function assetUsdValue(amount: bigint, price: bigint) {
  return (amount * price) / ASSET_UNIT;
}

export function dashboardSuppliedMarkets<T extends { userSupply: bigint }>(
  markets: T[],
) {
  return markets.filter((market) => market.userSupply > 0n);
}

export function dashboardBorrowedMarkets<T extends { userDebt: bigint }>(
  markets: T[],
) {
  return markets.filter((market) => market.userDebt > 0n);
}

export type DashboardPositionMarket = {
  symbol?: "USDC" | "EURC";
  userSupply: bigint;
  userDebt: bigint;
  price: bigint;
  supplyApyValue: number;
  borrowAprValue: number;
};

export function dashboardTotals(markets: DashboardPositionMarket[]) {
  let suppliedUsd = 0n;
  let borrowedUsd = 0n;
  for (const market of markets) {
    suppliedUsd += assetUsdValue(market.userSupply, market.price);
    borrowedUsd += assetUsdValue(market.userDebt, market.price);
  }
  return {
    suppliedUsd,
    borrowedUsd,
    netWorthUsd: suppliedUsd - borrowedUsd,
  };
}

export function dashboardWeightedRate(
  markets: DashboardPositionMarket[],
  field: "userSupply" | "userDebt",
  rate: "supplyApyValue" | "borrowAprValue",
) {
  const total = markets.reduce((sum, market) => sum + Number(market[field]), 0);
  if (total === 0) return 0;
  return (
    markets.reduce(
      (sum, market) => sum + Number(market[field]) * market[rate],
      0,
    ) / total
  );
}

/** Aave V3 net APY. Null when net worth is not positive (UI shows —). */
export function dashboardNetApyPercent(markets: DashboardPositionMarket[]) {
  const { netWorthUsd } = dashboardTotals(markets);
  const netWorth = Number(formatUnits(netWorthUsd, USD_DECIMALS));
  if (!(netWorth > 0)) return null;

  const yearlyUsd = markets.reduce((sum, market) => {
    const supplyUsd = Number(
      formatUnits(assetUsdValue(market.userSupply, market.price), USD_DECIMALS),
    );
    const debtUsd = Number(
      formatUnits(assetUsdValue(market.userDebt, market.price), USD_DECIMALS),
    );
    return (
      sum +
      supplyUsd * (market.supplyApyValue / 100) -
      debtUsd * (market.borrowAprValue / 100)
    );
  }, 0);

  return (yearlyUsd / netWorth) * 100;
}

/** Null when the user has no borrows (Aave hides health factor). */
export function dashboardHealthFactor(value?: bigint | null) {
  if (value === undefined || value === null) return null;
  if (value === MAX_UINT256) return null;
  const numeric = Number(formatUnits(value, 18));
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

export function dashboardBorrowPowerUsedPercent(
  totalDebtUsd: bigint,
  availableBorrowsUsd: bigint,
) {
  const capacity = totalDebtUsd + availableBorrowsUsd;
  if (capacity <= 0n) return 0;
  return Number((totalDebtUsd * 10_000n) / capacity) / 100;
}
