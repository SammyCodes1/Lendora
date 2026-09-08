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
