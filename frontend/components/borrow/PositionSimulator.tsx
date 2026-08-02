"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { HealthFactorRing } from "@/components/ui/HealthFactorRing";
import { HealthFactorValue } from "@/components/ui/HealthFactorValue";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { SectionLabel } from "@/components/ui/MarketVisuals";
import type { UserAccountData } from "@/hooks/useLendingPool";
import type { MarketAsset } from "@/components/modals/types";
import { cn } from "@/lib/utils";

type PositionSimulatorProps = {
  accountData?: UserAccountData;
  markets: MarketAsset[];
  isConnected: boolean;
  isPaused: boolean;
};

const ASSET_SYMBOLS = ["USDC", "EURC"] as const;
type AssetSymbol = (typeof ASSET_SYMBOLS)[number];

// Mirrors BorrowModal.maxBorrow: convert the wallet's USD borrowing power into
// this asset's units, then cap by pool liquidity and the per-asset borrow cap.
function maxBorrowFor(market: MarketAsset | undefined, availableUsd: bigint) {
  if (!market) return 0n;
  const price = market.price || 1n;
  const availableByCollateral = (availableUsd * 1_000_000n) / price;
  let max =
    availableByCollateral < market.availableLiquidity
      ? availableByCollateral
      : market.availableLiquidity;
  if (market.isBorrowCapped && market.remainingBorrowCap < max) {
    max = market.remainingBorrowCap;
  }
  return max;
}

// Mirrors BorrowModal.liquidationCapacityUsd: sum of each collateral asset's
// USD value weighted by its liquidation threshold (8-decimal USD).
function liquidationCapacityUsdOf(markets: MarketAsset[]) {
  return markets.reduce(
    (sum, item) =>
      sum +
      (((item.userSupply * item.price) / 1_000_000n) *
        BigInt(item.liquidationThreshold)) /
        10_000n,
    0n,
  );
}

export function PositionSimulator({
  accountData,
  markets,
  isConnected,
  isPaused,
}: PositionSimulatorProps) {
  const [selectedSymbol, setSelectedSymbol] = useState<AssetSymbol>("USDC");
  const [simPct, setSimPct] = useState(0);

  const selectedMarket =
    markets.find((market) => market.symbol === selectedSymbol) ?? markets[0];

  const availableUsd = accountData?.availableBorrowsUSD ?? 0n;
  const maxBorrow = useMemo(
    () => maxBorrowFor(selectedMarket, availableUsd),
    [selectedMarket, availableUsd],
  );

  // Reset the slider when switching assets or when nothing can be borrowed.
  useEffect(() => {
    setSimPct(0);
  }, [selectedSymbol, maxBorrow]);

  const simulatedAmount = maxBorrow > 0n ? (maxBorrow * BigInt(simPct)) / 1000n : 0n;
  const price = selectedMarket?.price || 1n;
  const currentDebtUsd = accountData?.totalDebtUSD ?? 0n;
  const liquidationCapacityUsd = useMemo(
    () => liquidationCapacityUsdOf(markets),
    [markets],
  );
  const requestedDebtUsd = (simulatedAmount * price) / 1_000_000n;
  const projectedDebtUsd = currentDebtUsd + requestedDebtUsd;
  const projectedHealth =
    projectedDebtUsd > 0n
      ? Number((liquidationCapacityUsd * 1_000_000n) / projectedDebtUsd) /
        1_000_000
      : 10;
  const ltvPercent =
    liquidationCapacityUsd > 0n && projectedDebtUsd > 0n
      ? (Number(projectedDebtUsd) / Number(liquidationCapacityUsd)) * 100
      : 0;
  const availableRemainingUsd =
    liquidationCapacityUsd > projectedDebtUsd
      ? liquidationCapacityUsd - projectedDebtUsd
      : 0n;

  // Simplified single-asset liquidation price: the collateral with the largest
  // supplied USD value, holding every other asset at its current price.
  const collateralAssets = markets.filter((market) => market.userSupply > 0n);
  const primaryCollateral = collateralAssets.reduce(
    (best, market) => {
      const usd = (market.userSupply * market.price) / 1_000_000n;
      const bestUsd = best
        ? (best.userSupply * best.price) / 1_000_000n
        : 0n;
      return usd > bestUsd ? market : best;
    },
    undefined as MarketAsset | undefined,
  );
  const liqPrice =
    primaryCollateral && projectedDebtUsd > 0n
      ? (projectedDebtUsd * 1_000_000n) /
        ((primaryCollateral.userSupply *
          BigInt(primaryCollateral.liquidationThreshold)) /
          10_000n)
      : 0n;

  const simulatedTokens = Number(formatUnits(simulatedAmount, 6));
  const simulatedUsd = Number(formatUnits(requestedDebtUsd, 8));
  const healthClass =
    projectedHealth > 1.5
      ? "text-white"
      : projectedHealth >= 1
        ? "text-white/70"
        : "text-red-300";
  const fillPercent = (simPct / 10).toFixed(2);

  return (
    <GlassCard depth="foreground" className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <SectionLabel>What-if simulator</SectionLabel>
          <h2 className="mt-2 text-xl font-semibold text-white">
            Position Simulator
          </h2>
          <p className="mt-1 max-w-xl text-xs leading-5 text-white/40">
            Drag the slider to preview how an additional borrow would change
            your health factor, LTV, and liquidation risk — before committing a
            transaction.
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-white/[0.09] bg-black/20 p-1">
          {ASSET_SYMBOLS.map((symbol) => (
            <button
              key={symbol}
              type="button"
              onClick={() => setSelectedSymbol(symbol)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium transition",
                selectedSymbol === symbol
                  ? "bg-white text-black"
                  : "text-white/55 hover:text-white",
              )}
            >
              {symbol}
            </button>
          ))}
        </div>
      </div>

      {!isConnected ? (
        <div className="mt-6 flex flex-col items-start gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">
              Connect wallet to simulate
            </h3>
            <p className="mt-1 text-sm text-white/50">
              Your collateral, borrowing power, and health factor are needed to
              run projections.
            </p>
          </div>
          <ConnectWalletButton />
        </div>
      ) : liquidationCapacityUsd === 0n ? (
        <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-6 text-center">
          <h3 className="text-lg font-semibold text-white">
            Supply collateral first
          </h3>
          <p className="mt-1 text-sm text-white/50">
            The simulator projects borrowing against your collateral. Deposit
            assets on the Supply page to unlock projections.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-white/50">
                Simulated borrow
              </span>
              <span className="font-mono text-white">
                <AnimatedNumber value={simulatedTokens} decimals={6} />{" "}
                {selectedMarket?.symbol}{" "}
                <span className="text-white/40">
                  ≈ $<AnimatedNumber value={simulatedUsd} decimals={2} />
                </span>
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={simPct}
              disabled={maxBorrow === 0n}
              onChange={(event) => setSimPct(Number(event.target.value))}
              aria-label={`Simulated borrow amount of ${selectedMarket?.symbol}`}
              className={cn(
                "mt-4 h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 [&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-white/10",
                "disabled:cursor-not-allowed disabled:opacity-50",
                "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_0_12px_rgba(255,255,255,0.4)]",
                "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-[0_0_12px_rgba(255,255,255,0.4)]",
              )}
              style={{
                background: `linear-gradient(to right, rgba(255,255,255,0.85) ${fillPercent}%, rgba(255,255,255,0.1) ${fillPercent}%)`,
              }}
            />
            <div className="mt-1.5 flex items-center justify-between text-[10px] text-white/30">
              <span>0</span>
              <span>
                Max {formatUnits(maxBorrow, 6)} {selectedMarket?.symbol}
              </span>
            </div>
            {isPaused ? (
              <p className="mt-3 text-xs text-amber-100/80">
                Protocol is paused — no new borrows can be executed right now,
                but the projection is shown for reference.
              </p>
            ) : maxBorrow === 0n ? (
              <p className="mt-3 text-xs text-amber-100/80">
                Borrowing unavailable for {selectedMarket?.symbol} — check
                collateral, pool cash, and borrow cap.
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 text-center">
              <HealthFactorRing value={projectedHealth} size={140} showValue={false} />
              <HealthFactorValue
                value={projectedHealth}
                className={cn("mt-2 font-mono text-3xl font-medium", healthClass)}
              />
              <p className="mt-1 text-[10px] font-semibold uppercase text-white/35">
                Health Factor
              </p>
            </div>

            <div className="flex flex-col items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 text-center">
              <p className="text-[10px] font-semibold uppercase text-white/35">
                Projected LTV
              </p>
              <AnimatedNumber
                className="mt-2 font-mono text-3xl font-medium text-white"
                value={ltvPercent}
                decimals={2}
                suffix="%"
              />
              <p className="mt-1 text-[11px] leading-4 text-white/40">
                Debt vs. borrowing capacity
              </p>
            </div>

            <div className="flex flex-col items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 text-center">
              <p className="text-[10px] font-semibold uppercase text-white/35">
                Remaining to borrow
              </p>
              <AnimatedNumber
                className="mt-2 font-mono text-3xl font-medium text-white"
                value={Number(formatUnits(availableRemainingUsd, 8))}
                prefix="$"
                decimals={2}
              />
              <p className="mt-1 text-[11px] leading-4 text-white/40">
                After this simulated borrow
              </p>
            </div>

            <div className="flex flex-col items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 text-center">
              <p className="text-[10px] font-semibold uppercase text-white/35">
                Liquidation at
              </p>
              {primaryCollateral ? (
                <>
                  <AnimatedNumber
                    className="mt-2 font-mono text-3xl font-medium text-white"
                    value={Number(formatUnits(liqPrice, 8))}
                    prefix="$"
                    decimals={2}
                  />
                  <p className="mt-1 text-[11px] leading-4 text-white/40">
                    per {primaryCollateral.symbol} — other collateral held at
                    current prices
                  </p>
                </>
              ) : (
                <p className="mt-2 font-mono text-3xl font-medium text-white/30">
                  —
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </GlassCard>
  );
}
