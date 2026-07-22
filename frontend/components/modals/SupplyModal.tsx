"use client";

import { ArrowUpCircle, Award, CheckCircle2, CircleDollarSign, Euro, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Abi } from "viem";
import erc20Abi from "@/constants/abis/ERC20.json";
import { GlassButton } from "@/components/ui/GlassButton";
import { StatBadge } from "@/components/ui/StatBadge";
import { useUserBalance } from "@/hooks/useLendingPool";
import { resultHash, useArcLendContractWrite } from "@/hooks/useArcLendContractWrite";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import {
  POSITION_MANAGER_ADDRESS,
  useSupplyWithReceipt,
  useUserPositionNFTs,
} from "@/hooks/usePositionManager";
import deployments from "@/constants/deployments.json";
import { useTransactionToast } from "@/hooks/useTransactionToast";
import { TokenInput } from "@/components/ui/TokenInput";
import { formatRemainingCap, formatReserveCap } from "@/lib/markets";
import type { MarketAsset } from "./types";
import {
  ARCSCAN_TX,
  errorMessage,
  formatExactTokenAmount,
  parseTokenAmount,
} from "./modalUtils";
import { ModalShell } from "./ModalShell";

type SupplyModalProps = {
  open: boolean;
  market: MarketAsset | null;
  onClose: () => void;
};

const erc20WriteAbi = erc20Abi as Abi;

export function SupplyModal({ open, market, onClose }: SupplyModalProps) {
  const [amount, setAmount] = useState("");
  const { address } = useArcLendAccount();
  const approveAction = useArcLendContractWrite();
  const supplyAction = useSupplyWithReceipt();
  const {
    positions: positionNFTs,
    refetch: refetchPositionNFTs,
  } = useUserPositionNFTs();
  const balance = useUserBalance(market?.address ?? "0x0000000000000000000000000000000000000000");
  const parsedAmount = useMemo(() => parseTokenAmount(amount), [amount]);
  const error = approveAction.error || supplyAction.error;
  useTransactionToast({
    isSuccess: supplyAction.isSuccess,
    error,
    successMessage: `${market?.symbol ?? "Asset"} supplied successfully`,
  });
  useEffect(() => {
    if (open) {
      setAmount("");
    }
  }, [market?.address, open]);

  useEffect(() => {
    if (supplyAction.isSuccess) {
      void refetchPositionNFTs();
    }
  }, [refetchPositionNFTs, supplyAction.isSuccess]);

  if (!market) {
    return null;
  }

  const txHash = supplyAction.txHash;
  const exceedsSupplyCap =
    market.isSupplyCapped &&
    parsedAmount > 0n &&
    parsedAmount > market.remainingSupplyCap;
  const positionReceipt = positionNFTs.find(
    (position) =>
      position.asset.toLowerCase() === market.address.toLowerCase() &&
      position.positionType === 0,
  );

  return (
    <ModalShell open={open} onClose={onClose} icon={<ArrowUpCircle className="h-5 w-5" />} title={`Supply ${market.symbol}`}>
      <div className="mt-6 space-y-4">
        <TokenInput
          value={amount}
          onChange={setAmount}
          tokenName={market.name}
          tokenSymbol={market.symbol}
          balance={`${balance.formatted} ${market.symbol}`}
          icon={market.symbol === "USDC" ? CircleDollarSign : Euro}
          error={Boolean(error) || exceedsSupplyCap}
          onMax={() => setAmount(formatExactTokenAmount(balance.balance))}
        />

        <div className="grid gap-2 text-sm text-white/60">
          <div className="flex justify-between"><span>Projected aToken</span><span className="font-mono text-white">{amount || "0.00"} a{market.symbol}</span></div>
          <div className="flex justify-between"><span>Wallet balance</span><span className="font-mono text-white">{balance.formatted} {market.symbol}</span></div>
          <div className="flex justify-between">
            <span>Supply cap</span>
            <span className="font-mono text-white">
              {formatReserveCap(market.supplyCap, market.isSupplyCapped, { compact: true })}
              {market.isSupplyCapped ? ` ${market.symbol}` : ""}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Cap remaining</span>
            <span className="font-mono text-white">
              {formatRemainingCap(
                market.remainingSupplyCap,
                market.isSupplyCapped,
                market.symbol,
              )}
            </span>
          </div>
          <StatBadge label="Supply APY" value={market.supplyApy} />
          <p className="rounded-2xl border border-emerald-200/15 bg-emerald-200/[0.06] px-3 py-2 text-xs leading-5 text-emerald-100/75">
            Supplying updates the reserve index. Any pending interest becomes part of your supplied aToken balance.
          </p>
        </div>

        {exceedsSupplyCap ? (
          <div className="rounded-xl border border-red-400/20 bg-red-400/[0.07] px-3 py-2 text-sm text-red-200">
            Amount exceeds the remaining supply cap for this pool.
          </div>
        ) : null}

        {error ? <div className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">{errorMessage(error)}</div> : null}

        {supplyAction.isSuccess && txHash ? (
          <a className="flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.06] p-3 text-sm text-white" href={`${ARCSCAN_TX}${txHash}`} target="_blank">
            <CheckCircle2 className="h-4 w-4" />
            View transaction on ArcScan
          </a>
        ) : null}
        {supplyAction.isSuccess && positionReceipt ? (
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

        <div className="grid grid-cols-2 gap-3">
          <GlassButton
            type="button"
            variant="ghost"
            disabled={!address || parsedAmount === 0n || approveAction.isPending}
            onClick={async () => {
              await approveAction.writeContractAsync({
                chainId: 5042002,
                address: market.address,
                abi: erc20WriteAbi,
                functionName: "approve",
                args: [POSITION_MANAGER_ADDRESS, parsedAmount],
              }).then(resultHash);
            }}
          >
            {approveAction.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Approve
          </GlassButton>
          <GlassButton
            type="button"
            variant="primary"
            disabled={
              !address ||
              parsedAmount === 0n ||
              exceedsSupplyCap ||
              supplyAction.isPending
            }
            onClick={() => supplyAction.supply(market.address, parsedAmount)}
          >
            {supplyAction.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Supply & Mint Receipt
          </GlassButton>
        </div>
      </div>
    </ModalShell>
  );
}
