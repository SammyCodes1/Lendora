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
