"use client";

import { useCallback, useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { formatUnits } from "viem";
import { PageTransition } from "@/components/layout/PageTransition";
import { PageHeader } from "@/components/layout/PageHeader";
import { SupplyModal } from "@/components/modals/SupplyModal";
import { WithdrawModal } from "@/components/modals/WithdrawModal";
import type { MarketAsset } from "@/components/modals/types";
import { useLiveMarkets } from "@/hooks/useLiveMarkets";
import {
  AssetFilterBar,
  DepositMarketsTable,
  FeaturedDepositBoard,
  YourDepositsTable,
} from "@/components/markets/ExploreMarkets";
import { formatUsdDisplay, type LendoraAssetFilter } from "@/lib/markets";
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
  const router = useRouter();
  const { markets, isLoading, isError, isPaused } = useLiveMarkets();

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

  const openBorrow = useCallback(() => {
    router.push("/borrow");
  }, [router]);

  const totalDepositsUsd = markets.reduce(
    (sum, market) => sum + market.totalSupplyUsd,
    0n,
  );
  const totalLiquidityUsd = markets.reduce(
    (sum, market) => sum + market.availableLiquidityUsd,
    0n,
  );

  return (
    <PageTransition>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={<Wallet />}
          title="Deposit"
          description="Deposit USDC and EURC to earn borrower-paid yield and enable borrowing on Lendora."
          stats={[
            {
              label: "Total deposits",
              value: formatUsdDisplay(Number(formatUnits(totalDepositsUsd, 8))),
            },
            {
              label: "Available liquidity",
              value: formatUsdDisplay(Number(formatUnits(totalLiquidityUsd, 8))),
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
          onBorrow={openBorrow}
        />

        <AssetFilterBar value={assetFilter} onChange={setAssetFilter} />

        <YourDepositsTable
          markets={markets}
          isLoading={isLoading}
          onWithdraw={openWithdraw}
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
