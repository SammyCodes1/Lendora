"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownCircle,
  CheckCircle2,
  Coins,
  CreditCard,
  ExternalLink,
  Loader2,
} from "lucide-react";
import {
  erc20Abi,
  formatUnits,
  type Hash,
} from "viem";
import {
  useChainId,
  usePublicClient,
  useSwitchChain,
} from "wagmi";
import deployments from "@/constants/deployments.json";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { StatBadge } from "@/components/ui/StatBadge";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { HealthFactorRing } from "@/components/ui/HealthFactorRing";
import { HealthFactorValue } from "@/components/ui/HealthFactorValue";
import { Skeleton } from "@/components/ui/Skeleton";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import {
  resultHash,
  useArcLendContractWrite,
} from "@/hooks/useArcLendContractWrite";
import { PageTransition } from "@/components/layout/PageTransition";
import { PageHeader } from "@/components/layout/PageHeader";
import { BorrowModal } from "@/components/modals/BorrowModal";
import { RepayModal } from "@/components/modals/RepayModal";
import { PositionSimulator } from "@/components/borrow/PositionSimulator";
import type { MarketAsset } from "@/components/modals/types";
import {
  useRepayAction,
  useUserAccountData,
} from "@/hooks/useLendingPool";
import { useLiveMarkets } from "@/hooks/useLiveMarkets";
import { formatRemainingCap, formatReserveCap } from "@/lib/markets";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { AssetMark, ReceiptTokenLinks, SectionLabel } from "@/components/ui/MarketVisuals";

type ModalState = {
  type: "borrow" | "repay";
  market: MarketAsset;
} | null;

function numericHealthFactor(value?: bigint) {
  if (!value || value > 100_0000000000000000000n) {
    return 9.99;
  }

  return Number(formatUnits(value, 18));
}

function HealthFactorDashboard() {
  const { address, isConnected } = useArcLendAccount();
  const { accountData, isPending } = useUserAccountData(address);
  const health = numericHealthFactor(accountData?.healthFactor);
  const healthClass = health > 1.5 ? "text-white" : health >= 1 ? "text-white/70" : "text-red-300";

  return (
    <GlassCard depth="foreground" className="px-5 py-8 sm:px-8 sm:py-10">
      {isConnected && isPending ? (
        <div className="flex flex-col items-center gap-6">
          <Skeleton width={280} height={280} className="mx-auto rounded-full" />
          <Skeleton width="70%" height={72} />
        </div>
      ) : isConnected ? (
        <div className="flex flex-col items-center text-center">
          <SectionLabel>Position safety</SectionLabel>
          <div className="relative mx-auto mt-3 flex h-52 w-52 items-center justify-center overflow-hidden sm:h-80 sm:w-80">
            <div className="absolute scale-[0.65] sm:scale-100">
              <HealthFactorRing value={health} size={320} showValue={false} />
            </div>
            <div className="relative z-10 flex flex-col items-center justify-center">
              <HealthFactorValue value={health} className={cn("font-mono text-4xl font-medium sm:text-7xl", healthClass)} />
              <p className="mt-2 text-[10px] font-semibold uppercase text-white/35">Health Factor</p>
            </div>
          </div>
          <div className="mt-2 grid w-full max-w-3xl grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-white/[0.08] sm:rounded-2xl sm:border sm:border-white/[0.08] sm:bg-black/20 sm:py-4">
            <div className="rounded-xl border border-white/[0.08] bg-black/20 px-3 py-3 sm:rounded-none sm:border-0 sm:bg-transparent sm:px-5 sm:py-0">
              <p className="text-[10px] text-white/35 sm:text-xs">Collateral</p>
              <AnimatedNumber className="mt-1 block font-mono text-base text-white sm:mt-2 sm:text-lg" value={Number(formatUnits(accountData?.totalCollateralUSD ?? 0n, 8))} prefix="$" decimals={2} />
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-black/20 px-3 py-3 sm:rounded-none sm:border-0 sm:bg-transparent sm:px-5 sm:py-0">
              <p className="text-[10px] text-white/35 sm:text-xs">Debt</p>
              <AnimatedNumber className="mt-1 block font-mono text-base text-white sm:mt-2 sm:text-lg" value={Number(formatUnits(accountData?.totalDebtUSD ?? 0n, 8))} prefix="$" decimals={2} />
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-black/20 px-3 py-3 sm:rounded-none sm:border-0 sm:bg-transparent sm:px-5 sm:py-0">
              <p className="text-[10px] text-white/35 sm:text-xs">Available</p>
              <AnimatedNumber className="mt-1 block font-mono text-base text-white sm:mt-2 sm:text-lg" value={Number(formatUnits(accountData?.availableBorrowsUSD ?? 0n, 8))} prefix="$" decimals={2} />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-white">Connect wallet to view your position</h2>
            <p className="mt-2 text-white/55">Health factor and borrowing power appear after wallet connection.</p>
          </div>
          <ConnectWalletButton />
        </div>
      )}
    </GlassCard>
  );
}

type BalanceSnapshot = {
  balance: bigint;
  formatted: string;
};

function ActiveLoan({
  market,
  balance,
  onRepay,
  onRepayInterest,
  isRepayingInterest,
  interestRepayHash,
}: {
  market: MarketAsset;
  balance: BalanceSnapshot;
  onRepay: (market: MarketAsset) => void;
  onRepayInterest: (market: MarketAsset) => void;
  isRepayingInterest: boolean;
  interestRepayHash?: Hash;
}) {
  const accruedInterest = Number(
    formatUnits(market.accruedBorrowInterest, 6),
  );

  return (
    <div className="rounded-2xl border border-white/[0.09] bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <AssetMark symbol={market.symbol} size="sm" />
          <div>
            <p className="font-medium text-white">{market.symbol}</p>
            <p className="font-mono text-sm text-white/55"><AnimatedNumber value={Number(formatUnits(balance.balance, 6))} decimals={2} /> borrowed</p>
          </div>
        </div>
        <StatBadge label="APR" value={market.borrowApr} />
      </div>
      <div className="mt-4 rounded-md border border-white/[0.07] bg-black/15 px-3 py-2.5">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="flex items-center gap-1.5 text-white/45">
            <Activity className="h-3.5 w-3.5 text-white/50" />
            Interest accrued
          </span>
          <AnimatedNumber
            className="font-mono text-white/75"
            value={accruedInterest}
            prefix="+"
            suffix={` ${market.symbol}`}
            decimals={6}
          />
        </div>
        <p className="mt-1.5 text-[10px] text-white/30">
          Live estimate until the next onchain reserve update.
        </p>
      </div>
      {interestRepayHash ? (
        <a
          href={`https://testnet.arcscan.app/tx/${interestRepayHash}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs text-white/75"
        >
          <CheckCircle2 className="h-4 w-4" />
          Interest repayment confirmed
          <ExternalLink className="ml-auto h-3.5 w-3.5" />
        </a>
      ) : null}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <GlassButton
          variant="primary"
          disabled={
            market.accruedBorrowInterest === 0n ||
            isRepayingInterest
          }
          onClick={() => onRepayInterest(market)}
        >
          {isRepayingInterest ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Coins className="h-4 w-4" />
          )}
          Pay interest
        </GlassButton>
        <GlassButton
          variant="ghost"
          disabled={isRepayingInterest}
          onClick={() => onRepay(market)}
        >
          Repay
        </GlassButton>
      </div>
    </div>
  );
}

function BorrowMarket({
  market,
  availableUsd,
  onBorrow,
  disabled,
}: {
  market: MarketAsset;
  availableUsd: bigint;
  onBorrow: (market: MarketAsset) => void;
  disabled?: boolean;
}) {
  // Per-asset max borrow, mirroring BorrowModal: convert the wallet's USD
  // borrowing power into this asset's units, then cap by liquidity & borrow cap.
  const price = market.price || 1n;
  const availableByCollateral = (availableUsd * 1_000_000n) / price;
  let maxBorrow =
    availableByCollateral < market.availableLiquidity
      ? availableByCollateral
      : market.availableLiquidity;
  if (market.isBorrowCapped && market.remainingBorrowCap < maxBorrow) {
    maxBorrow = market.remainingBorrowCap;
  }

  return (
    <GlassCard glowOnHover depth="foreground" className="rounded-2xl p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AssetMark symbol={market.symbol} size="lg" />
          <div>
            <h3 className="font-semibold text-white">{market.name}</h3>
            <p className="text-sm text-white/45">Collateralized stablecoin borrowing</p>
            <ReceiptTokenLinks
              aToken={market.aToken}
              debtToken={market.debtToken}
              symbol={market.symbol}
            />
          </div>
        </div>
        <ArrowDownCircle className="h-5 w-5 text-white/60" />
      </div>
      <div className="mt-5">
        <SectionLabel>Borrow APR</SectionLabel>
        <p className="mt-2 font-mono text-4xl font-medium text-white sm:text-5xl">
          <AnimatedNumber value={Number.parseFloat(market.borrowApr)} decimals={2} suffix="%" />
        </p>
      </div>
      <div className="mt-6 grid gap-3 rounded-2xl border border-white/[0.07] bg-black/20 p-4 text-sm text-white/48">
        <div className="flex justify-between"><span>Your max borrowable</span><AnimatedNumber className="font-mono text-white" value={Number(formatUnits(maxBorrow, 6))} suffix={` ${market.symbol}`} decimals={2} /></div>
        <div className="flex justify-between"><span>Maximum LTV</span><span className="text-white">{(market.ltv / 100).toFixed(0)}%</span></div>
        <div className="flex justify-between"><span>Liq. threshold</span><span className="text-white">{(market.liquidationThreshold / 100).toFixed(0)}%</span></div>
        <div className="flex justify-between"><span>Market liquidity</span><AnimatedNumber className="font-mono text-white" value={Number(formatUnits(market.availableLiquidityUsd, 8))} prefix="$" decimals={2} /></div>
        <div className="flex justify-between">
          <span>Borrow cap</span>
          <span className="font-mono text-white">
            {formatReserveCap(market.borrowCap, market.isBorrowCapped, { compact: true })}
            {market.isBorrowCapped ? ` ${market.symbol}` : ""}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Cap remaining</span>
          <span className="font-mono text-white/80">
            {formatRemainingCap(
              market.remainingBorrowCap,
              market.isBorrowCapped,
              market.symbol,
            )}
          </span>
        </div>
      </div>
      <GlassButton
        variant="primary"
        className="mt-5 w-full"
        disabled={disabled}
        onClick={() => onBorrow(market)}
      >
        {disabled ? "Paused" : "Borrow"}
      </GlassButton>
    </GlassCard>
  );
}

export default function BorrowPage() {
  const [modal, setModal] = useState<ModalState>(null);
  const { address, isConnected, source } = useArcLendAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: 5042002 });
  const { switchChainAsync } = useSwitchChain();
  const contractWrite = useArcLendContractWrite();
  const repayAction = useRepayAction();
  const { accountData } = useUserAccountData(address);
  const { markets, isError, isPaused, refetch } = useLiveMarkets();
  const [repayingSymbol, setRepayingSymbol] = useState<
    MarketAsset["symbol"] | null
  >(null);
  const [isRepayingAllInterest, setIsRepayingAllInterest] =
    useState(false);
  const [interestRepayHashes, setInterestRepayHashes] = useState<
    Partial<Record<MarketAsset["symbol"], Hash>>
  >({});
  const activeLoans = markets
    .filter((market) => market.userDebt > 0n)
    .map((market) => ({
      market,
      balance: {
        balance: market.userDebt,
        formatted: Number(formatUnits(market.userDebt, 6)).toLocaleString(undefined, { maximumFractionDigits: 6 }),
      },
    }));
  const totalBorrowUsd = markets.reduce(
    (sum, market) => sum + market.totalBorrowUsd,
    0n,
  );
  const totalLiquidityUsd = markets.reduce(
    (sum, market) => sum + market.availableLiquidityUsd,
    0n,
  );
  const loansWithInterest = useMemo(
    () =>
      markets.filter(
        (market) =>
          market.userDebt > 0n &&
          market.accruedBorrowInterest > 0n,
      ),
    [markets],
  );

  const ensureArc = useCallback(async () => {
    if (!address) {
      throw new Error(
        "Connect your wallet before repaying interest.",
      );
    }
    if (!publicClient) {
      throw new Error("Arc client is unavailable.");
    }
    if (source === "wallet" && chainId !== 5042002) {
      await switchChainAsync({ chainId: 5042002 });
    }
  }, [address, chainId, publicClient, source, switchChainAsync]);

  const repayInterestForMarket = useCallback(
    async (market: MarketAsset) => {
      const amount = market.accruedBorrowInterest;
      if (!address || !publicClient || amount <= 0n) {
        return null;
      }

      const walletBalance = await publicClient.readContract({
        address: market.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      });
      if (walletBalance < amount) {
        throw new Error(
          `You need ${formatUnits(amount, 6)} ${market.symbol} in your wallet to repay the accrued interest.`,
        );
      }

      const allowance = await publicClient.readContract({
        address: market.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, deployments.lendingPool as `0x${string}`],
      });
      if (allowance < amount) {
        const approvalResult = await contractWrite.writeContractAsync({
          chainId: 5042002,
          address: market.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [
            deployments.lendingPool as `0x${string}`,
            amount,
          ],
        });
        const approvalHash = resultHash(approvalResult);
        if (approvalHash) {
          await publicClient.waitForTransactionReceipt({ hash: approvalHash });
        }
      }

      const hash = await repayAction.repay(market.address, amount);
      if (hash) {
        await publicClient.waitForTransactionReceipt({ hash });
        setInterestRepayHashes((current) => ({
          ...current,
          [market.symbol]: hash,
        }));
      }
      return hash;
    },
    [
      address,
      publicClient,
      repayAction,
      contractWrite,
    ],
  );

  const repayInterest = useCallback(
    async (market: MarketAsset) => {
      setRepayingSymbol(market.symbol);
      try {
        await ensureArc();
        const hash = await repayInterestForMarket(market);
        if (hash) {
          showToast(
            "success",
            `${formatUnits(market.accruedBorrowInterest, 6)} ${market.symbol} interest repaid`,
          );
          await refetch();
        }
      } catch (error) {
        showToast(
          "error",
          error instanceof Error
            ? error.message
            : `Could not repay ${market.symbol} interest`,
        );
      } finally {
        setRepayingSymbol(null);
      }
    },
    [ensureArc, refetch, repayInterestForMarket],
  );

  const repayAllInterest = useCallback(async () => {
    if (loansWithInterest.length === 0) return;
    setIsRepayingAllInterest(true);
    try {
      await ensureArc();
      for (const market of loansWithInterest) {
        setRepayingSymbol(market.symbol);
        await repayInterestForMarket(market);
      }
      showToast(
        "success",
        `Interest repaid across ${loansWithInterest.length} loan${
          loansWithInterest.length === 1 ? "" : "s"
        }`,
      );
      await refetch();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error
          ? error.message
          : "Repay all interest did not complete",
      );
    } finally {
      setRepayingSymbol(null);
      setIsRepayingAllInterest(false);
    }
  }, [
    ensureArc,
    loansWithInterest,
    refetch,
    repayInterestForMarket,
  ]);

  return (
    <PageTransition>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={<CreditCard />}
          title="Borrow"
          description="Open collateralized stablecoin loans, watch health factor movement, and repay principal or accrued interest from a single focused view. EURC uses a lower LTV than USDC to reduce cross-stable depeg risk."
          stats={[
            {
              label: "Total borrowed",
              value: `$${Number(formatUnits(totalBorrowUsd, 8)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
            },
            {
              label: "Liquidity",
              value: `$${Number(formatUnits(totalLiquidityUsd, 8)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
              tone: "positive",
            },
            {
              label: "Active loans",
              value: activeLoans.length.toString(),
            },
          ]}
        />

        {isError ? (
          <div
            role="alert"
            className="rounded-2xl border border-red-400/20 bg-red-400/[0.07] px-4 py-3 text-sm text-red-200"
          >
            Market data failed to load (RPC or oracle). Borrow limits may be
            incomplete.
          </div>
        ) : null}
        {isPaused ? (
          <div
            role="status"
            className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 text-sm text-amber-100"
          >
            Protocol is paused. New borrows are disabled.
          </div>
        ) : null}

        <HealthFactorDashboard />

        <PositionSimulator
          accountData={accountData}
          markets={markets}
          isConnected={isConnected}
          isPaused={isPaused}
        />

        <div className="grid gap-6 lg:grid-cols-2">
          <GlassCard depth="background" className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-white">
                  Your Active Loans
                </h2>
                <p className="mt-1 text-xs text-white/35">
                  Borrow interest is owed, so these controls repay it without reducing principal.
                </p>
              </div>
              <GlassButton
                variant="primary"
                className="px-3"
                disabled={
                  isRepayingAllInterest ||
                  repayingSymbol !== null ||
                  loansWithInterest.length === 0
                }
                onClick={() => void repayAllInterest()}
              >
                {isRepayingAllInterest ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Coins className="h-4 w-4" />
                )}
                Pay all interest
              </GlassButton>
            </div>
            <div className="mt-5 space-y-3">
              {activeLoans.length > 0 ? (
                activeLoans.map((loan) => (
                  <ActiveLoan
                    key={loan.market.symbol}
                    market={loan.market}
                    balance={loan.balance}
                    onRepay={(selected) =>
                      setModal({ type: "repay", market: selected })
                    }
                    onRepayInterest={(selected) =>
                      void repayInterest(selected)
                    }
                    isRepayingInterest={
                      isRepayingAllInterest ||
                      repayingSymbol === loan.market.symbol
                    }
                    interestRepayHash={
                      interestRepayHashes[loan.market.symbol]
                    }
                  />
                ))
              ) : (
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-5 text-sm text-white/45">No active loans found.</div>
              )}
            </div>
          </GlassCard>

          <div className="space-y-4">
            <div><SectionLabel>Isolated reserves</SectionLabel><h2 className="mt-2 text-xl font-semibold text-white">Borrow Markets</h2></div>
            {markets.map((market) => (
              <BorrowMarket
                key={market.symbol}
                market={market}
                availableUsd={accountData?.availableBorrowsUSD ?? 0n}
                disabled={isPaused}
                onBorrow={(selected) =>
                  setModal({ type: "borrow", market: selected })
                }
              />
            ))}
          </div>
        </div>

        <BorrowModal open={modal?.type === "borrow"} market={modal?.market ?? null} onClose={() => setModal(null)} />
        <RepayModal open={modal?.type === "repay"} market={modal?.market ?? null} onClose={() => setModal(null)} />
      </div>
    </PageTransition>
  );
}
