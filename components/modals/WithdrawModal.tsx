"use client";

import { ArrowDownCircle, Award, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import { GlassButton } from "@/components/ui/GlassButton";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import { useUserBalance, useWithdrawAction } from "@/hooks/useLendingPool";
import {
  useClosePosition,
  useUserPositionNFTs,
} from "@/hooks/usePositionManager";
import { useSafeWithdrawMax } from "@/hooks/useSafeWithdrawMax";
import { useTransactionToast } from "@/hooks/useTransactionToast";
import type { MarketAsset } from "./types";
import { ARCSCAN_TX, errorMessage, parseTokenAmount } from "./modalUtils";
import { ModalShell } from "./ModalShell";

type WithdrawModalProps = {
  open: boolean;
  market: MarketAsset | null;
  onClose: () => void;
};

export function WithdrawModal({ open, market, onClose }: WithdrawModalProps) {
  const [amount, setAmount] = useState("");
  const { address } = useArcLendAccount();
  const aTokenBalance = useUserBalance(
    market?.aToken ?? "0x0000000000000000000000000000000000000000",
  );
  const withdrawAction = useWithdrawAction();
  const closeAction = useClosePosition();
  const positionNFTs = useUserPositionNFTs();
  const safeMax = useSafeWithdrawMax(
    market,
    aTokenBalance.balance,
    open && Boolean(market && address),
  );
  const parsedAmount = useMemo(() => parseTokenAmount(amount), [amount]);
  // Always block amounts above the simulated max — including when max is 0.
  const exceedsSafeMax =
    !safeMax.isLoading && parsedAmount > 0n && parsedAmount > safeMax.maxWithdrawable;
  const noSafeLiquidity =
    !safeMax.isLoading &&
    aTokenBalance.balance > 0n &&
    safeMax.maxWithdrawable === 0n;

  useEffect(() => {
    if (open) {
      setAmount("");
      void safeMax.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when modal opens
  }, [open, market?.address]);

  useTransactionToast({
    isSuccess: withdrawAction.isSuccess,
    error: withdrawAction.error,
    successMessage: `${market?.symbol ?? "Asset"} withdrawn successfully`,
  });

  if (!market) {
    return null;
  }

  const positionReceipt = positionNFTs.positions.find(
    (position) =>
      position.asset.toLowerCase() === market.address.toLowerCase() &&
      position.positionType === 0,
  );
  const canCloseReceipt =
    withdrawAction.isSuccess &&
    aTokenBalance.balance === 0n &&
    Boolean(positionReceipt);
  const fullBalanceLabel = formatUnits(aTokenBalance.balance, 6);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      icon={<ArrowDownCircle className="h-5 w-5" />}
      title={`Withdraw ${market.symbol}`}
    >
      <div className="mt-6 space-y-4">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.05] p-4 text-sm text-white/60">
          <div className="flex justify-between gap-3">
            <span>aToken balance</span>
            <span className="font-mono text-white">
              {fullBalanceLabel} a{market.symbol}
            </span>
          </div>
          <div className="mt-2 flex justify-between gap-3">
            <span>Pool cash (withdrawable liquidity)</span>
            <span className="font-mono text-white">
              {safeMax.isLoading
                ? "…"
                : `${formatUnits(safeMax.poolCash, 6)} ${market.symbol}`}
            </span>
          </div>
          <div className="mt-2 flex justify-between gap-3">
            <span>Safe max</span>
            <span className="font-mono text-[#86efac]">
              {safeMax.isLoading
                ? "…"
                : `${safeMax.formattedMax} ${market.symbol}`}
            </span>
          </div>
        </div>

        {safeMax.reason ? (
          <p className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.06] px-3 py-2 text-xs leading-5 text-amber-100/80">
            {safeMax.reason}
          </p>
        ) : null}

        <div className="flex rounded-2xl border border-white/[0.08] bg-white/[0.05] p-2 backdrop-blur-xl">
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-xl text-white outline-none placeholder:text-white/25"
          />
          <button
            type="button"
            className="rounded-xl bg-white px-3 text-sm font-semibold text-black disabled:opacity-40"
            disabled={safeMax.isLoading || safeMax.maxWithdrawable === 0n}
            onClick={() => setAmount(safeMax.formattedMax)}
          >
            MAX
          </button>
        </div>

        {noSafeLiquidity ? (
          <div className="rounded-xl border border-red-400/20 bg-red-400/[0.07] px-3 py-2 text-sm text-red-200">
            No withdrawable amount right now. Repay debt or wait for pool cash
            to free up.
          </div>
        ) : exceedsSafeMax ? (
          <div className="rounded-xl border border-red-400/20 bg-red-400/[0.07] px-3 py-2 text-sm text-red-200">
            Amount exceeds the safe max. Use MAX or repay debt / wait for pool
            liquidity.
          </div>
        ) : null}

        {withdrawAction.error ? (
          <div className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {errorMessage(withdrawAction.error)}
          </div>
        ) : null}
        {withdrawAction.isSuccess && withdrawAction.txHash ? (
          <a
            className="flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.06] p-3 text-sm text-white"
            href={`${ARCSCAN_TX}${withdrawAction.txHash}`}
            target="_blank"
            rel="noreferrer"
          >
            <CheckCircle2 className="h-4 w-4" />
            View transaction on ArcScan
          </a>
        ) : null}
        {canCloseReceipt ? (
          <div className="rounded-2xl border border-emerald-200/15 bg-emerald-200/[0.055] p-3">
            <p className="text-sm font-medium text-white">
              Close position receipt?
            </p>
            <p className="mt-1 text-xs text-white/40">
              Your supplied balance is zero. Burn the completed Position NFT.
            </p>
            <GlassButton
              type="button"
              variant="ghost"
              className="mt-3 w-full"
              disabled={closeAction.isPending}
              onClick={async () => {
                await closeAction.closePosition(market.address, 0);
                await positionNFTs.refetch();
              }}
            >
              {closeAction.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Award className="h-4 w-4" />
              )}
              Close Receipt
            </GlassButton>
          </div>
        ) : null}
        {closeAction.error ? (
          <div className="rounded-xl border border-red-400/20 bg-red-400/[0.07] px-3 py-2 text-sm text-red-200">
            {errorMessage(closeAction.error)}
          </div>
        ) : null}
        <GlassButton
          type="button"
          variant="primary"
          className="w-full"
          disabled={
            !address ||
            parsedAmount === 0n ||
            exceedsSafeMax ||
            noSafeLiquidity ||
            withdrawAction.isPending ||
            safeMax.isLoading
          }
          onClick={() =>
            withdrawAction.withdraw(market.address, parsedAmount)
          }
        >
          {withdrawAction.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : null}
          Withdraw
        </GlassButton>
      </div>
    </ModalShell>
  );
}
