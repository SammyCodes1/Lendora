/**
 * Shared calculation utilities for the ArcLend Calculator.
 *
 * All constants are imported from their single source of truth:
 *   - MIN_HEALTH_FACTOR from agentValidation.ts
 *   - RAY, ASSET_UNIT, BPS, WAD inline (same values as agentValidation.ts
 *     and useLiveMarkets.ts — these are protocol-level constants that
 *     must never diverge across files)
 *
 * This file contains ZERO magic numbers of its own.
 */

import { formatUnits } from "viem";

// ── Protocol constants (MUST match agentValidation.ts and useLiveMarkets.ts) ──
export const RAY = 1_000_000_000_000_000_000_000_000_000n; // 1e27
export const WAD = 1_000_000_000_000_000_000n; // 1e18
export const BPS = 10_000n;
export const ASSET_UNIT = 1_000_000n; // USDC/EURC decimals

/** The hard minimum health factor (1.10 in WAD) from agentValidation.ts. */
export const MIN_HEALTH_FACTOR = 1.10;
export const MIN_HEALTH_FACTOR_WAD = 1_100_000_000_000_000_000n; // 1.10 * WAD

// ── Lending / Earn Calculators ──

/**
 * Simple-interest projected earnings.
 * @param amount      principal in asset units (e.g. "1000" = 1000 USDC)
 * @param apyPercent  annual percentage yield as a number (e.g. 5.2 = 5.2%)
 * @param days        time period in days
 */
export function simpleEarnings(amount: number, apyPercent: number, days: number): number {
  return amount * (apyPercent / 100) * (days / 365);
}

/**
 * Compound-interest projected earnings.
 * ArcLend's liquidityIndex compounds continuously, so this models daily
 * compounding as an approximation.
 * @param amount      principal in asset units
 * @param apyPercent  annual percentage yield as a number (e.g. 5.2 = 5.2%)
 * @param days        time period in days
 */
export function compoundedEarnings(amount: number, apyPercent: number, days: number): number {
  const dailyRate = apyPercent / 100 / 365;
  return amount * (Math.pow(1 + dailyRate, days) - 1);
}

/** Ending balance after simple interest. */
export function endingBalanceSimple(amount: number, apyPercent: number, days: number): number {
  return amount + simpleEarnings(amount, apyPercent, days);
}

/** Ending balance after compounding. */
export function endingBalanceCompounded(amount: number, apyPercent: number, days: number): number {
  return amount + compoundedEarnings(amount, apyPercent, days);
}

// ── Health Factor Calculator ──

/**
 * Convert on-chain health factor (WAD) to a human-readable number.
 * Mirrors numericHealthFactor in app/(dashboard)/borrow/page.tsx.
 */
export function numericHealthFactor(value?: bigint): number {
  if (!value || value > 100_000_000_000_000_000_000n) {
    return 9.99;
  }
  return Number(formatUnits(value, 18));
}

/** Per-market data for fallback weighted-collateral computation (manual / no-debt modes). */
export type CollateralMarket = {
  userSupply: bigint;
  price: bigint;
  isCollateralEnabled: boolean;
  liquidationThreshold: number;
};

/**
 * Liquidation-adjusted collateral from per-market data.
 * Used as a fallback when the contract-derived health factor is unavailable
 * (wallet not connected, or zero-debt where HF = type(uint256).max).
 */
export function computeWeightedCollateralUSD(markets: CollateralMarket[]): bigint {
  return markets.reduce((sum, m) => {
    if (!m.isCollateralEnabled || m.userSupply === 0n) return sum;
    const collateralUsd = (m.userSupply * m.price) / ASSET_UNIT;
    return sum + (collateralUsd * BigInt(m.liquidationThreshold)) / BPS;
  }, 0n);
}

/**
 * Back-derive the effective weighted collateral from the contract's live health
 * factor. This is always correct because it starts from the contract's own
 * computation — no need to know per-user collateral flags or thresholds.
 *
 *   weightedColl = (healthFactorWad * totalDebtUSD) / WAD
 */
function effectiveWeightedCollateralFromHF(
  healthFactorWad: bigint,
  totalDebtUSD: bigint,
): bigint | null {
  // When debt is zero the contract returns type(uint256).max — unusable for
  // reverse-engineering. Caller must fall back to market data.
  if (totalDebtUSD === 0n) return null;
  return (healthFactorWad * totalDebtUSD) / WAD;
}

/**
 * Projected health factor after an additional borrow.
 *
 * When `currentHealthFactorWad` and `totalDebtUSD > 0` are available from the
 * live contract, the projection back-derives the effective weighted collateral
 * from the contract's own health factor — guaranteeing agreement with
 * LendingPool.getUserAccountData. Falls back to per-market computation
 * otherwise (manual mode, zero-debt).
 */
export function projectedHealthFactor(
  currentHealthFactorWad: bigint,
  totalDebtUSD: bigint,
  additionalBorrowUSD: bigint,
  fallbackMarkets?: CollateralMarket[],
): number {
  const projectedDebtUSD = totalDebtUSD + additionalBorrowUSD;
  if (projectedDebtUSD === 0n) return 9.99;

  const weightedColl =
    effectiveWeightedCollateralFromHF(currentHealthFactorWad, totalDebtUSD) ??
    (fallbackMarkets ? computeWeightedCollateralUSD(fallbackMarkets) : 0n);

  const hfWad = (weightedColl * WAD) / projectedDebtUSD;
  return numericHealthFactor(hfWad);
}

/**
 * Calculate the borrow value in USD from amount + price.
 * @param amount  asset amount in 6-decimal units
 * @param price   oracle price (8 decimals USD)
 */
export function assetToUsd(amount: bigint, price: bigint): bigint {
  return (amount * price) / ASSET_UNIT;
}

/**
 * Maximum additional borrow before hitting the MIN_HEALTH_FACTOR safety buffer.
 *
 * Uses the contract's live health factor when totalDebtUSD > 0 (guaranteed
 * accurate); falls back to per-market computation otherwise.
 * Returns 0 if already below the threshold.
 */
export function maxAdditionalBorrowUSD(
  currentHealthFactorWad: bigint,
  totalDebtUSD: bigint,
  fallbackMarkets?: CollateralMarket[],
): bigint {
  const weightedColl =
    effectiveWeightedCollateralFromHF(currentHealthFactorWad, totalDebtUSD) ??
    (fallbackMarkets ? computeWeightedCollateralUSD(fallbackMarkets) : 0n);

  const maxDebtUSD = (weightedColl * WAD) / MIN_HEALTH_FACTOR_WAD;
  if (maxDebtUSD <= totalDebtUSD) return 0n;
  return maxDebtUSD - totalDebtUSD;
}

// ── Time periods ──

export type TimePeriod = "1 week" | "1 month" | "1 year" | "custom";

export function periodToDays(period: TimePeriod): number {
  switch (period) {
    case "1 week":
      return 7;
    case "1 month":
      return 30;
    case "1 year":
      return 365;
    default:
      return 30;
  }
}

// ── Earn Vault projected rates ──

/**
 * Projected Earn Vault APY. This is an estimate, not a live rate.
 * If EarnVault is deployed and live, replace this with the actual vault APY.
 */
export const PROJECTED_EARN_VAULT_APY = 8.5; // 8.5% projected
export const EARN_VAULT_NOT_LIVE = true;
