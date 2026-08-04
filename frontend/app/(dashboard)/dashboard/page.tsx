"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowDownCircle,
  ArrowUpCircle,
  BarChart2,
  Clock,
  Percent,
  RefreshCw,
  Shield,
  TrendingUp,
} from "lucide-react";
import {
  formatUnits,
  type Address,
} from "viem";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { StatBadge } from "@/components/ui/StatBadge";
import { SupplyModal } from "@/components/modals/SupplyModal";
import { BorrowModal } from "@/components/modals/BorrowModal";
import { RepayModal } from "@/components/modals/RepayModal";
import { WithdrawModal } from "@/components/modals/WithdrawModal";
import type { MarketAsset } from "@/components/modals/types";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import { useUserAccountData } from "@/hooks/useLendingPool";
import { useLiveMarkets } from "@/hooks/useLiveMarkets";
import { formatRemainingCap, formatReserveCap } from "@/lib/markets";
import { cn } from "@/lib/utils";
import { PageTransition } from "@/components/layout/PageTransition";
import { PageHeader } from "@/components/layout/PageHeader";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { HealthFactorValue } from "@/components/ui/HealthFactorValue";
import { Skeleton } from "@/components/ui/Skeleton";
import { AssetMark, SectionLabel, UtilizationBar } from "@/components/ui/MarketVisuals";
import { useCircleEmailWallet } from "@/components/wallet/CircleEmailWalletProvider";

type ActionModal = "supply" | "borrow" | "repay" | "withdraw" | null;
type TxEvent = {
  hash: `0x${string}`;
  label: string;
  method: string | null;
  status: string;
  direction: "in" | "out" | "self";
  to: string | null;
  timestamp: string | null;
  blockNumber: number | null;
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

const rowVariants = {
  hidden: { opacity: 0, y: 14 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: index * 0.1, duration: 0.32 },
  }),
};

function ProtocolStatsBar({
  markets,
  isPaused,
}: {
  markets: MarketAsset[];
  isPaused: boolean;
}) {
  const totalSupply = markets.reduce((sum, market) => sum + market.totalSupplyUsd, 0n);
  const totalBorrow = markets.reduce((sum, market) => sum + market.totalBorrowUsd, 0n);
  const available = markets.reduce((sum, market) => sum + market.availableLiquidityUsd, 0n);

  const stats = [
    { icon: TrendingUp, label: "Total Value Locked", value: Number(formatUnits(totalSupply, 8)), prefix: "$" },
    { icon: Percent, label: "Total Borrowing", value: Number(formatUnits(totalBorrow, 8)), prefix: "$" },
    { icon: Activity, label: "Available Liquidity", value: Number(formatUnits(available, 8)), prefix: "$" },
    { icon: Shield, label: "Protocol Status", text: isPaused ? "Paused" : "Active" },
  ];

  return (
    <GlassCard depth="foreground" className="p-5 sm:p-6">
      <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <SectionLabel>Protocol overview</SectionLabel>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;

          return (
            <motion.div key={stat.label} variants={rowVariants} custom={stats.indexOf(stat)} initial="hidden" animate="visible" className="rounded-2xl border border-white/[0.08] bg-black/20 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="flex items-center gap-2 text-xs text-white/42">
                <Icon className="h-4 w-4 text-white/65" strokeWidth={1.5} />
                {stat.label}
              </div>
              <div className="mt-4 font-mono text-2xl text-white">
                {"text" in stat ? (
                  stat.text
                ) : (
                  <AnimatedNumber
                    value={stat.value}
                    prefix={stat.prefix}
                    decimals={2}
                  />
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </GlassCard>
  );
}

function HealthFactor({ value }: { value?: bigint }) {
  const numeric = value && value !== BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff") ? Number(formatUnits(value, 18)) : 9.99;
  const className = numeric > 1.5 ? "text-white" : numeric >= 1.1 ? "text-white/70" : "text-white/45";

  return <HealthFactorValue value={numeric} className={cn("font-mono", className)} />;
}

function weightedRate(markets: MarketAsset[], field: "userSupply" | "userDebt", rate: "supplyApyValue" | "borrowAprValue") {
  const total = markets.reduce((sum, market) => sum + Number(market[field]), 0);
  if (total === 0) {
    return 0;
  }

  return markets.reduce((sum, market) => sum + Number(market[field]) * market[rate], 0) / total;
}

function UserSummary({ markets }: { markets: MarketAsset[] }) {
  const { address, isConnected } = useArcLendAccount();
  const { accountData, isPending: isAccountPending } = useUserAccountData(address);
  const supplyRate = weightedRate(markets, "userSupply", "supplyApyValue");
  const borrowRate = weightedRate(markets, "userDebt", "borrowAprValue");
  const projectedSupplyUsd = markets.reduce(
    (sum, market) =>
      sum + (market.userSupply * market.price) / 1_000_000n,
    0n,
  );
  const projectedDebtUsd = markets.reduce(
    (sum, market) =>
      sum + (market.userDebt * market.price) / 1_000_000n,
    0n,
  );

  if (!isConnected) {
    return null;
  }

  if (isAccountPending) {
    return (
      <section className="grid gap-5 lg:grid-cols-2">
        <Skeleton height={190} className="rounded-2xl" />
        <Skeleton height={190} className="rounded-2xl" />
      </section>
    );
  }

  return (
    <section className="grid gap-5 lg:grid-cols-2">
      <GlassCard glowOnHover className="p-5">
        <div className="flex items-center gap-3">
          <ArrowUpCircle className="h-5 w-5" />
          <h2 className="text-xl font-semibold">My Supplied</h2>
        </div>
        <div className="mt-5 space-y-3 text-sm text-white/60">
          {markets.map((market) => (
            <div key={market.symbol} className="flex items-start justify-between gap-3">
              <span>a{market.symbol} balance</span>
              <span className="text-right">
                <span className="block font-mono text-white">
                  {Number(formatUnits(market.settledUserSupply, 6)).toLocaleString(undefined, { maximumFractionDigits: 6 })} a{market.symbol}
                </span>
                {market.accruedSupply > 0n ? (
                  <>
                    <span className="block font-mono text-[10px] text-[#86efac]">
                      +{formatUnits(market.accruedSupply, 6)} pending interest
                    </span>
                    <span className="block font-mono text-[10px] text-white/40">
                      total {Number(formatUnits(market.userSupply, 6)).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                    </span>
                  </>
                ) : null}
              </span>
            </div>
          ))}
          <div className="flex justify-between"><span>Total supplied</span><AnimatedNumber className="font-mono text-white" value={Number(formatUnits(projectedSupplyUsd, 8))} prefix="$" decimals={2} /></div>
          <p className="text-[10px] leading-4 text-white/30">
            aToken is settled balance; pending is the live estimate on top. Settled + pending = total position.
          </p>
          <StatBadge label="Weighted Supply APY" value={`${supplyRate.toFixed(2)}%`} tone="positive" />
        </div>
      </GlassCard>

      <GlassCard glowOnHover className="p-5">
        <div className="flex items-center gap-3">
          <ArrowDownCircle className="h-5 w-5" />
          <h2 className="text-xl font-semibold">My Borrowed</h2>
        </div>
        <div className="mt-5 space-y-3 text-sm text-white/60">
          {markets.map((market) => (
            <div key={market.symbol} className="flex items-start justify-between gap-3">
              <span>d{market.symbol} balance</span>
              <span className="text-right">
                <span className="block font-mono text-white">{Number(formatUnits(market.userDebt, 6)).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                <span className="block font-mono text-[10px] text-white/42">+{formatUnits(market.accruedBorrowInterest, 6)} interest</span>
              </span>
            </div>
          ))}
          <div className="flex justify-between"><span>Total borrowed</span><AnimatedNumber className="font-mono text-white" value={Number(formatUnits(projectedDebtUsd, 8))} prefix="$" decimals={2} /></div>
          <div className="flex items-center justify-between"><StatBadge label="Weighted Borrow APR" value={`${borrowRate.toFixed(2)}%`} /><span>Health Factor <HealthFactor value={accountData?.healthFactor} /></span></div>
        </div>
      </GlassCard>
    </section>
  );
}

function MarketsTable({ markets, onOpen }: { markets: MarketAsset[]; onOpen: (modal: ActionModal, market: MarketAsset) => void }) {
  return (
    <GlassCard depth="foreground" className="overflow-hidden p-0">
      <div className="flex items-center gap-3 border-b border-white/[0.08] p-5">
        <BarChart2 className="h-5 w-5" />
        <div>
          <h2 className="text-xl font-semibold">Markets</h2>
          <p className="mt-1 text-xs text-white/36">
            Supply, borrow, and utilization across ArcLend reserves.
          </p>
        </div>
      </div>

      <div className="grid gap-3 p-4 md:hidden">
        {markets.map((market) => {
          return (
            <motion.div key={market.symbol} variants={rowVariants} custom={markets.indexOf(market)} initial="hidden" animate="visible" className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.035] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.32)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <AssetMark symbol={market.symbol} />
                  <div>
                    <p className="font-medium text-white">{market.name}</p>
                    <p className="text-xs text-white/45">{market.symbol}</p>
                  </div>
                </div>
                <span className="font-mono text-xs text-white/40">Arc reserve</span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-4 text-sm text-white/45">
                <div><p>Supply APY</p><p className="mt-1 font-mono text-lg text-white">{market.supplyApy}</p></div>
                <div className="text-right"><p>Total supplied</p><p className="mt-1 font-mono text-white"><AnimatedNumber value={Number(formatUnits(market.totalSupplyUsd, 8))} prefix="$" decimals={2} /></p></div>
                <div><p>Borrow APR</p><p className="mt-1 font-mono text-lg text-white">{market.borrowApr}</p></div>
                <div className="text-right"><p>Utilization</p><div className="mt-2"><UtilizationBar value={market.utilization} delay={0.2} /></div></div>
                <div>
                  <p>Supply cap</p>
                  <p className="mt-1 font-mono text-white">
                    {formatReserveCap(market.supplyCap, market.isSupplyCapped, { compact: true })}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-white/35">
                    {formatRemainingCap(market.remainingSupplyCap, market.isSupplyCapped)} left
                  </p>
                </div>
                <div className="text-right">
                  <p>Borrow cap</p>
                  <p className="mt-1 font-mono text-white">
                    {formatReserveCap(market.borrowCap, market.isBorrowCapped, { compact: true })}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-white/35">
                    {formatRemainingCap(market.remainingBorrowCap, market.isBorrowCapped)} left
                  </p>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <GlassButton variant="primary" className="flex-1 px-3 py-2" onClick={() => onOpen("supply", market)}>Supply</GlassButton>
                <GlassButton variant="ghost" className="flex-1 px-3 py-2" onClick={() => onOpen("borrow", market)}>Borrow</GlassButton>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="text-white/45">
            <tr className="border-b border-white/[0.08]">
              <th className="px-5 py-4 font-medium">Asset</th>
              <th className="px-5 py-4 font-medium">Supply APY</th>
              <th className="px-5 py-4 text-right font-medium">Total supplied</th>
              <th className="px-5 py-4 text-right font-medium">Supply cap</th>
              <th className="px-5 py-4 text-right font-medium">Borrow APR</th>
              <th className="px-5 py-4 text-right font-medium">Borrow cap</th>
              <th className="px-5 py-4 text-right font-medium">Utilization</th>
              <th className="px-5 py-4 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {markets.map((market, index) => {
              return (
                <motion.tr
                  key={market.symbol}
                  custom={index}
                  initial="hidden"
                  animate="visible"
                  whileHover={{ y: -3, boxShadow: "0 18px 50px rgba(0,0,0,0.4)" }}
                  variants={rowVariants}
                  className="border-b border-white/[0.05] transition hover:bg-white/[0.05]"
                >
                  <td className="px-5 py-5">
                    <div className="flex items-center gap-3">
                      <AssetMark symbol={market.symbol} size="sm" />
                      <div>
                        <p className="font-medium text-white">{market.name}</p>
                        <p className="text-xs text-white/45">{market.symbol}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-5 font-mono text-white">{market.supplyApy}</td>
                  <td className="px-5 py-5 text-right font-mono text-white"><AnimatedNumber value={Number(formatUnits(market.totalSupplyUsd, 8))} prefix="$" decimals={2} /></td>
                  <td className="px-5 py-5 text-right">
                    <p className="font-mono text-white">
                      {formatReserveCap(market.supplyCap, market.isSupplyCapped, { compact: true })}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-white/35">
                      {formatRemainingCap(market.remainingSupplyCap, market.isSupplyCapped)} left
                    </p>
                  </td>
                  <td className="px-5 py-5 text-right font-mono text-white">{market.borrowApr}</td>
                  <td className="px-5 py-5 text-right">
                    <p className="font-mono text-white">
                      {formatReserveCap(market.borrowCap, market.isBorrowCapped, { compact: true })}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-white/35">
                      {formatRemainingCap(market.remainingBorrowCap, market.isBorrowCapped)} left
                    </p>
                  </td>
                  <td className="px-5 py-5">
                    <UtilizationBar value={market.utilization} delay={0.25 + index * 0.08} className="ml-auto max-w-44" />
                  </td>
                  <td className="px-5 py-5 text-right">
                    <div className="flex justify-end gap-2">
                      <GlassButton variant="primary" className="px-4 py-2" onClick={() => onOpen("supply", market)}>Supply</GlassButton>
                      <GlassButton variant="ghost" className="px-4 py-2" onClick={() => onOpen("borrow", market)}>Borrow</GlassButton>
                    </div>
                  </td>
                </motion.tr>
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
  const activeAddress = address ?? (emailWallet.wallet?.address as Address | undefined);
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
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 text-sm text-white/45">No ArcLend app transactions found for this wallet.</div>
        ) : (
          events.map((event) => (
            <div key={event.hash} className="flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <a
                  href={`https://testnet.arcscan.app/tx/${event.hash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-md border border-white/10 bg-black/20 px-2 py-1 font-mono text-[11px] text-white/60 transition hover:border-white/20 hover:text-white"
                >
                  {shortHash(event.hash)}
                </a>
                {event.direction === "in" ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowUpCircle className="h-4 w-4" />}
                <div className="min-w-0">
                  <span className="block truncate text-white">{event.label}</span>
                  <span className="block truncate text-xs text-white/40">
                    {event.method ?? "contract call"} to {shortAddress(event.to)}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs">
                <span className="font-mono text-white/50">{formatTransactionTime(event.timestamp)}</span>
                <span className={cn("rounded-md border px-2 py-1 font-medium", statusClass(event.status))}>
                  {event.status}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
      {!isLoading && !error && events.length > 0 && !historyComplete ? (
        <p className="mt-3 text-xs text-white/35">
          Showing the latest {events.length} ArcLend app transactions. Older explorer pages were not loaded.
        </p>
      ) : null}
    </GlassCard>
  );
}

export default function DashboardPage() {
  const [activeModal, setActiveModal] = useState<ActionModal>(null);
  const [selectedMarket, setSelectedMarket] = useState<MarketAsset | null>(null);
  const { markets, isPaused, isError } = useLiveMarkets();

  const closeModal = useCallback(() => setActiveModal(null), []);
  const openModal = useCallback((modal: ActionModal, market: MarketAsset) => {
    if (isPaused && (modal === "supply" || modal === "borrow")) {
      return;
    }
    setSelectedMarket(market);
    setActiveModal(modal);
  }, [isPaused]);

  const activeMarket = useMemo(() => selectedMarket, [selectedMarket]);

  return (
    <PageTransition>
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
      <PageHeader
        icon={<BarChart2 />}
        title="ArcLend Markets"
        description="A single view of stablecoin liquidity, live rates, and your lending position across Arc Network."
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
      <ProtocolStatsBar markets={markets} isPaused={isPaused} />
      <UserSummary markets={markets} />
      <MarketsTable markets={markets} onOpen={openModal} />
      <MyTransactions />

      <SupplyModal open={activeModal === "supply"} market={activeMarket} onClose={closeModal} />
      <BorrowModal open={activeModal === "borrow"} market={activeMarket} onClose={closeModal} />
      <RepayModal open={activeModal === "repay"} market={activeMarket} onClose={closeModal} />
      <WithdrawModal open={activeModal === "withdraw"} market={activeMarket} onClose={closeModal} />
    </div>
    </PageTransition>
  );
}
