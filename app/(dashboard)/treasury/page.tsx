"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Building2,
  Coins,
  ArrowDownRight,
  TrendingUp,
} from "lucide-react";
import {
  createPublicClient,
  formatUnits,
  http,
  parseAbiItem,
  type Address,
} from "viem";
import { arcTestnet } from "viem/chains";
import { GlassCard } from "@/components/ui/GlassCard";
import { PageTransition } from "@/components/layout/PageTransition";
import { PageHeader } from "@/components/layout/PageHeader";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { Skeleton } from "@/components/ui/Skeleton";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import { cn } from "@/lib/utils";
import deployments from "@/constants/deployments.json";

// ─── Constants ────────────────────────────────────────────────────────

const USDC: Address = "0x3600000000000000000000000000000000000000";
const EURC: Address = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

const TREASURY_ABI = [
  {
    type: "function",
    name: "getBalance",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});

const depositedEvent = parseAbiItem(
  "event Deposited(address indexed asset, address indexed from, uint256 amount, string source)",
);

type DepositEvent = {
  asset: Address;
  from: Address;
  amount: bigint;
  source: string;
  blockNumber: bigint;
};

// ─── Helpers ──────────────────────────────────────────────────────────

function useTreasuryBalances(address?: Address) {
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);
  const [eurcBalance, setEurcBalance] = useState<bigint | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const treasuryAddr = address as Address;
    if (!treasuryAddr) {
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();

    async function fetchBalances() {
      try {
        const [usdc, eurc] = await Promise.all([
          publicClient.readContract({
            address: treasuryAddr,
            abi: TREASURY_ABI,
            functionName: "getBalance",
            args: [USDC],
          }),
          publicClient.readContract({
            address: treasuryAddr,
            abi: TREASURY_ABI,
            functionName: "getBalance",
            args: [EURC],
          }),
        ]);
        if (!controller.signal.aborted) {
          setUsdcBalance(usdc);
          setEurcBalance(eurc);
        }
      } catch {
        // RPC errors — leave balances null
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    fetchBalances();
    // Poll every 30 seconds for live updates.
    const interval = setInterval(fetchBalances, 30_000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [address]);

  return { usdcBalance, eurcBalance, isLoading };
}

function useRevenueBreakdown(address?: Address) {
  const [breakdown, setBreakdown] = useState<
    { source: string; total: bigint }[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const treasuryAddr = address as Address;
    if (!treasuryAddr) {
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();

    async function fetchEvents() {
      try {
        // Fetch Deposited events from the last ~90 days (Arc Testnet blocks).
        const latestBlock = await publicClient.getBlockNumber();
        const fromBlock = latestBlock - BigInt(2_000_000); // ~3 months on Arc

        const logs = await publicClient.getLogs({
          address: treasuryAddr,
          event: depositedEvent,
          fromBlock: fromBlock < 0n ? 0n : fromBlock,
          toBlock: latestBlock,
        });

        const bySource = new Map<string, bigint>();
        for (const log of logs) {
          const { source, amount } = log.args;
          if (!source || amount == null) continue;
          const prev = bySource.get(source) ?? 0n;
          bySource.set(source, prev + (amount as bigint));
        }

        const entries = Array.from(bySource.entries())
          .map(([source, total]) => ({ source, total }))
          .sort((a, b) => (b.total > a.total ? 1 : -1));

        if (!controller.signal.aborted) {
          setBreakdown(entries);
        }
      } catch {
        // RPC may not serve historical logs — leave empty
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    fetchEvents();
  }, [address]);

  return { breakdown, isLoading };
}

// ─── UI ───────────────────────────────────────────────────────────────

function BalanceCard({
  label,
  symbol,
  balance,
  isLoading,
}: {
  label: string;
  symbol: string;
  balance: bigint | null;
  isLoading: boolean;
}) {
  const displayValue = balance
    ? Number(formatUnits(balance, 6)) // USDC/EURC are 6 decimals
    : 0;

  return (
    <GlassCard depth="foreground" className="p-6">
      <div className="flex items-center gap-2 text-xs text-white/42">
        <Coins className="h-4 w-4 text-white/65" strokeWidth={1.5} />
        {label}
      </div>
      <div className="mt-4 font-mono text-3xl text-white">
        {isLoading ? (
          <Skeleton height={36} className="w-44 rounded-md" />
        ) : (
          <AnimatedNumber
            value={displayValue}
            prefix="$"
            decimals={2}
          />
        )}
      </div>
      <p className="mt-1 text-xs text-white/35">{symbol} held in Treasury</p>
    </GlassCard>
  );
}

function RevenueBreakdownCard({
  breakdown,
  isLoading,
}: {
  breakdown: { source: string; total: bigint }[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <GlassCard depth="foreground" className="p-6">
        <div className="flex items-center gap-2 text-xs text-white/42">
          <ArrowDownRight
            className="h-4 w-4 text-white/65"
            strokeWidth={1.5}
          />
          Revenue sources
        </div>
        <div className="mt-4 space-y-3">
          <Skeleton height={48} className="rounded-xl" />
          <Skeleton height={48} className="rounded-xl" />
        </div>
      </GlassCard>
    );
  }

  if (breakdown.length === 0) {
    return (
      <GlassCard depth="foreground" className="p-6">
        <div className="flex items-center gap-2 text-xs text-white/42">
          <ArrowDownRight
            className="h-4 w-4 text-white/65"
            strokeWidth={1.5}
          />
          Revenue sources
        </div>
        <p className="mt-4 text-sm text-white/35">
          No revenue recorded yet. Once FlashLoanPool and SwapPool start
          routing fees to Treasury, revenue will appear here automatically,
          broken down by source.
        </p>
      </GlassCard>
    );
  }

  return (
    <GlassCard depth="foreground" className="p-6">
      <div className="flex items-center gap-2 text-xs text-white/42">
        <ArrowDownRight
          className="h-4 w-4 text-white/65"
          strokeWidth={1.5}
        />
        Revenue by source
      </div>
      <div className="mt-4 space-y-3">
        {breakdown.map((entry, index) => {
          const label =
            entry.source === "FlashLoanPool"
              ? "From Flash Loans"
              : entry.source === "SwapPool"
                ? "From Swap Fees"
                : `From ${entry.source}`;

          return (
            <motion.div
              key={entry.source}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1, duration: 0.3 }}
              className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-black/20 p-4"
            >
              <span className="text-sm text-white/80">{label}</span>
              <span className="font-mono text-lg text-white">
                <AnimatedNumber
                  value={Number(formatUnits(entry.total, 6))}
                  prefix="$"
                  decimals={2}
                />
              </span>
            </motion.div>
          );
        })}
      </div>
    </GlassCard>
  );
}

function TotalRevenueCard({
  breakdown,
  isLoading,
}: {
  breakdown: { source: string; total: bigint }[];
  isLoading: boolean;
}) {
  const total = useMemo(
    () =>
      breakdown.reduce((sum, entry) => sum + entry.total, 0n),
    [breakdown],
  );
  const displayValue = Number(formatUnits(total, 6));

  return (
    <GlassCard depth="foreground" className="p-6">
      <div className="flex items-center gap-2 text-xs text-white/42">
        <TrendingUp className="h-4 w-4 text-white/65" strokeWidth={1.5} />
        Total revenue collected
      </div>
      <div className="mt-4 font-mono text-3xl text-white">
        {isLoading ? (
          <Skeleton height={36} className="w-44 rounded-md" />
        ) : (
          <AnimatedNumber
            value={displayValue}
            prefix="$"
            decimals={2}
          />
        )}
      </div>
      <p className="mt-1 text-xs text-white/35">Across all sources, since inception</p>
    </GlassCard>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────

export default function TreasuryPage() {
  const treasuryAddress = (deployments as Record<string, any>).Treasury as
    | Address
    | undefined;

  const { usdcBalance, eurcBalance, isLoading: balancesLoading } =
    useTreasuryBalances(treasuryAddress);
  const { breakdown, isLoading: eventsLoading } =
    useRevenueBreakdown(treasuryAddress);

  if (!treasuryAddress) {
    return (
      <PageTransition>
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
          <PageHeader
            icon={<Building2 />}
            title="Protocol Treasury"
            description="Treasury has not been deployed yet. Run script 18 first."
          />
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={<Building2 />}
          title="Protocol Treasury"
          description="Real, on-chain protocol revenue — fully transparent."
        />

        {/* Live balance cards */}
        <div className="grid gap-4 sm:grid-cols-2">
          <BalanceCard
            label="USDC Balance"
            symbol="USDC"
            balance={usdcBalance}
            isLoading={balancesLoading}
          />
          <BalanceCard
            label="EURC Balance"
            symbol="EURC"
            balance={eurcBalance}
            isLoading={balancesLoading}
          />
        </div>

        {/* Revenue breakdown */}
        <div className="grid gap-4 lg:grid-cols-2">
          <TotalRevenueCard
            breakdown={breakdown}
            isLoading={eventsLoading}
          />
          <RevenueBreakdownCard
            breakdown={breakdown}
            isLoading={eventsLoading}
          />
        </div>

        {/* Note */}
        <GlassCard depth="background" className="p-5">
          <p className="text-sm leading-relaxed text-white/50">
            Treasury funds support protocol development and partner
            fee-sharing through Lendora&rsquo;s Liquidity-as-a-Service
            program. Every deposit is recorded on-chain with a source label
            for full auditability. All withdrawals require owner (or
            authorized spender) authorization, with the intent to migrate
            ownership to a Gnosis Safe multi-sig before mainnet.
          </p>
        </GlassCard>
      </div>
    </PageTransition>
  );
}
