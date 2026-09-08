"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import { formatUnits, type Abi, type Hash } from "viem";
import {
  useChainId,
  usePublicClient,
  useSwitchChain,
} from "wagmi";
import lendingPoolAbi from "@/constants/abis/LendingPool.json";
import deployments from "@/constants/deployments.json";
import { PageTransition } from "@/components/layout/PageTransition";
import { PageHeader } from "@/components/layout/PageHeader";
import { SupplyModal } from "@/components/modals/SupplyModal";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import { WithdrawModal } from "@/components/modals/WithdrawModal";
import type { MarketAsset } from "@/components/modals/types";
import { errorMessage } from "@/components/modals/modalUtils";
import { useWithdrawAction } from "@/hooks/useLendingPool";
import { useLiveMarkets } from "@/hooks/useLiveMarkets";
import { showToast } from "@/lib/toast";
import {
  AssetFilterBar,
  DepositMarketsTable,
  FeaturedDepositBoard,
  YourDepositsTable,
} from "@/components/markets/ExploreMarkets";
import type { LendoraAssetFilter } from "@/lib/markets";
import {
  clearPendingSupply,
  readPendingSupply,
  writePendingSupply,
} from "@/lib/supplyFlow";

type ModalState = {
  type: "supply" | "withdraw";
  market: MarketAsset;
} | null;

export default function LendPage() {
  const [modal, setModal] = useState<ModalState>(null);
  const [assetFilter, setAssetFilter] = useState<LendoraAssetFilter>("ALL");
  const { address, source } = useArcLendAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: 5042002 });
  const withdrawAction = useWithdrawAction();
  const { markets, isLoading, isError, isPaused, refetch } = useLiveMarkets();

  useEffect(() => {
    const pending = readPendingSupply();
    if (!pending || modal) return;

    const market = markets.find(
      (candidate) =>
        candidate.address.toLowerCase() === pending.marketAddress.toLowerCase(),
    );
    if (market) {
      setModal({ type: "supply", market });
    }
  }, [markets, modal]);

  const clearModal = useCallback(() => {
    setModal(null);
    clearPendingSupply();
  }, []);

  const openSupply = useCallback((market: MarketAsset) => {
    writePendingSupply(market.address, "");
    setModal({ type: "supply", market });
  }, []);

  const openWithdraw = useCallback((market: MarketAsset) => {
    clearPendingSupply();
    setModal({ type: "withdraw", market });
  }, []);

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
        (market) => market.userSupply > 0n && market.accruedSupply > 0n,
      ),
    [markets],
  );

  const totalDepositsUsd = markets.reduce(
    (sum, market) => sum + market.totalSupplyUsd,
    0n,
  );
  const totalLiquidityUsd = markets.reduce(
    (sum, market) => sum + market.availableLiquidityUsd,
    0n,
  );

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
        let amount =
          market.accruedSupply < market.poolCash
            ? market.accruedSupply
            : market.poolCash;
        if (amount <= 0n) {
          throw new Error(
            "No free pool cash to withdraw yield right now. Wait for repayments.",
          );
        }
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
          errorMessage(error) || `Could not withdraw ${market.symbol} yield`,
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
          title="Deposit"
          description="Deposit USDC and EURC to earn yield and enable borrowing on Lendora."
          stats={[
            {
              label: "Total deposits",
              value: `$${Number(formatUnits(totalDepositsUsd, 8)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
            },
            {
              label: "Available liquidity",
              value: `$${Number(formatUnits(totalLiquidityUsd, 8)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
              tone: "positive",
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
            Protocol is paused. New deposits are disabled; withdraw and repay may
            still work depending on pool policy.
          </div>
        ) : null}

        <FeaturedDepositBoard
          markets={markets}
          disabled={isPaused}
          onSupply={openSupply}
        />

        <AssetFilterBar value={assetFilter} onChange={setAssetFilter} />

        <YourDepositsTable
          markets={markets}
          isLoading={isLoading}
          onWithdraw={openWithdraw}
          onClaim={(market) => void claimMarket(market)}
          onClaimAll={() => void claimAll()}
          claimingSymbol={claimingSymbol}
          isClaimingAll={isClaimingAll}
          claimHashes={claimHashes}
        />

        <DepositMarketsTable
          markets={markets}
          filter={assetFilter}
          disabled={isPaused}
          onSupply={openSupply}
        />

        <SupplyModal
          open={modal?.type === "supply"}
          market={modal?.market ?? null}
          onClose={clearModal}
        />
        <WithdrawModal
          open={modal?.type === "withdraw"}
          market={modal?.market ?? null}
          onClose={clearModal}
        />
      </div>
    </PageTransition>
  );
}
