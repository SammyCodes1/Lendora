"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CreditCard, DollarSign, Euro, AlertTriangle, Shield } from "lucide-react";
import { formatUnits, parseUnits } from "viem";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassButton } from "@/components/ui/GlassButton";
import { HealthFactorRing } from "@/components/ui/HealthFactorRing";
import { HealthFactorValue } from "@/components/ui/HealthFactorValue";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import { useUserAccountData } from "@/hooks/useLendingPool";
import { useLiveMarkets } from "@/hooks/useLiveMarkets";
import {
  projectedHealthFactor,
  assetToUsd,
  maxAdditionalBorrowUSD,
  numericHealthFactor,
  MIN_HEALTH_FACTOR,
  type CollateralMarket,
} from "@/lib/calculatorMath";

type Asset = "USDC" | "EURC";

function TokenIcon({ symbol }: { symbol: Asset }) {
  const Icon = symbol === "USDC" ? DollarSign : Euro;
  return <Icon className="h-4 w-4" />;
}

export function HealthFactorCalculator() {
  const { address, isConnected } = useArcLendAccount();
  const { accountData, isPending: accountLoading } = useUserAccountData(address);
  const { markets, isLoading: marketsLoading } = useLiveMarkets();

  // Simulation state
  const [borrowAsset, setBorrowAsset] = useState<Asset>("USDC");
  const [borrowAmount, setBorrowAmount] = useState("");

  // Manual entry for unconnected wallets
  const [manualCollateral, setManualCollateral] = useState("");
  const [manualDebt, setManualDebt] = useState("");
  const [manualCollateralAsset, setManualCollateralAsset] = useState<Asset>("USDC");

  // Debounce borrow amount
  const [debouncedAmount, setDebouncedAmount] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedAmount(borrowAmount), 300);
    return () => clearTimeout(timer);
  }, [borrowAmount]);

  const borrowAmountNum = useMemo(() => {
    const parsed = Number.parseFloat(debouncedAmount);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [debouncedAmount]);

  const borrowAmountBigInt = useMemo(() => {
    if (borrowAmountNum <= 0) return 0n;
    try {
      return parseUnits(borrowAmountNum.toString(), 6);
    } catch {
      return 0n;
    }
  }, [borrowAmountNum]);

  // ── Live data ──
  const selectedBorrowMarket = useMemo(
    () => markets.find((m) => m.symbol === borrowAsset) ?? null,
    [markets, borrowAsset],
  );

  const selectedCollateralMarket = useMemo(
    () => markets.find((m) => m.symbol === manualCollateralAsset) ?? null,
    [markets, manualCollateralAsset],
  );

  const currentHealthFactor = useMemo(() => {
    if (isConnected) {
      return numericHealthFactor(accountData?.healthFactor);
    }
    // Manual entry mode
    const col = Number.parseFloat(manualCollateral);
    const debt = Number.parseFloat(manualDebt);
    if (!Number.isFinite(col) || !Number.isFinite(debt) || debt <= 0 || col <= 0) return 9.99;
    // Simple HF: collateral / debt (weighted by average threshold)
    return col / debt;
  }, [isConnected, accountData, manualCollateral, manualDebt]);

  // Per-market collateral data matching the contract's per-reserve iteration
  const collateralMarkets: CollateralMarket[] = useMemo(
    () =>
      markets.map((m) => ({
        userSupply: m.userSupply,
        price: m.price,
        isCollateralEnabled: m.isCollateralEnabled,
        liquidationThreshold: m.liquidationThreshold,
      })),
    [markets],
  );

  // ── Projection ──
  const projInfo = useMemo(() => {
    if (isConnected && accountData && borrowAmountBigInt > 0n && selectedBorrowMarket) {
      const borrowUsd = assetToUsd(borrowAmountBigInt, selectedBorrowMarket.price);
      // Use the contract's own health factor as the baseline so the projection
      // agrees with LendingPool.getUserAccountData. Fall back to per-market
      // computation only when totalDebtUSD === 0 (HF = type(uint256).max).
      const hf = projectedHealthFactor(
        accountData.healthFactor ?? 0n,
        accountData.totalDebtUSD,
        borrowUsd,
        collateralMarkets,
      );
      const maxBorrow = maxAdditionalBorrowUSD(
        accountData.healthFactor ?? 0n,
        accountData.totalDebtUSD,
        collateralMarkets,
      );
      return {
        mode: "connected" as const,
        projectedHealthFactor: hf,
        maxAdditionalBorrowUSD: maxBorrow,
        isRisky: hf < MIN_HEALTH_FACTOR,
      };
    }

    if (!isConnected && borrowAmountNum > 0 && selectedBorrowMarket && selectedCollateralMarket) {
      const col = Number.parseFloat(manualCollateral);
      const debt = Number.parseFloat(manualDebt);
      if (Number.isFinite(col) && Number.isFinite(debt) && col > 0) {
        const addedDebt = borrowAmountNum;
        const newDebt = debt + addedDebt;
        const hf = newDebt > 0 ? col / newDebt : 9.99;
        return {
          mode: "manual" as const,
          projectedHealthFactor: hf,
          maxAdditionalBorrowUSD: 0n,
          isRisky: col > 0 && newDebt > 0 ? col / newDebt < MIN_HEALTH_FACTOR : false,
        };
      }
    }

    return null;
  }, [
    isConnected, accountData, borrowAmountBigInt, selectedBorrowMarket,
    borrowAmountNum, manualCollateral, manualDebt, selectedCollateralMarket,
    collateralMarkets,
  ]);

  const maxBorrowFormatted = useMemo(() => {
    if (!projInfo || projInfo.mode === "manual") return null;
    if (!selectedBorrowMarket) return null;
    const price = Number(formatUnits(selectedBorrowMarket.price, selectedBorrowMarket.priceDecimals));
    const maxUsd = Number(formatUnits(projInfo.maxAdditionalBorrowUSD, 8));
    if (price <= 0) return null;
    const maxAsset = maxUsd / price;
    return maxAsset.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }, [projInfo, selectedBorrowMarket]);

  const isRisky = projInfo?.isRisky ?? false;
  const isLoading = accountLoading || marketsLoading;

  // Deep-link params for Borrow page
  const borrowDeepLink = useMemo(() => {
    if (!projInfo || isRisky || borrowAmountNum <= 0) return null;
    return `/borrow?asset=${borrowAsset}&amount=${borrowAmount}`;
  }, [projInfo, isRisky, borrowAmountNum, borrowAsset, borrowAmount]);

  return (
    <div className="space-y-5">
      {/* Connected wallet context */}
      {isConnected ? (
        <>
          {isLoading ? (
            <GlassCard depth="background" className="flex items-center justify-center p-10">
              <Skeleton width={200} height={200} className="rounded-full" />
            </GlassCard>
          ) : (
            <GlassCard depth="background" className="p-5 sm:p-6">
              <p className="text-xs font-medium uppercase text-white/35">Current position</p>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-[10px] text-white/35">Collateral</p>
                  <AnimatedNumber
                    className="mt-1 block font-mono text-lg text-white"
                    value={Number(formatUnits(accountData?.totalCollateralUSD ?? 0n, 8))}
                    prefix="$"
                    decimals={2}
                  />
                </div>
                <div>
                  <p className="text-[10px] text-white/35">Debt</p>
                  <AnimatedNumber
                    className="mt-1 block font-mono text-lg text-white"
                    value={Number(formatUnits(accountData?.totalDebtUSD ?? 0n, 8))}
                    prefix="$"
                    decimals={2}
                  />
                </div>
                <div>
                  <p className="text-[10px] text-white/35">Available to borrow</p>
                  <AnimatedNumber
                    className="mt-1 block font-mono text-lg text-white"
                    value={Number(formatUnits(accountData?.availableBorrowsUSD ?? 0n, 8))}
                    prefix="$"
                    decimals={2}
                  />
                </div>
              </div>
            </GlassCard>
          )}
        </>
      ) : (
        /* Manual entry for unconnected users */
        <GlassCard depth="background" className="p-5 sm:p-6">
          <div className="mb-3 flex items-center gap-2">
            <Shield className="h-4 w-4 text-white/45" />
            <p className="text-sm text-white/55">
              Connect your wallet to load real positions, or enter values manually below.
            </p>
          </div>
          <div className="flex justify-center">
            <ConnectWalletButton />
          </div>
          <div className="mt-5 space-y-4 border-t border-white/[0.06] pt-5">
            <div>
              <p className="mb-2 text-xs font-medium text-white/40">Manual collateral (simulated)</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={manualCollateral}
                  onChange={(e) => setManualCollateral(e.target.value)}
                  placeholder="1000"
                  className="flex-1 rounded-lg border border-white/[0.09] bg-black/25 px-4 py-2.5 font-mono text-sm text-white outline-none placeholder:text-white/25 focus:border-white/20"
                />
                <select
                  value={manualCollateralAsset}
                  onChange={(e) => setManualCollateralAsset(e.target.value as Asset)}
                  className="rounded-lg border border-white/[0.09] bg-black/25 px-3 py-2.5 text-sm text-white outline-none"
                >
                  <option value="USDC">USDC</option>
                  <option value="EURC">EURC</option>
                </select>
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-white/40">Manual existing debt (simulated)</p>
              <input
                type="text"
                inputMode="decimal"
                value={manualDebt}
                onChange={(e) => setManualDebt(e.target.value)}
                placeholder="0"
                className="w-full rounded-lg border border-white/[0.09] bg-black/25 px-4 py-2.5 font-mono text-sm text-white outline-none placeholder:text-white/25 focus:border-white/20"
              />
            </div>
          </div>
        </GlassCard>
      )}

      {/* Borrow simulation inputs */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase text-white/35">
          Simulate additional borrow
        </p>
        <div className="flex gap-2 mb-3">
          {(["USDC", "EURC"] as Asset[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setBorrowAsset(a)}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
                borrowAsset === a
                  ? "border-white/40 bg-white/[0.09] text-white"
                  : "border-white/[0.08] bg-transparent text-white/45 hover:border-white/15 hover:text-white/70"
              }`}
            >
              <TokenIcon symbol={a} />
              {a}
            </button>
          ))}
        </div>
        <div className="rounded-lg border border-white/10 bg-black/25 px-4 py-3 transition focus-within:border-emerald-200/40 focus-within:ring-1 focus-within:ring-emerald-200/15">
          <div className="mb-2 text-xs text-white/45">
            Amount to borrow
          </div>
          <input
            aria-label="Borrow amount"
            value={borrowAmount}
            onChange={(e) => setBorrowAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className="w-full bg-transparent font-mono text-xl text-white outline-none placeholder:text-white/25"
          />
        </div>
        {selectedBorrowMarket ? (
          <p className="mt-1.5 text-[10px] text-white/30">
            Asset price: $
            {Number(formatUnits(selectedBorrowMarket.price, selectedBorrowMarket.priceDecimals)).toFixed(2)}
            {" · "}
            Liquidation threshold: {selectedBorrowMarket.liquidationThreshold / 100}%
          </p>
        ) : null}
      </div>

      {/* Side-by-side health factor comparison */}
      {isLoading ? (
        <GlassCard depth="background" className="flex items-center justify-center p-10">
          <Skeleton width={320} height={180} />
        </GlassCard>
      ) : (
        <GlassCard depth="foreground" className="p-5 sm:p-6">
          <div className="grid grid-cols-2 gap-4">
            {/* Current HF */}
            <div className="flex flex-col items-center text-center">
              <p className="text-[10px] font-semibold uppercase text-white/30">Current</p>
              <div className="mt-2 flex items-center justify-center">
                <HealthFactorRing value={currentHealthFactor} size={120} showValue={false} />
              </div>
              <HealthFactorValue
                value={currentHealthFactor}
                className="mt-1 font-mono text-2xl text-white"
              />
              <p className="text-[10px] text-white/30">Health Factor</p>
            </div>

            {/* Projected HF */}
            <div className="flex flex-col items-center text-center">
              <p className="text-[10px] font-semibold uppercase text-white/30">After this borrow</p>
              <div className="mt-2 flex items-center justify-center">
                <HealthFactorRing
                  value={projInfo?.projectedHealthFactor ?? currentHealthFactor}
                  size={120}
                  showValue={false}
                />
              </div>
              <HealthFactorValue
                value={projInfo?.projectedHealthFactor ?? currentHealthFactor}
                className={`mt-1 font-mono text-2xl ${
                  isRisky
                    ? "text-red-300"
                    : projInfo && borrowAmountNum > 0
                      ? "text-white"
                      : "text-white/40"
                }`}
              />
              <p className="text-[10px] text-white/30">Health Factor</p>
            </div>
          </div>

          {/* Warning / Safe messages */}
          {isRisky && borrowAmountNum > 0 ? (
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-red-400/25 bg-red-400/[0.06] px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
              <div>
                <p className="text-sm font-medium text-red-200">
                  This borrow would put your position at risk of liquidation
                </p>
                <p className="mt-1 text-xs text-red-200/60">
                  Health factor would drop below the {MIN_HEALTH_FACTOR} safety threshold.
                  Reduce the amount or add more collateral first.
                </p>
              </div>
            </div>
          ) : projInfo && borrowAmountNum > 0 && !isRisky ? (
            <div className="mt-4 space-y-3">
              <div className="flex items-start gap-3 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.06] px-4 py-3">
                <Shield className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                <div>
                  <p className="text-sm font-medium text-emerald-200">Position remains healthy</p>
                  {isConnected && maxBorrowFormatted ? (
                    <p className="mt-1 text-xs text-emerald-200/60">
                      Max additional borrow at this collateral level: {maxBorrowFormatted} {borrowAsset}
                    </p>
                  ) : null}
                </div>
              </div>
              {borrowDeepLink ? (
                <Link href={borrowDeepLink} prefetch>
                  <GlassButton variant="primary" className="w-full">
                    <CreditCard className="h-4 w-4" />
                    Proceed to Borrow
                    <ArrowRight className="h-4 w-4" />
                  </GlassButton>
                </Link>
              ) : null}
            </div>
          ) : null}
        </GlassCard>
      )}
    </div>
  );
}
