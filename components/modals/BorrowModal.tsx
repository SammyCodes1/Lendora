"use client";

import {
  ArrowDownCircle,
  Award,
  CheckCircle2,
  CircleDollarSign,
  Euro,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatUnits, type Abi, type Address } from "viem";
import {
  usePublicClient,
  useReadContract,
} from "wagmi";
import { GlassButton } from "@/components/ui/GlassButton";
import { StatBadge } from "@/components/ui/StatBadge";
import { TokenInput } from "@/components/ui/TokenInput";
import { useUserAccountData } from "@/hooks/useLendingPool";
import {
  POSITION_MANAGER_ADDRESS,
  useBorrowWithReceipt,
  useUserPositionNFTs,
} from "@/hooks/usePositionManager";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import {
  resultHash,
  useArcLendContractWrite,
} from "@/hooks/useArcLendContractWrite";
import deployments from "@/constants/deployments.json";
import lendingPoolAbi from "@/constants/abis/LendingPool.json";
import { useLiveMarkets } from "@/hooks/useLiveMarkets";
import { useTransactionToast } from "@/hooks/useTransactionToast";
import { formatRemainingCap, formatReserveCap } from "@/lib/markets";
import type { MarketAsset } from "./types";
import { ARCSCAN_TX, errorMessage, parseTokenAmount } from "./modalUtils";
import { ModalShell } from "./ModalShell";

type BorrowModalProps = {
  open: boolean;
  market: MarketAsset | null;
  onClose: () => void;
};

export function BorrowModal({ open, market, onClose }: BorrowModalProps) {
  const [amount, setAmount] = useState("");
  const [isDelegating, setIsDelegating] = useState(false);
  const { address } = useArcLendAccount();
  const publicClient = usePublicClient({ chainId: 5042002 });
  const { accountData } = useUserAccountData(address);
  const { markets } = useLiveMarkets();
  const borrowAction = useBorrowWithReceipt();
  const delegateWrite = useArcLendContractWrite();
  const {
    positions: positionNFTs,
    refetch: refetchPositionNFTs,
  } = useUserPositionNFTs();
  const parsedAmount = useMemo(() => parseTokenAmount(amount), [amount]);
  const lendingPoolAddress = deployments.lendingPool as Address;
  const delegateApproval = useReadContract({
    chainId: 5042002,
    address: lendingPoolAddress,
    abi: lendingPoolAbi as Abi,
    functionName: "borrowDelegates",
    args: address ? [address, POSITION_MANAGER_ADDRESS] : undefined,
    query: {
      enabled: open && Boolean(address),
    },
  });

  useEffect(() => {
    if (open) {
      setAmount("");
    }
  }, [market?.address, open]);

  useTransactionToast({
    isSuccess: borrowAction.isSuccess,
    error: borrowAction.error,
    successMessage: `${market?.symbol ?? "Asset"} borrowed successfully`,
  });
  useEffect(() => {
    if (borrowAction.isSuccess) {
      void refetchPositionNFTs();
    }
  }, [borrowAction.isSuccess, refetchPositionNFTs]);

  if (!market) {
    return null;
  }

  const availableUsd = accountData?.availableBorrowsUSD ?? 0n;
  const price = market.price || 1n;
  const availableByCollateral = (availableUsd * 1_000_000n) / price;
  let maxBorrow =
    availableByCollateral < market.availableLiquidity
      ? availableByCollateral
      : market.availableLiquidity;
  if (
    market.isBorrowCapped &&
    market.remainingBorrowCap < maxBorrow
  ) {
    maxBorrow = market.remainingBorrowCap;
  }
  const currentDebtUsd = accountData?.totalDebtUSD ?? 0n;
  const liquidationCapacityUsd = markets.reduce(
    (sum, item) =>
      sum +
      (((item.userSupply * item.price) / 1_000_000n) *
        BigInt(item.liquidationThreshold)) /
        10_000n,
    0n,
  );
  const requestedDebtUsd = (parsedAmount * price) / 1_000_000n;
  const projectedDebtUsd = currentDebtUsd + requestedDebtUsd;
  const projectedHealth = projectedDebtUsd > 0n
    ? Number((liquidationCapacityUsd * 1_000_000n) / projectedDebtUsd) / 1_000_000
    : 10;
  const healthWidth = `${Math.min(100, projectedHealth * 40)}%`;
  const exceedsBorrowLimit = parsedAmount > 0n && parsedAmount > maxBorrow;
  // Match on-chain gate (HF >= 1.0); still warn under 1.10 for safety buffer.
  const unsafeHealthFactor = parsedAmount > 0n && projectedHealth < 1.0;
  const lowHealthFactor =
    parsedAmount > 0n && projectedHealth >= 1.0 && projectedHealth < 1.1;
  const canBorrow =
    Boolean(address) &&
    parsedAmount > 0n &&
    !exceedsBorrowLimit &&
    !unsafeHealthFactor &&
    maxBorrow > 0n &&
    !isDelegating &&
    !delegateWrite.isPending &&
    !borrowAction.isPending;
  const positionReceipt = positionNFTs.find(
    (position) =>
      position.asset.toLowerCase() === market.address.toLowerCase() &&
      position.positionType === 1,
  );

  const submitBorrow = async () => {
    if (!canBorrow || !address) return;
    if (!delegateApproval.data) {
      setIsDelegating(true);
      try {
        const result = await delegateWrite.writeContractAsync({
          chainId: 5042002,
          address: lendingPoolAddress,
          abi: lendingPoolAbi as Abi,
          functionName: "setBorrowDelegate",
          args: [POSITION_MANAGER_ADDRESS, true],
        });
        const hash = resultHash(result);
        if (hash) await publicClient?.waitForTransactionReceipt({ hash });
        await delegateApproval.refetch();
      } finally {
        setIsDelegating(false);
      }
    }
    await borrowAction.borrow(market.address, parsedAmount);
  };

  return (
    <ModalShell open={open} onClose={onClose} icon={<ArrowDownCircle className="h-5 w-5" />} title={`Borrow ${market.symbol}`}>
      <div className="mt-6 space-y-4">
        <TokenInput
          value={amount}
          onChange={setAmount}
          tokenName={market.name}
          tokenSymbol={market.symbol}
          balance={`${formatUnits(maxBorrow, 6)} ${market.symbol} available`}
          icon={market.symbol === "USDC" ? CircleDollarSign : Euro}
          error={exceedsBorrowLimit || unsafeHealthFactor}
          onMax={() => setAmount(formatUnits(maxBorrow, 6))}
        />

        <div className="space-y-3">
          <StatBadge label="Borrow APR" value={market.borrowApr} />
          <div className="flex justify-between text-sm text-white/60">
            <span>Maximum available</span>
            <span className="font-mono text-white">
              {formatUnits(maxBorrow, 6)} {market.symbol}
            </span>
          </div>
          <div className="flex justify-between text-sm text-white/60">
            <span>Borrow cap</span>
            <span className="font-mono text-white">
              {formatReserveCap(market.borrowCap, market.isBorrowCapped, {
                compact: true,
              })}
              {market.isBorrowCapped ? ` ${market.symbol}` : ""}
            </span>
          </div>
          <div className="flex justify-between text-sm text-white/60">
            <span>Cap remaining</span>
            <span className="font-mono text-white">
              {formatRemainingCap(
                market.remainingBorrowCap,
                market.isBorrowCapped,
                market.symbol,
              )}
            </span>
          </div>
          <div className="flex justify-between text-sm text-white/60"><span>Projected Health Factor</span><span className="font-mono text-white">{projectedHealth.toFixed(2)}</span></div>
          <div className="h-2 rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-white/70 shadow-[0_0_20px_rgba(255,255,255,0.22)]" style={{ width: healthWidth }} />
          </div>
        </div>

        {maxBorrow === 0n ? (
          <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.07] px-3 py-2 text-sm text-amber-100">
            Nothing available to borrow — check collateral, pool cash, and borrow
            cap.
          </div>
        ) : exceedsBorrowLimit ? (
          <div className="rounded-xl border border-red-400/20 bg-red-400/[0.07] px-3 py-2 text-sm text-red-200">
            Amount exceeds your available borrowing capacity (collateral, pool
            cash, or borrow cap).
          </div>
        ) : unsafeHealthFactor ? (
          <div className="rounded-xl border border-red-400/20 bg-red-400/[0.07] px-3 py-2 text-sm text-red-200">
            This amount would reduce your health factor below 1.0.
          </div>
        ) : lowHealthFactor ? (
          <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.07] px-3 py-2 text-sm text-amber-100">
            Warning: projected health factor is below 1.10. Leave a safety buffer
            against liquidation.
          </div>
        ) : null}

        {market.symbol === "EURC" ? (
          <p className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[11px] leading-4 text-white/40">
            EURC uses a lower LTV ({(market.ltv / 100).toFixed(0)}%) than USDC to
            reduce cross-stable depeg risk when both assets are used as collateral.
          </p>
        ) : null}

        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3 py-3 text-xs leading-5 text-white/45">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Position Manager borrow delegate:{" "}
              <span className="font-mono text-white/75">
                {delegateApproval.data ? "approved" : "not approved"}
              </span>
            </span>
            {delegateApproval.data ? (
              <button
                type="button"
                className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/70 transition hover:bg-white/[0.06]"
                disabled={delegateWrite.isPending}
                onClick={async () => {
                  const result = await delegateWrite.writeContractAsync({
                    chainId: 5042002,
                    address: lendingPoolAddress,
                    abi: lendingPoolAbi as Abi,
                    functionName: "setBorrowDelegate",
                    args: [POSITION_MANAGER_ADDRESS, false],
                  });
                  const hash = resultHash(result);
                  if (hash) await publicClient?.waitForTransactionReceipt({ hash });
                  await delegateApproval.refetch();
                }}
              >
                Revoke
              </button>
            ) : (
              <span className="text-white/35">
                Will be requested on first borrow with receipt
              </span>
            )}
          </div>
          <p className="mt-2 text-[11px] text-white/35">
            An approved delegate can open debt on your behalf within your
            collateral limits until you revoke it.
          </p>
        </div>

        {borrowAction.error || delegateWrite.error ? <div className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">{errorMessage(borrowAction.error ?? delegateWrite.error)}</div> : null}
        {borrowAction.isSuccess && borrowAction.txHash ? <a className="flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.06] p-3 text-sm text-white" href={`${ARCSCAN_TX}${borrowAction.txHash}`} target="_blank"><CheckCircle2 className="h-4 w-4" />View transaction on ArcScan</a> : null}
        {borrowAction.isSuccess && positionReceipt ? (
          <a
            className="flex items-center gap-2 rounded-2xl border border-emerald-200/15 bg-emerald-200/[0.06] p-3 text-sm text-emerald-100"
            href={`https://testnet.arcscan.app/token/${deployments.PositionNFT}?a=${positionReceipt.tokenId}`}
            target="_blank"
            rel="noreferrer"
          >
            <Award className="h-4 w-4" />
            Position NFT #{positionReceipt.tokenId.toString()} minted
            <ExternalLink className="ml-auto h-4 w-4" />
          </a>
        ) : null}

        <GlassButton type="button" variant="primary" className="w-full" disabled={!canBorrow} onClick={() => void submitBorrow()}>
          {borrowAction.isPending || isDelegating || delegateWrite.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Borrow & Mint Receipt
        </GlassButton>
      </div>
    </ModalShell>
  );
}
