"use client";

import { useCallback, useMemo, useState } from "react";
import { CreditCard } from "lucide-react";
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
import { PageTransition } from "@/components/layout/PageTransition";
import { PageHeader } from "@/components/layout/PageHeader";
import { BorrowModal } from "@/components/modals/BorrowModal";
import { RepayModal } from "@/components/modals/RepayModal";
import type { MarketAsset } from "@/components/modals/types";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import {
  resultHash,
  useArcLendContractWrite,
} from "@/hooks/useArcLendContractWrite";
import {
  useRepayAction,
  useUserAccountData,
} from "@/hooks/useLendingPool";
import { useLiveMarkets } from "@/hooks/useLiveMarkets";
import { showToast } from "@/lib/toast";
import { PositionSimulator } from "@/components/borrow/PositionSimulator";
import {
  AssetFilterBar,
  BorrowMarketsTable,
  BorrowPositionStrip,
  FeaturedBorrowBoard,
  YourBorrowsTable,
} from "@/components/markets/ExploreMarkets";
import type { LendoraAssetFilter } from "@/lib/markets";

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

export default function BorrowPage() {
  const [modal, setModal] = useState<ModalState>(null);
  const [assetFilter, setAssetFilter] = useState<LendoraAssetFilter>("ALL");
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
  const [isRepayingAllInterest, setIsRepayingAllInterest] = useState(false);
  const [interestRepayHashes, setInterestRepayHashes] = useState<
    Partial<Record<MarketAsset["symbol"], Hash>>
  >({});

  const activeLoanCount = markets.filter((market) => market.userDebt > 0n).length;
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
        (market) => market.userDebt > 0n && market.accruedBorrowInterest > 0n,
      ),
    [markets],
  );

  const ensureArc = useCallback(async () => {
    if (!address) {
      throw new Error("Connect your wallet before repaying interest.");
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
          args: [deployments.lendingPool as `0x${string}`, amount],
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
    [address, publicClient, repayAction, contractWrite],
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
  }, [ensureArc, loansWithInterest, refetch, repayInterestForMarket]);

  return (
    <PageTransition>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={<CreditCard />}
          title="Borrow"
          description="Borrow USDC and EURC against deposited collateral from Lendora markets."
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
              value: activeLoanCount.toString(),
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

        <BorrowPositionStrip
          isConnected={isConnected}
          health={numericHealthFactor(accountData?.healthFactor)}
          collateralUsd={accountData?.totalCollateralUSD ?? 0n}
          debtUsd={accountData?.totalDebtUSD ?? 0n}
          availableUsd={accountData?.availableBorrowsUSD ?? 0n}
        />

        <FeaturedBorrowBoard
          markets={markets}
          disabled={isPaused}
          onBorrow={(selected) => setModal({ type: "borrow", market: selected })}
        />

        <AssetFilterBar value={assetFilter} onChange={setAssetFilter} />

        <YourBorrowsTable
          markets={markets}
          onRepay={(selected) => setModal({ type: "repay", market: selected })}
          onRepayInterest={(selected) => void repayInterest(selected)}
          onRepayAllInterest={() => void repayAllInterest()}
          repayingSymbol={repayingSymbol}
          isRepayingAllInterest={isRepayingAllInterest}
          interestRepayHashes={interestRepayHashes}
        />

        <BorrowMarketsTable
          markets={markets}
          filter={assetFilter}
          availableUsd={accountData?.availableBorrowsUSD ?? 0n}
          disabled={isPaused}
          onBorrow={(selected) => setModal({ type: "borrow", market: selected })}
        />

        <PositionSimulator
          accountData={accountData}
          markets={markets}
          isConnected={isConnected}
          isPaused={isPaused}
        />

        <BorrowModal
          open={modal?.type === "borrow"}
          market={modal?.market ?? null}
          onClose={() => setModal(null)}
        />
        <RepayModal
          open={modal?.type === "repay"}
          market={modal?.market ?? null}
          onClose={() => setModal(null)}
        />
      </div>
    </PageTransition>
  );
}
