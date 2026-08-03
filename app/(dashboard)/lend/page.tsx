"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Coins,
  ExternalLink,
  Loader2,
  PiggyBank,
  Wallet,
} from "lucide-react";
import { formatUnits, type Abi, type Hash } from "viem";
import {
  useChainId,
  usePublicClient,
  useSwitchChain,
} from "wagmi";
import lendingPoolAbi from "@/constants/abis/LendingPool.json";
import deployments from "@/constants/deployments.json";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { StatBadge } from "@/components/ui/StatBadge";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { APYGauge } from "@/components/ui/APYGauge";
import { Skeleton } from "@/components/ui/Skeleton";
import { PageTransition } from "@/components/layout/PageTransition";
import { PageHeader } from "@/components/layout/PageHeader";
import { SupplyModal } from "@/components/modals/SupplyModal";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import { WithdrawModal } from "@/components/modals/WithdrawModal";
import type { MarketAsset } from "@/components/modals/types";
import { errorMessage } from "@/components/modals/modalUtils";
import { useWithdrawAction } from "@/hooks/useLendingPool";
import { useLiveMarkets } from "@/hooks/useLiveMarkets";
import { formatRemainingCap, formatReserveCap } from "@/lib/markets";
import { showToast } from "@/lib/toast";
import { AssetMark, SectionLabel } from "@/components/ui/MarketVisuals";

type ModalState = {
  type: "supply" | "withdraw";
  market: MarketAsset;
} | null;

type BalanceSnapshot = {
  balance: bigint;
  formatted: string;
  isLoading?: boolean;
};

function SuppliedPosition({
  market,
  balance,
  onWithdraw,
  onClaim,
  isClaiming,
  claimHash,
}: {
  market: MarketAsset;
  balance: BalanceSnapshot;
  onWithdraw: (market: MarketAsset) => void;
  onClaim: (market: MarketAsset) => void;
  isClaiming: boolean;
  claimHash?: Hash;
}) {
  // balance.balance is projected userSupply (settled aToken + live pending).
  // Show settled aToken on the asset line so it correlates with pending:
  // settled + pending = total position.
  const totalAmount = Number(formatUnits(balance.balance, 6));
  const settledAmount = Number(formatUnits(market.settledUserSupply, 6));
  const accruedAmount = Number(formatUnits(market.accruedSupply, 6));
  const price = Number(formatUnits(market.price, market.priceDecimals));
  const suppliedValue = totalAmount * price;
  const accruedValue = accruedAmount * price;

  return (
    <div className="rounded-2xl border border-white/[0.09] bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition hover:-translate-y-0.5 hover:border-white/15 hover:bg-white/[0.05]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <AssetMark symbol={market.symbol} size="sm" />
          <div>
            <p className="font-medium text-white">{market.name}</p>
            <p className="font-mono text-sm text-white/55">
              <AnimatedNumber value={settledAmount} decimals={6} /> a{market.symbol}
            </p>
            {accruedAmount > 0 ? (
              <p className="mt-0.5 font-mono text-[11px] text-white/35">
                Total position{" "}
                <AnimatedNumber value={totalAmount} decimals={6} /> {market.symbol}
              </p>
            ) : null}
          </div>
        </div>
        <StatBadge label="APY" value={market.supplyApy} tone="positive" />
      </div>
      <div className="mt-4 grid gap-2 text-sm text-white/55">
        <div className="flex justify-between"><span>USD value</span><AnimatedNumber className="font-mono text-white" value={suppliedValue} prefix="$" decimals={2} /></div>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-white/55" />
            Pending interest estimate
          </span>
          <span className="text-right">
            <AnimatedNumber
              className="font-mono text-[#86efac]"
              value={accruedAmount}
              prefix="+"
              suffix={` ${market.symbol}`}
              decimals={6}
            />
            <span className="ml-2 font-mono text-xs text-[#86efac]">
              ≈ ${accruedValue.toFixed(4)}
            </span>
          </span>
        </div>
        <p className="text-[10px] leading-4 text-white/30">
          a{market.symbol} is your settled on-chain balance. Pending interest is the live estimate not yet written into the reserve index — settled + pending = total position. It settles on any reserve update (including a new supply).
        </p>
      </div>
      {claimHash ? (
        <a
          href={`https://testnet.arcscan.app/tx/${claimHash}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs text-white/75"
        >
          <CheckCircle2 className="h-4 w-4" />
          Yield withdrawal confirmed
          <ExternalLink className="ml-auto h-3.5 w-3.5" />
        </a>
      ) : null}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <GlassButton
          variant="primary"
          disabled={market.accruedSupply === 0n || isClaiming}
          onClick={() => onClaim(market)}
        >
          {isClaiming ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Coins className="h-4 w-4" />
          )}
          Withdraw yield
        </GlassButton>
        <GlassButton
          variant="ghost"
          disabled={isClaiming}
          onClick={() => onWithdraw(market)}
        >
          Withdraw
        </GlassButton>
      </div>
    </div>
  );
}

function SuppliedPositions({
  markets,
  isLoading,
  onWithdraw,
  onClaim,
  onClaimAll,
  claimingSymbol,
  isClaimingAll,
  claimHashes,
}: {
  markets: MarketAsset[];
  isLoading: boolean;
  onWithdraw: (market: MarketAsset) => void;
  onClaim: (market: MarketAsset) => void;
  onClaimAll: () => void;
  claimingSymbol: MarketAsset["symbol"] | null;
  isClaimingAll: boolean;
  claimHashes: Partial<Record<MarketAsset["symbol"], Hash>>;
}) {
  const positions = markets
    .filter((market) => market.userSupply > 0n)
    .map((market) => ({
      market,
      balance: {
        balance: market.userSupply,
        formatted: Number(formatUnits(market.userSupply, 6)).toLocaleString(undefined, { maximumFractionDigits: 6 }),
      },
    }));

  return (
    <GlassCard depth="background" className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <SectionLabel>Your portfolio</SectionLabel>
          <h2 className="mt-2 text-xl font-semibold text-white">
            Your Supplied Positions
          </h2>
          <p className="mt-1 text-xs text-white/35">
            aToken shows settled balance; pending interest is the live estimate on top. Together they equal your total position.
          </p>
        </div>
        <GlassButton
          variant="primary"
          className="px-3"
          disabled={
            isClaimingAll ||
            claimingSymbol !== null ||
            !positions.some(
              (position) => position.market.accruedSupply > 0n,
            )
          }
          onClick={onClaimAll}
        >
          {isClaimingAll ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Coins className="h-4 w-4" />
          )}
          Withdraw all yield
        </GlassButton>
      </div>
      <div className="mt-5 space-y-3">
        {isLoading ? (
          <>
            <Skeleton height={128} />
            <Skeleton height={128} />
          </>
        ) : positions.length > 0 ? (
          positions.map((position) => (
            <SuppliedPosition
              key={position.market.symbol}
              market={position.market}
              balance={position.balance}
              onWithdraw={onWithdraw}
              onClaim={onClaim}
              isClaiming={
                isClaimingAll ||
                claimingSymbol === position.market.symbol
              }
              claimHash={claimHashes[position.market.symbol]}
            />
          ))
        ) : (
          <div className="rounded-md border border-white/[0.08] bg-black/15 p-6 text-center">
            <PiggyBank className="mx-auto h-8 w-8 text-white/65" />
            <p className="mt-3 text-sm text-white/55">No positions yet. Supply assets below to start earning.</p>
          </div>
        )}
      </div>
    </GlassCard>
  );
}

function MarketSupplyCard({
  market,
  onSupply,
  index,
  disabled,
}: {
  market: MarketAsset;
  onSupply: (market: MarketAsset) => void;
  index: number;
  disabled?: boolean;
}) {
  return (
    <GlassCard glowOnHover depth="foreground" delay={index * 0.08} className="rounded-2xl p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AssetMark symbol={market.symbol} size="lg" />
          <div>
            <h3 className="font-semibold text-white">{market.name}</h3>
            <p className="text-sm text-white/45">{market.symbol}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[10px] text-white/50 sm:px-3 sm:text-xs">
          {market.utilization.toFixed(1)}% utilized
        </span>
      </div>

      <div className="mt-8 grid grid-cols-1 items-center gap-5 sm:grid-cols-[130px_1fr]">
        <div className="mx-auto w-fit sm:mx-0">
          <APYGauge value={market.utilization} />
        </div>
        <div className="min-w-0 text-center sm:text-left">
          <SectionLabel>Supply APY</SectionLabel>
          <p className="mt-2 font-mono text-4xl font-medium tracking-tight text-white sm:text-5xl">
            <AnimatedNumber value={Number.parseFloat(market.supplyApy)} decimals={2} suffix="%" />
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-3 rounded-2xl border border-white/[0.07] bg-black/20 p-4 text-sm text-white/48">
        <div className="flex justify-between"><span>Total supplied</span><AnimatedNumber className="font-mono text-[#86efac]" value={Number(formatUnits(market.totalSupplyUsd, 8))} prefix="$" decimals={2} /></div>
        <div className="flex justify-between"><span>Available liquidity</span><AnimatedNumber className="font-mono text-white" value={Number(formatUnits(market.availableLiquidityUsd, 8))} prefix="$" decimals={2} /></div>
        <div className="flex justify-between">
          <span>Supply cap</span>
          <span className="font-mono text-white">
            {formatReserveCap(market.supplyCap, market.isSupplyCapped, { compact: true })}
            {market.isSupplyCapped ? ` ${market.symbol}` : ""}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Cap remaining</span>
          <span className="font-mono text-white/80">
            {formatRemainingCap(
              market.remainingSupplyCap,
              market.isSupplyCapped,
              market.symbol,
            )}
          </span>
        </div>
      </div>

      {market.utilization >= 80 ? (
        <p className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.06] px-3 py-2 text-[11px] leading-4 text-amber-100/75">
          High utilization ({market.utilization.toFixed(1)}%). Withdrawals may be
          limited to pool cash until borrowers repay — first-mover liquidity risk.
        </p>
      ) : null}

      <GlassButton
        variant="primary"
        className="mt-5 w-full"
        disabled={disabled}
        onClick={() => onSupply(market)}
      >
        {disabled ? "Paused" : "Supply"}
      </GlassButton>
    </GlassCard>
  );
}

export default function LendPage() {
  const [modal, setModal] = useState<ModalState>(null);
  const { address, source } = useArcLendAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: 5042002 });
  const withdrawAction = useWithdrawAction();
  const { markets, isLoading, isError, isPaused, refetch } = useLiveMarkets();
  const [claimingSymbol, setClaimingSymbol] = useState<
    MarketAsset["symbol"] | null
  >(null);
  const [isClaimingAll, setIsClaimingAll] = useState(false);
  const [claimHashes, setClaimHashes] = useState<
    Partial<Record<MarketAsset["symbol"], Hash>>
  >({});

  const claimableMarkets = useMemo(
    () =>
      markets.filter(
        (market) =>
          market.userSupply > 0n && market.accruedSupply > 0n,
      ),
    [markets],
  );
  const totalSupplyUsd = markets.reduce(
    (sum, market) => sum + market.totalSupplyUsd,
    0n,
  );
  const suppliedPositions = markets.filter((market) => market.userSupply > 0n).length;

  const ensureArc = useCallback(async () => {
    if (!address) {
      throw new Error("Connect your wallet before withdrawing yield.");
    }
    if (!publicClient) {
      throw new Error("Arc client is unavailable.");
    }
    if (source === "wallet" && chainId !== 5042002) {
      await switchChainAsync({ chainId: 5042002 });
    }
  }, [address, chainId, publicClient, source, switchChainAsync]);

  const claimMarket = useCallback(
    async (market: MarketAsset) => {
      if (market.accruedSupply <= 0n || !address) return;
      setClaimingSymbol(market.symbol);
      try {
        await ensureArc();
        // Cap projected interest by free pool cash, then simulate before sending.
        let amount =
          market.accruedSupply < market.poolCash
            ? market.accruedSupply
            : market.poolCash;
        if (amount <= 0n) {
          throw new Error(
            "No free pool cash to withdraw yield right now. Wait for repayments.",
          );
        }
        // Binary-search down if HF/cash still blocks the projected amount.
        try {
          await publicClient!.simulateContract({
            address: deployments.lendingPool as `0x${string}`,
            abi: lendingPoolAbi as Abi,
            functionName: "withdraw",
            args: [market.address, amount, address],
            account: address,
          });
        } catch {
          let lo = 0n;
          let hi = amount;
          let best = 0n;
          while (lo <= hi) {
            const mid = (lo + hi) / 2n;
            if (mid === 0n) {
              lo = 1n;
              continue;
            }
            try {
              await publicClient!.simulateContract({
                address: deployments.lendingPool as `0x${string}`,
                abi: lendingPoolAbi as Abi,
                functionName: "withdraw",
                args: [market.address, mid, address],
                account: address,
              });
              best = mid;
              lo = mid + 1n;
            } catch {
              hi = mid - 1n;
            }
          }
          amount = best;
          if (amount <= 0n) {
            throw new Error(
              "Yield cannot be withdrawn safely right now (liquidity or health factor).",
            );
          }
        }

        const hash = await withdrawAction.withdraw(market.address, amount);
        if (hash) {
          await publicClient!.waitForTransactionReceipt({ hash });
          setClaimHashes((current) => ({
            ...current,
            [market.symbol]: hash,
          }));
        }
        showToast(
          "success",
          `${formatUnits(amount, 6)} ${market.symbol} yield withdrawn`,
        );
        await refetch();
      } catch (error) {
        showToast(
          "error",
          errorMessage(error) ||
            `Could not withdraw ${market.symbol} yield`,
        );
      } finally {
        setClaimingSymbol(null);
      }
    },
    [address, ensureArc, publicClient, refetch, withdrawAction],
  );

  const claimAll = useCallback(async () => {
    if (claimableMarkets.length === 0) return;
    setIsClaimingAll(true);
    try {
      for (const market of claimableMarkets) {
        await claimMarket(market);
      }
    } finally {
      setIsClaimingAll(false);
    }
  }, [claimableMarkets, claimMarket]);

  return (
    <PageTransition>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={<Wallet />}
          title="Lend"
          description="Supply USDC and EURC into ArcLend reserves, monitor accrued yield, and withdraw balances without leaving the lending surface. Suppliers share protocol risk: in a bad-debt event the owner may socialize losses by reducing aToken index."
          stats={[
            {
              label: "Total supplied",
              value: `$${Number(formatUnits(totalSupplyUsd, 8)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
              tone: "positive",
            },
            {
              label: "Your positions",
              value: suppliedPositions.toString(),
            },
            {
              label: "Yield claims",
              value: claimableMarkets.length.toString(),
              tone: claimableMarkets.length > 0 ? "positive" : "neutral",
            },
          ]}
        />

        {isError ? (
          <div
            role="alert"
            className="rounded-2xl border border-red-400/20 bg-red-400/[0.07] px-4 py-3 text-sm text-red-200"
          >
            Market data failed to load (RPC or oracle). Figures may be incomplete —
            use refresh or try again shortly.
          </div>
        ) : null}
        {isPaused ? (
          <div
            role="status"
            className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 text-sm text-amber-100"
          >
            Protocol is paused. New supplies are disabled; withdraw and repay may
            still work depending on pool policy.
          </div>
        ) : null}

        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-xs leading-5 text-white/45">
          <strong className="font-medium text-white/70">Supplier risk note.</strong>{" "}
          Yield is variable. If a borrower cannot be fully liquidated, governance may
          write off bad debt and reduce the reserve liquidity index — haircutting
          all suppliers of that asset. Withdrawals also require free pool cash
          (not currently borrowed).
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <SuppliedPositions
            markets={markets}
            isLoading={isLoading}
            onWithdraw={(market) =>
              setModal({ type: "withdraw", market })
            }
            onClaim={(market) => void claimMarket(market)}
            onClaimAll={() => void claimAll()}
            claimingSymbol={claimingSymbol}
            isClaimingAll={isClaimingAll}
            claimHashes={claimHashes}
          />
          <div className="space-y-4">
            <div>
              <SectionLabel>Isolated reserves</SectionLabel>
              <h2 className="mt-2 text-xl font-semibold text-white">Available Markets</h2>
            </div>
            {markets.map((market, index) => (
              <MarketSupplyCard
                key={market.symbol}
                market={market}
                index={index}
                disabled={isPaused}
                onSupply={(selected) => setModal({ type: "supply", market: selected })}
              />
            ))}
          </div>
        </div>

        <SupplyModal open={modal?.type === "supply"} market={modal?.market ?? null} onClose={() => setModal(null)} />
        <WithdrawModal open={modal?.type === "withdraw"} market={modal?.market ?? null} onClose={() => setModal(null)} />
      </div>
    </PageTransition>
  );
}
