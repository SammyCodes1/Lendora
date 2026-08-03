"use client";

import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { formatUnits, type Abi } from "viem";
import erc20Abi from "@/constants/abis/ERC20.json";
import deployments from "@/constants/deployments.json";
import { GlassButton } from "@/components/ui/GlassButton";
import { useLiquidateAction } from "@/hooks/useLendingPool";
import { useArcLendContractWrite } from "@/hooks/useArcLendContractWrite";
import { useTransactionToast } from "@/hooks/useTransactionToast";
import type { MarketAsset } from "./types";
import { ARCSCAN_TX, errorMessage, parseTokenAmount } from "./modalUtils";
import { ModalShell } from "./ModalShell";

export type LiquidationTarget = {
  borrower: `0x${string}`;
  collateralUSD: bigint;
  debtUSD: bigint;
  healthFactor: bigint;
  collateralMarket: MarketAsset;
  debtMarket: MarketAsset;
  debtAmount: bigint;
};

type LiquidateModalProps = {
  open: boolean;
  target: LiquidationTarget | null;
  onClose: () => void;
};

function usd8(value: bigint) {
  return `$${Number(formatUnits(value, 8)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function LiquidateModal({ open, target, onClose }: LiquidateModalProps) {
  const [amount, setAmount] = useState("");
  // Default to aToken settlement — works when pool cash is thin / paused.
  const [receiveAToken, setReceiveAToken] = useState(true);
  const approval = useArcLendContractWrite();
  const liquidateAction = useLiquidateAction();
  const parsedAmount = useMemo(() => parseTokenAmount(amount), [amount]);
  const error = approval.error || liquidateAction.error;
  useTransactionToast({
    isSuccess: liquidateAction.isSuccess,
    error,
    successMessage: "Liquidation submitted successfully",
  });

  if (!target) {
    return null;
  }

  const maxDebtToCover = target.debtAmount / 2n;
  const amountUsd = (parsedAmount * target.debtMarket.price) / 1_000_000n;
  const collateralBaseAmount =
    target.collateralMarket.price > 0n
      ? (amountUsd * 1_000_000n) / target.collateralMarket.price
      : 0n;
  const collateralEstimate =
    (collateralBaseAmount * BigInt(10_000 + target.collateralMarket.liquidationBonus)) /
    10_000n;
  const bonusAmount = collateralEstimate - collateralBaseAmount;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      icon={<AlertTriangle className="h-5 w-5" />}
      title={`Liquidate ${target.debtMarket.symbol} Debt`}
    >
      <div className="mt-6 space-y-4">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.05] p-4 text-sm text-white/60">
          <div className="break-all">Borrower <span className="font-mono text-white">{target.borrower}</span></div>
          <div className="mt-2">Collateral <span className="font-mono text-white">{usd8(target.collateralUSD)}</span></div>
          <div className="mt-2">Debt <span className="font-mono text-white">{usd8(target.debtUSD)}</span></div>
        </div>

        <label className="block">
          <span className="text-sm text-white/55">Debt to cover</span>
          <div className="mt-2 flex rounded-2xl border border-white/[0.08] bg-white/[0.05] p-2 backdrop-blur-xl">
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-xl text-white outline-none placeholder:text-white/25"
            />
            <button
              type="button"
              className="rounded-xl bg-white px-3 text-sm font-semibold text-black"
              onClick={() => setAmount(formatUnits(maxDebtToCover, 6))}
            >
              MAX
            </button>
          </div>
        </label>

        <div className="grid gap-2 text-sm text-white/60">
          <div className="flex justify-between">
            <span>Estimated collateral received</span>
            <span className="font-mono text-white">{formatUnits(collateralEstimate, 6)} {target.collateralMarket.symbol}</span>
          </div>
          <div className="flex justify-between">
            <span>Estimated liquidation bonus</span>
            <span className="font-mono text-white">{formatUnits(bonusAmount, 6)} {target.collateralMarket.symbol}</span>
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3 py-3 text-sm text-white/65">
          <input
            type="checkbox"
            className="mt-1"
            checked={receiveAToken}
            onChange={(event) => setReceiveAToken(event.target.checked)}
          />
          <span>
            <span className="block font-medium text-white/85">
              Receive aTokens instead of underlying
            </span>
            <span className="mt-1 block text-xs text-white/40">
              Use when pool cash is low. aToken settlement works during high
              utilization and while the pool is paused; underlying transfer can
              revert with insufficient collateral liquidity.
            </span>
          </span>
        </label>

        {error ? <div className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">{errorMessage(error)}</div> : null}
        {liquidateAction.isSuccess && liquidateAction.txHash ? (
          <a className="flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.06] p-3 text-sm text-white" href={`${ARCSCAN_TX}${liquidateAction.txHash}`} target="_blank">
            <CheckCircle2 className="h-4 w-4" />
            View transaction on ArcScan
          </a>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <GlassButton
            type="button"
            variant="ghost"
            disabled={parsedAmount === 0n || approval.isPending}
            onClick={() => approval.writeContract({ chainId: 5042002, address: target.debtMarket.address, abi: erc20Abi as Abi, functionName: "approve", args: [deployments.lendingPool, parsedAmount] })}
          >
            {approval.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Approve Debt Asset
          </GlassButton>
          <GlassButton
            type="button"
            variant="primary"
            disabled={parsedAmount === 0n || liquidateAction.isPending}
            onClick={() =>
              liquidateAction.liquidate(
                target.collateralMarket.address,
                target.debtMarket.address,
                target.borrower,
                parsedAmount,
                receiveAToken,
              )
            }
          >
            {liquidateAction.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Liquidate
          </GlassButton>
        </div>
      </div>
    </ModalShell>
  );
}
