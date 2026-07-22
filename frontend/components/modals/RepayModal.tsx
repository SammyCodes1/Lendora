"use client";

import { Award, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Abi } from "viem";
import erc20Abi from "@/constants/abis/ERC20.json";
import deployments from "@/constants/deployments.json";
import { GlassButton } from "@/components/ui/GlassButton";
import { useRepayAction, useUserBalance } from "@/hooks/useLendingPool";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import { useArcLendContractWrite } from "@/hooks/useArcLendContractWrite";
import {
  useClosePosition,
  useUserPositionNFTs,
} from "@/hooks/usePositionManager";
import { useTransactionToast } from "@/hooks/useTransactionToast";
import type { MarketAsset } from "./types";
import {
  ARCSCAN_TX,
  errorMessage,
  formatExactTokenAmount,
  parseTokenAmount,
} from "./modalUtils";
import { ModalShell } from "./ModalShell";

type RepayModalProps = {
  open: boolean;
  market: MarketAsset | null;
  onClose: () => void;
};

export function RepayModal({ open, market, onClose }: RepayModalProps) {
  const [amount, setAmount] = useState("");
  const { address } = useArcLendAccount();
  const approveWrite = useArcLendContractWrite();
  const { writeContract: approve, isPending: isApproving, error: approveError } = approveWrite;
  const debtBalance = useUserBalance(market?.debtToken ?? "0x0000000000000000000000000000000000000000");
  const repayAction = useRepayAction();
  const closeAction = useClosePosition();
  const positionNFTs = useUserPositionNFTs();
  const walletBalance = useUserBalance(market?.address ?? "0x0000000000000000000000000000000000000000");
  const parsedAmount = useMemo(() => parseTokenAmount(amount), [amount]);
  const maxRepay =
    debtBalance.balance < walletBalance.balance
      ? debtBalance.balance
      : walletBalance.balance;
  const exceedsMax = parsedAmount > 0n && parsedAmount > maxRepay;

  useEffect(() => {
    if (open) {
      setAmount("");
    }
  }, [market?.address, open]);

  useTransactionToast({
    isSuccess: repayAction.isSuccess,
    error: approveError || repayAction.error,
    successMessage: `${market?.symbol ?? "Asset"} debt repaid successfully`,
  });

  if (!market) {
    return null;
  }
  const positionReceipt = positionNFTs.positions.find(
    (position) =>
      position.asset.toLowerCase() === market.address.toLowerCase() &&
      position.positionType === 1,
  );
  const canCloseReceipt =
    repayAction.isSuccess &&
    debtBalance.balance === 0n &&
    Boolean(positionReceipt);

  return (
    <ModalShell open={open} onClose={onClose} icon={<RotateCcw className="h-5 w-5" />} title={`Repay ${market.symbol}`}>
      <div className="mt-6 space-y-4">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.05] p-4 text-sm text-white/60">
          <div className="flex justify-between gap-3">
            <span>Current debt</span>
            <span className="font-mono text-white">
              {formatExactTokenAmount(debtBalance.balance)} {market.symbol}
            </span>
          </div>
          <div className="mt-2 flex justify-between gap-3">
            <span>Wallet balance</span>
            <span className="font-mono text-white">
              {formatExactTokenAmount(walletBalance.balance)} {market.symbol}
            </span>
          </div>
        </div>
        <div className="flex rounded-2xl border border-white/[0.08] bg-white/[0.05] p-2 backdrop-blur-xl">
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-xl text-white outline-none placeholder:text-white/25" />
          <button
            type="button"
            className="rounded-xl bg-white px-3 text-sm font-semibold text-black disabled:opacity-40"
            disabled={maxRepay === 0n}
            onClick={() => setAmount(formatExactTokenAmount(maxRepay))}
          >
            MAX
          </button>
        </div>
        {exceedsMax ? (
          <div className="rounded-xl border border-red-400/20 bg-red-400/[0.07] px-3 py-2 text-sm text-red-200">
            Amount exceeds debt or wallet balance.
          </div>
        ) : null}
        {approveError || repayAction.error ? <div className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">{errorMessage(approveError || repayAction.error)}</div> : null}
        {repayAction.isSuccess && repayAction.txHash ? <a className="flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.06] p-3 text-sm text-white" href={`${ARCSCAN_TX}${repayAction.txHash}`} target="_blank"><CheckCircle2 className="h-4 w-4" />View transaction on ArcScan</a> : null}
        {canCloseReceipt ? (
          <div className="rounded-2xl border border-emerald-200/15 bg-emerald-200/[0.055] p-3">
            <p className="text-sm font-medium text-white">
              Close position receipt?
            </p>
            <p className="mt-1 text-xs text-white/40">
              Your debt balance is zero. Burn the completed Position NFT.
            </p>
            <GlassButton
              type="button"
              variant="ghost"
              className="mt-3 w-full"
              disabled={closeAction.isPending}
              onClick={async () => {
                await closeAction.closePosition(market.address, 1);
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
        <div className="grid grid-cols-2 gap-3">
          <GlassButton
            type="button"
            variant="ghost"
            disabled={!address || parsedAmount === 0n || isApproving}
            onClick={() => approve({ chainId: 5042002, address: market.address, abi: erc20Abi as Abi, functionName: "approve", args: [deployments.lendingPool, parsedAmount] })}
          >
            {isApproving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Approve
          </GlassButton>
          <GlassButton
            type="button"
            variant="primary"
            disabled={
              !address ||
              parsedAmount === 0n ||
              exceedsMax ||
              repayAction.isPending
            }
            onClick={() => repayAction.repay(market.address, parsedAmount)}
          >
            {repayAction.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Repay
          </GlassButton>
        </div>
      </div>
    </ModalShell>
  );
}
