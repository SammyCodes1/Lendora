"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  BarChart2,
  CheckCircle2,
  Clock,
  RefreshCw,
  Shield,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { formatUnits, type Address } from "viem";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { SupplyModal } from "@/components/modals/SupplyModal";
import { BorrowModal } from "@/components/modals/BorrowModal";
import { RepayModal } from "@/components/modals/RepayModal";
import { WithdrawModal } from "@/components/modals/WithdrawModal";
import type { MarketAsset } from "@/components/modals/types";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import { useUserAccountData, useUserBalance } from "@/hooks/useLendingPool";
import { useLiveMarkets } from "@/hooks/useLiveMarkets";
import {
  assetUsdValue,
  dashboardBorrowedMarkets,
  dashboardBorrowPowerUsedPercent,
  dashboardHealthFactor,
  dashboardNetApyPercent,
  dashboardSuppliedMarkets,
  dashboardTotals,
  maxBorrowableAmount,
} from "@/lib/markets";
import { cn } from "@/lib/utils";
import { PageTransition } from "@/components/layout/PageTransition";
import { PageHeader } from "@/components/layout/PageHeader";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { Skeleton } from "@/components/ui/Skeleton";
import { AssetMark } from "@/components/ui/MarketVisuals";
import { useCircleEmailWallet } from "@/components/wallet/CircleEmailWalletProvider";
import {
  clearPendingSupply,
  readPendingSupply,
  writePendingSupply,
} from "@/lib/supplyFlow";

type ActionModal = "supply" | "borrow" | "repay" | "withdraw" | null;
type LendoraDashboardMarket = MarketAsset & { symbol: "USDC" | "EURC" };

type TxEvent = {
  hash: `0x${string}`;
  label: string;
  method: string | null;
  status: string;
  direction: "in" | "out" | "self";
  to: string | null;
  from?: string | null;
  timestamp: string | null;
  blockNumber: number | null;
  amount?: string | null;
  asset?: string | null;
  formattedAmount?: string | null;
  memo?: string | null;
};

type TransactionsResponse = {
  transactions?: TxEventApi[];
  historyComplete?: boolean;
  error?: string;
};

type TxEventApi = Omit<TxEvent, "hash"> & {
  hash: string;
};

const txHashPattern = /^0x[a-fA-F0-9]{64}$/;

function isTxEvent(value: TxEventApi): value is TxEvent {
  return txHashPattern.test(value.hash);
}

function formatTransactionTime(timestamp: string | null) {
  if (!timestamp) return "Recent";

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Recent";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function shortHash(hash: string) {
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

function shortAddress(address: string | null) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Contract";
}

function statusClass(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes("fail")) {
    return "border-red-300/20 bg-red-400/[0.08] text-red-200";
  }
  if (normalized.includes("success") || normalized.includes("confirm")) {
    return "border-white/15 bg-white/[0.06] text-[rgba(212,235,222,0.78)]";
  }
  return "border-white/10 bg-white/[0.06] text-white/55";
}

function DashboardTopStats({
  markets,
  accountData,
  isConnected,
  isAccountPending,
}: {
  markets: LendoraDashboardMarket[];
  accountData?: ReturnType<typeof useUserAccountData>["accountData"];
  isConnected: boolean;
  isAccountPending: boolean;
}) {
  const totals = dashboardTotals(markets);
  const netWorth = Number(formatUnits(totals.netWorthUsd, 8));
  const totalSupplied = Number(formatUnits(totals.suppliedUsd, 8));
  const totalBorrowed = Number(formatUnits(totals.borrowedUsd, 8));
  const netApy = dashboardNetApyPercent(markets);
  const hfValue = dashboardHealthFactor(accountData?.healthFactor);
  const borrowPowerUsed = dashboardBorrowPowerUsedPercent(
    accountData?.totalDebtUSD ?? 0n,
    accountData?.availableBorrowsUSD ?? 0n,
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {/* Net worth */}
      <GlassCard glowOnHover className="p-5">
        <div className="flex items-center justify-between text-xs text-white/45">
          <span>Net worth</span>
          <Wallet className="h-4 w-4 text-white/40" />
        </div>
        <div className="mt-3 font-mono text-2xl font-semibold text-white">
          {!isConnected ? (
            "$0.00"
          ) : isAccountPending ? (
            <Skeleton height={32} className="w-28 rounded-lg" />
          ) : (
            <AnimatedNumber value={netWorth} prefix="$" decimals={2} />
          )}
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-white/40">
          <span>
            Supplied $
            {totalSupplied.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
          <span>
            Borrowed $
            {totalBorrowed.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
      </GlassCard>

      {/* Net APY */}
      <GlassCard glowOnHover className="p-5">
        <div className="flex items-center justify-between text-xs text-white/45">
          <span>Net APY</span>
          <TrendingUp className="h-4 w-4 text-white/40" />
        </div>
        <div className="mt-3 font-mono text-2xl font-semibold text-white">
          {!isConnected || netApy === null ? (
            "—"
          ) : isAccountPending ? (
            <Skeleton height={32} className="w-20 rounded-lg" />
          ) : (
            `${netApy.toFixed(2)}%`
          )}
        </div>
        <div className="mt-2 text-xs text-white/40">
          Compound annual yield on net collateral
        </div>
      </GlassCard>

      {/* Health factor */}
      <GlassCard glowOnHover className="p-5 sm:col-span-2 lg:col-span-1">
        <div className="flex items-center justify-between text-xs text-white/45">
          <span>Health factor</span>
          <Shield className="h-4 w-4 text-white/40" />
        </div>
        <div className="mt-3 font-mono text-2xl font-semibold">
          {!isConnected || hfValue === null ? (
            <span className="text-white/40">—</span>
          ) : isAccountPending ? (
            <Skeleton height={32} className="w-16 rounded-lg" />
          ) : (
            <span
              className={cn(
                hfValue >= 1.5
                  ? "text-emerald-400"
                  : hfValue >= 1.1
                    ? "text-amber-300"
                    : "text-red-400",
              )}
            >
              {hfValue.toFixed(2)}
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-white/40">
          <span>
            {isConnected && hfValue !== null
              ? `Borrow power used ${borrowPowerUsed.toFixed(1)}%`
              : "No active borrows"}
          </span>
          {isConnected && hfValue !== null ? (
            <span className="font-mono text-[10px] text-white/30">
              Liquidation &lt; 1.00
            </span>
          ) : null}
        </div>
      </GlassCard>
    </div>
  );
}

function YourSuppliesSection({
  markets,
  isConnected,
  onOpen,
}: {
  markets: LendoraDashboardMarket[];
  isConnected: boolean;
  onOpen: (modal: ActionModal, market: MarketAsset) => void;
}) {
  const supplied = useMemo(
    () => (isConnected ? dashboardSuppliedMarkets(markets) : []),
    [isConnected, markets],
  );

  return (
    <GlassCard depth="foreground" className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <ArrowUpCircle className="h-5 w-5 text-emerald-400" />
          <h2 className="text-lg font-semibold text-white">Your supplies</h2>
        </div>
      </div>

      {supplied.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm font-medium text-white/70">Nothing supplied yet</p>
          <p className="mt-1 text-xs text-white/40">
            Supply USDC or EURC to start earning interest and use as collateral.
          </p>
        </div>
      ) : (
        <>
          {/* Mobile list */}
          <div className="divide-y divide-white/[0.06] md:hidden">
            {supplied.map((market) => {
              const amount = Number(formatUnits(market.userSupply, 6));
              const usdVal = Number(
                formatUnits(assetUsdValue(market.userSupply, market.price), 8),
              );
              return (
                <div key={market.symbol} className="space-y-3 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <AssetMark symbol={market.symbol} size="sm" />
                      <div>
                        <p className="font-medium text-white">{market.symbol}</p>
                        <p className="text-xs text-white/40">{market.name}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm text-white">
                        {amount.toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })}
                      </p>
                      <p className="font-mono text-xs text-white/40">
                        $
                        {usdVal.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs text-white/45">
                    <div>
                      <span>Supply APY: </span>
                      <span className="font-mono text-white">
                        {market.supplyApy}
                      </span>
                    </div>
                    <div className="text-right">
                      <span>Can be collateral: </span>
                      <span className="font-medium text-emerald-400">Yes</span>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <GlassButton
                      variant="primary"
                      className="flex-1 py-1.5 text-xs"
                      onClick={() => onOpen("supply", market)}
                    >
                      Supply
                    </GlassButton>
                    <GlassButton
                      variant="ghost"
                      className="flex-1 py-1.5 text-xs"
                      onClick={() => onOpen("withdraw", market)}
                    >
                      Withdraw
                    </GlassButton>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/[0.08] text-xs text-white/45">
                <tr>
                  <th className="px-5 py-3 font-medium">Asset</th>
                  <th className="px-5 py-3 font-medium">Balance</th>
                  <th className="px-5 py-3 font-medium">APY</th>
                  <th className="px-5 py-3 text-center font-medium">
                    Can be collateral
                  </th>
                  <th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {supplied.map((market) => {
                  const amount = Number(formatUnits(market.userSupply, 6));
                  const usdVal = Number(
                    formatUnits(
                      assetUsdValue(market.userSupply, market.price),
                      8,
                    ),
                  );
                  return (
                    <tr
                      key={market.symbol}
                      className="transition hover:bg-white/[0.02]"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <AssetMark symbol={market.symbol} size="sm" />
                          <div>
                            <p className="font-medium text-white">
                              {market.symbol}
                            </p>
                            <p className="text-xs text-white/40">
                              {market.name}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <p className="font-mono text-white">
                          {amount.toLocaleString(undefined, {
                            maximumFractionDigits: 6,
                          })}
                        </p>
                        <p className="font-mono text-xs text-white/40">
                          $
                          {usdVal.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </p>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-emerald-400">
                        {market.supplyApy}
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-xs text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" /> Yes
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex justify-end gap-2">
                          <GlassButton
                            variant="primary"
                            className="px-3 py-1.5 text-xs"
                            onClick={() => onOpen("supply", market)}
                          >
                            Supply
                          </GlassButton>
                          <GlassButton
                            variant="ghost"
                            className="px-3 py-1.5 text-xs"
                            onClick={() => onOpen("withdraw", market)}
                          >
                            Withdraw
                          </GlassButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </GlassCard>
  );
}

function AssetToSupplyMobileRow({
  market,
  isConnected,
  onOpen,
}: {
  market: LendoraDashboardMarket;
  isConnected: boolean;
  onOpen: (modal: ActionModal, market: MarketAsset) => void;
}) {
  const balance = useUserBalance(market.address, isConnected);
  const amount = balance.data ? Number(formatUnits(balance.data.value, 6)) : 0;
  const usdVal = amount * Number(formatUnits(market.price, 8));

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <AssetMark symbol={market.symbol} size="sm" />
          <div>
            <p className="font-medium text-white">{market.symbol}</p>
            <p className="text-xs text-white/40">{market.name}</p>
          </div>
        </div>
        <div className="text-right">
          <span className="text-[10px] text-white/40">Wallet balance</span>
          <p className="font-mono text-sm text-white">
            {isConnected ? balance.formatted : "—"}
          </p>
          {isConnected ? (
            <p className="font-mono text-xs text-white/40">
              $
              {usdVal.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-white/45">
        <div>
          <span>APY, variable: </span>
          <span className="font-mono text-white">{market.supplyApy}</span>
        </div>
        <div className="text-right">
          <span>Can be collateral: </span>
          <span className="font-medium text-emerald-400">Yes</span>
        </div>
      </div>

      <GlassButton
        variant="primary"
        className="w-full py-1.5 text-xs"
        onClick={() => onOpen("supply", market)}
      >
        Supply
      </GlassButton>
    </div>
  );
}

function AssetToSupplyDesktopRow({
  market,
  isConnected,
  onOpen,
}: {
  market: LendoraDashboardMarket;
  isConnected: boolean;
  onOpen: (modal: ActionModal, market: MarketAsset) => void;
}) {
  const balance = useUserBalance(market.address, isConnected);
  const amount = balance.data ? Number(formatUnits(balance.data.value, 6)) : 0;
  const usdVal = amount * Number(formatUnits(market.price, 8));

  return (
    <tr className="transition hover:bg-white/[0.02]">
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <AssetMark symbol={market.symbol} size="sm" />
          <div>
            <p className="font-medium text-white">{market.symbol}</p>
            <p className="text-xs text-white/40">{market.name}</p>
          </div>
        </div>
      </td>
      <td className="px-5 py-3.5">
        <p className="font-mono text-white">
          {isConnected ? balance.formatted : "—"}
        </p>
        {isConnected ? (
          <p className="font-mono text-xs text-white/40">
            $
            {usdVal.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </p>
        ) : null}
      </td>
      <td className="px-5 py-3.5 font-mono text-emerald-400">
        {market.supplyApy}
      </td>
      <td className="px-5 py-3.5 text-center">
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-xs text-emerald-300">
          <CheckCircle2 className="h-3 w-3" /> Yes
        </span>
      </td>
      <td className="px-5 py-3.5 text-right">
        <GlassButton
          variant="primary"
          className="px-4 py-1.5 text-xs"
          onClick={() => onOpen("supply", market)}
        >
          Supply
        </GlassButton>
      </td>
    </tr>
  );
}

function AssetsToSupplySection({
  markets,
  isConnected,
  onOpen,
}: {
  markets: LendoraDashboardMarket[];
  isConnected: boolean;
  onOpen: (modal: ActionModal, market: MarketAsset) => void;
}) {
  return (
    <GlassCard depth="foreground" className="overflow-hidden p-0">
      <div className="border-b border-white/[0.08] px-5 py-4">
        <h2 className="text-lg font-semibold text-white">Assets to supply</h2>
      </div>

      {/* Mobile list */}
      <div className="divide-y divide-white/[0.06] md:hidden">
        {markets.map((market) => (
          <AssetToSupplyMobileRow
            key={market.symbol}
            market={market}
            isConnected={isConnected}
            onOpen={onOpen}
          />
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-white/[0.08] text-xs text-white/45">
            <tr>
              <th className="px-5 py-3 font-medium">Asset</th>
              <th className="px-5 py-3 font-medium">Wallet balance</th>
              <th className="px-5 py-3 font-medium">APY, variable</th>
              <th className="px-5 py-3 text-center font-medium">
                Can be collateral
              </th>
              <th className="px-5 py-3 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {markets.map((market) => (
              <AssetToSupplyDesktopRow
                key={market.symbol}
                market={market}
                isConnected={isConnected}
                onOpen={onOpen}
              />
            ))}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}

function YourBorrowsSection({
  markets,
  isConnected,
  onOpen,
}: {
  markets: LendoraDashboardMarket[];
  isConnected: boolean;
  onOpen: (modal: ActionModal, market: MarketAsset) => void;
}) {
  const borrowed = useMemo(
    () => (isConnected ? dashboardBorrowedMarkets(markets) : []),
    [isConnected, markets],
  );

  return (
    <GlassCard depth="foreground" className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <ArrowDownCircle className="h-5 w-5 text-sky-400" />
          <h2 className="text-lg font-semibold text-white">Your borrows</h2>
        </div>
      </div>

      {borrowed.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm font-medium text-white/70">Nothing borrowed yet</p>
          <p className="mt-1 text-xs text-white/40">
            Borrow USDC or EURC against your deposited collateral assets.
          </p>
        </div>
      ) : (
        <>
          {/* Mobile list */}
          <div className="divide-y divide-white/[0.06] md:hidden">
            {borrowed.map((market) => {
              const debtAmount = Number(formatUnits(market.userDebt, 6));
              const usdVal = Number(
                formatUnits(assetUsdValue(market.userDebt, market.price), 8),
              );
              return (
                <div key={market.symbol} className="space-y-3 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <AssetMark symbol={market.symbol} size="sm" />
                      <div>
                        <p className="font-medium text-white">{market.symbol}</p>
                        <p className="text-xs text-white/40">{market.name}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm text-white">
                        {debtAmount.toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })}
                      </p>
                      <p className="font-mono text-xs text-white/40">
                        $
                        {usdVal.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-white/45">
                    <span>APY, variable</span>
                    <span className="font-mono text-white">
                      {market.borrowApr}
                    </span>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <GlassButton
                      variant="primary"
                      className="flex-1 py-1.5 text-xs"
                      onClick={() => onOpen("borrow", market)}
                    >
                      Borrow
                    </GlassButton>
                    <GlassButton
                      variant="ghost"
                      className="flex-1 py-1.5 text-xs"
                      onClick={() => onOpen("repay", market)}
                    >
                      Repay
                    </GlassButton>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/[0.08] text-xs text-white/45">
                <tr>
                  <th className="px-5 py-3 font-medium">Asset</th>
                  <th className="px-5 py-3 font-medium">Debt</th>
                  <th className="px-5 py-3 font-medium">APY, variable</th>
                  <th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {borrowed.map((market) => {
                  const debtAmount = Number(formatUnits(market.userDebt, 6));
                  const usdVal = Number(
                    formatUnits(
                      assetUsdValue(market.userDebt, market.price),
                      8,
                    ),
                  );
                  return (
                    <tr
                      key={market.symbol}
                      className="transition hover:bg-white/[0.02]"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <AssetMark symbol={market.symbol} size="sm" />
                          <div>
                            <p className="font-medium text-white">
                              {market.symbol}
                            </p>
                            <p className="text-xs text-white/40">
                              {market.name}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <p className="font-mono text-white">
                          {debtAmount.toLocaleString(undefined, {
                            maximumFractionDigits: 6,
                          })}
                        </p>
                        <p className="font-mono text-xs text-white/40">
                          $
                          {usdVal.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </p>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-sky-400">
                        {market.borrowApr}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex justify-end gap-2">
                          <GlassButton
                            variant="primary"
                            className="px-3 py-1.5 text-xs"
                            onClick={() => onOpen("borrow", market)}
                          >
                            Borrow
                          </GlassButton>
                          <GlassButton
                            variant="ghost"
                            className="px-3 py-1.5 text-xs"
                            onClick={() => onOpen("repay", market)}
                          >
                            Repay
                          </GlassButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </GlassCard>
  );
}

function AssetsToBorrowSection({
  markets,
  isConnected,
  availableBorrowsUsd,
  onOpen,
}: {
  markets: LendoraDashboardMarket[];
  isConnected: boolean;
  availableBorrowsUsd: bigint;
  onOpen: (modal: ActionModal, market: MarketAsset) => void;
}) {
  return (
    <GlassCard depth="foreground" className="overflow-hidden p-0">
      <div className="border-b border-white/[0.08] px-5 py-4">
        <h2 className="text-lg font-semibold text-white">Assets to borrow</h2>
      </div>

      {/* Mobile list */}
      <div className="divide-y divide-white/[0.06] md:hidden">
        {markets.map((market) => {
          const maxBorrow = isConnected
            ? maxBorrowableAmount(market, availableBorrowsUsd)
            : 0n;
          const maxBorrowAmount = Number(formatUnits(maxBorrow, 6));
          const maxBorrowUsd = Number(
            formatUnits(assetUsdValue(maxBorrow, market.price), 8),
          );

          return (
            <div key={market.symbol} className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <AssetMark symbol={market.symbol} size="sm" />
                  <div>
                    <p className="font-medium text-white">{market.symbol}</p>
                    <p className="text-xs text-white/40">{market.name}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-white/40">Available</span>
                  <p className="font-mono text-sm text-white">
                    {isConnected
                      ? maxBorrowAmount.toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })
                      : "—"}
                  </p>
                  {isConnected ? (
                    <p className="font-mono text-xs text-white/40">
                      $
                      {maxBorrowUsd.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-white/45">
                <span>APY, variable</span>
                <span className="font-mono text-white">
                  {market.borrowApr}
                </span>
              </div>

              <GlassButton
                variant="primary"
                className="w-full py-1.5 text-xs"
                onClick={() => onOpen("borrow", market)}
              >
                Borrow
              </GlassButton>
            </div>
          );
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-white/[0.08] text-xs text-white/45">
            <tr>
              <th className="px-5 py-3 font-medium">Asset</th>
              <th className="px-5 py-3 font-medium">Available</th>
              <th className="px-5 py-3 font-medium">APY, variable</th>
              <th className="px-5 py-3 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {markets.map((market) => {
              const maxBorrow = isConnected
                ? maxBorrowableAmount(market, availableBorrowsUsd)
                : 0n;
              const maxBorrowAmount = Number(formatUnits(maxBorrow, 6));
              const maxBorrowUsd = Number(
                formatUnits(assetUsdValue(maxBorrow, market.price), 8),
              );

              return (
                <tr
                  key={market.symbol}
                  className="transition hover:bg-white/[0.02]"
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <AssetMark symbol={market.symbol} size="sm" />
                      <div>
                        <p className="font-medium text-white">
                          {market.symbol}
                        </p>
                        <p className="text-xs text-white/40">
                          {market.name}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="font-mono text-white">
                      {isConnected
                        ? maxBorrowAmount.toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })
                        : "—"}
                    </p>
                    {isConnected ? (
                      <p className="font-mono text-xs text-white/40">
                        $
                        {maxBorrowUsd.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-5 py-3.5 font-mono text-sky-400">
                    {market.borrowApr}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <GlassButton
                      variant="primary"
                      className="px-4 py-1.5 text-xs"
                      onClick={() => onOpen("borrow", market)}
                    >
                      Borrow
                    </GlassButton>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}

function useRecentTransactions(user?: Address) {
  const [events, setEvents] = useState<TxEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyComplete, setHistoryComplete] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!user) {
      setEvents([]);
      setIsLoading(false);
      setError(null);
      setHistoryComplete(true);
      return;
    }

    const controller = new AbortController();

    async function loadTransactions() {
      setIsLoading(true);
      setError(null);
      const response = await fetch(`/api/transactions/${user}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const data = (await response.json()) as TransactionsResponse;
      if (!response.ok) {
        throw new Error(data.error ?? "Could not load transaction history");
      }

      const mapped = (data.transactions ?? []).filter(isTxEvent);
      setEvents(mapped);
      setHistoryComplete(data.historyComplete ?? true);
      setIsLoading(false);
    }

    loadTransactions().catch((caught) => {
      if (controller.signal.aborted) {
        return;
      }
      setEvents([]);
      setIsLoading(false);
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load transaction history",
      );
    });

    return () => {
      controller.abort();
    };
  }, [reloadKey, user]);

  return {
    events,
    isLoading,
    error,
    historyComplete,
    refresh: () => setReloadKey((current) => current + 1),
  };
}

function MyTransactions() {
  const { address, isConnected } = useArcLendAccount();
  const emailWallet = useCircleEmailWallet();
  const activeAddress =
    address ?? (emailWallet.wallet?.address as Address | undefined);
  const { events, isLoading, error, historyComplete, refresh } =
    useRecentTransactions(activeAddress);

  if (!isConnected && !emailWallet.isConnected) {
    return null;
  }

  return (
    <GlassCard className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Clock className="h-5 w-5" />
          <h2 className="text-xl font-semibold">My Transactions</h2>
        </div>
        <button
          type="button"
          aria-label="Refresh transactions"
          disabled={isLoading}
          onClick={refresh}
          className="rounded-lg border border-white/10 bg-white/[0.04] p-2 text-white/45 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
        >
          <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
        </button>
      </div>
      <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
        {isLoading ? (
          <>
            <Skeleton height={58} className="rounded-lg" />
            <Skeleton height={58} className="rounded-lg" />
          </>
        ) : error ? (
          <div
            role="alert"
            className="rounded-lg border border-red-400/20 bg-red-400/[0.07] p-4 text-sm text-red-200"
          >
            Transaction history could not be loaded. Use refresh to retry.
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 text-sm text-white/45">
            No Lendora app transactions found for this wallet.
          </div>
        ) : (
          events.map((event) => (
            <div
              key={event.hash}
              className="flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-3">
                <a
                  href={`https://testnet.arcscan.app/tx/${event.hash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-md border border-white/10 bg-black/20 px-2 py-1 font-mono text-[11px] text-white/60 transition hover:border-white/20 hover:text-white"
                >
                  {shortHash(event.hash)}
                </a>
                {event.direction === "in" ? (
                  <ArrowDownCircle className="h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <ArrowUpCircle className="h-4 w-4 shrink-0 text-white/50" />
                )}
                <div className="min-w-0">
                  <span className="block truncate font-medium text-white">
                    {event.label}
                  </span>
                  <span className="block truncate text-xs text-white/40">
                    {event.memo ? (
                      <span className="mr-1.5 italic text-white/60">
                        &quot;{event.memo}&quot; ·{" "}
                      </span>
                    ) : null}
                    {event.direction === "in" && event.from
                      ? `from ${shortAddress(event.from)}`
                      : `${event.method ?? "contract call"} to ${shortAddress(event.to)}`}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center justify-between gap-3 text-xs sm:justify-end">
                {event.formattedAmount ? (
                  <span
                    className={cn(
                      "font-mono text-sm font-semibold tracking-tight",
                      event.direction === "in"
                        ? "text-emerald-400"
                        : "text-white/90",
                    )}
                  >
                    {event.direction === "in"
                      ? "+"
                      : event.direction === "out"
                        ? "-"
                        : ""}
                    {event.formattedAmount}
                  </span>
                ) : null}
                <div className="flex items-center gap-2">
                  <span className="font-mono text-white/50">
                    {formatTransactionTime(event.timestamp)}
                  </span>
                  <span
                    className={cn(
                      "rounded-md border px-2 py-1 font-medium",
                      statusClass(event.status),
                    )}
                  >
                    {event.status}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      {!isLoading && !error && events.length > 0 && !historyComplete ? (
        <p className="mt-3 text-xs text-white/35">
          Showing the latest {events.length} Lendora app transactions. Older
          explorer pages were not loaded.
        </p>
      ) : null}
    </GlassCard>
  );
}

export default function DashboardPage() {
  const [activeModal, setActiveModal] = useState<ActionModal>(null);
  const [selectedMarket, setSelectedMarket] = useState<MarketAsset | null>(
    null,
  );
  const { markets, isPaused, isError } = useLiveMarkets();
  const { address, isConnected } = useArcLendAccount();
  const { accountData, isPending: isAccountPending } =
    useUserAccountData(address);

  const dashboardMarkets = useMemo(() => {
    return markets.filter(
      (market): market is LendoraDashboardMarket =>
        market.symbol === "USDC" || market.symbol === "EURC",
    );
  }, [markets]);

  useEffect(() => {
    const pending = readPendingSupply();
    if (!pending || activeModal) return;

    const market = dashboardMarkets.find(
      (candidate) =>
        candidate.address.toLowerCase() === pending.marketAddress.toLowerCase(),
    );
    if (!market) return;

    setSelectedMarket(market);
    setActiveModal("supply");
  }, [activeModal, dashboardMarkets]);

  const closeModal = useCallback(() => {
    setActiveModal(null);
    clearPendingSupply();
  }, []);

  const openModal = useCallback(
    (modal: ActionModal, market: MarketAsset) => {
      if (isPaused && (modal === "supply" || modal === "borrow")) {
        return;
      }
      if (modal === "supply") {
        writePendingSupply(market.address, "");
      } else {
        clearPendingSupply();
      }
      setSelectedMarket(market);
      setActiveModal(modal);
    },
    [isPaused],
  );

  const activeMarket = useMemo(() => selectedMarket, [selectedMarket]);

  return (
    <PageTransition>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={<BarChart2 />}
          title="Dashboard"
          description="A single view of your collateral, borrows, and live USDC and EURC markets on Arc."
        />

        {isError ? (
          <div
            role="alert"
            className="rounded-2xl border border-red-400/20 bg-red-400/[0.07] px-4 py-3 text-sm text-red-200"
          >
            Market data failed to load (RPC or oracle). Displayed figures may be
            incomplete.
          </div>
        ) : null}

        {isPaused ? (
          <div
            role="status"
            className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 text-sm text-amber-100"
          >
            Protocol is paused. Supply and borrow are disabled until the pool is
            unpaused.
          </div>
        ) : null}

        <DashboardTopStats
          markets={dashboardMarkets}
          accountData={accountData}
          isConnected={isConnected}
          isAccountPending={isAccountPending}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Supplies Column */}
          <div className="flex flex-col gap-6">
            <YourSuppliesSection
              markets={dashboardMarkets}
              isConnected={isConnected}
              onOpen={openModal}
            />
            <AssetsToSupplySection
              markets={dashboardMarkets}
              isConnected={isConnected}
              onOpen={openModal}
            />
          </div>

          {/* Borrows Column */}
          <div className="flex flex-col gap-6">
            <YourBorrowsSection
              markets={dashboardMarkets}
              isConnected={isConnected}
              onOpen={openModal}
            />
            <AssetsToBorrowSection
              markets={dashboardMarkets}
              isConnected={isConnected}
              availableBorrowsUsd={accountData?.availableBorrowsUSD ?? 0n}
              onOpen={openModal}
            />
          </div>
        </div>

        <MyTransactions />

        <SupplyModal
          open={activeModal === "supply"}
          market={activeMarket}
          onClose={closeModal}
        />
        <BorrowModal
          open={activeModal === "borrow"}
          market={activeMarket}
          onClose={closeModal}
        />
        <RepayModal
          open={activeModal === "repay"}
          market={activeMarket}
          onClose={closeModal}
        />
        <WithdrawModal
          open={activeModal === "withdraw"}
          market={activeMarket}
          onClose={closeModal}
        />
      </div>
    </PageTransition>
  );
}
