"use client";

import { useMemo } from "react";
import { formatUnits, type Address } from "viem";
import { useChainId } from "wagmi";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { cn } from "@/lib/utils";

const usdcByChain: Record<number, Address> = {
  5042002: "0x3600000000000000000000000000000000000000",
  11155111: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  80002: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
};

const eurcByChain: Record<number, Address> = {
  5042002: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  11155111: "0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4",
  84532: "0x808456652fdb597867f38412077A9182bf77359F",
};

function TokenIcon({ symbol }: { symbol: "USDC" | "EURC" }) {
  const isUsdc = symbol === "USDC";

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold",
        isUsdc
          ? "border-blue-300/40 bg-blue-400/15 text-blue-200"
          : "border-cyan-300/40 bg-cyan-300/15 text-cyan-100",
      )}
    >
      {isUsdc ? "$" : "€"}
    </span>
  );
}

function NetworkTokenBalanceChip({
  symbol,
  contracts,
}: {
  symbol: "USDC" | "EURC";
  contracts: Record<number, Address>;
}) {
  const { address, source } = useArcLendAccount();
  const connectedChainId = useChainId();
  const chainId = source === "email" ? 5042002 : connectedChainId;
  const token = contracts[chainId];
  const balance = useTokenBalance({
    address,
    token,
    chainId,
    enabled: Boolean(address && token),
    refetchInterval: 4_000,
  });
  const formatted = useMemo(() => {
    if (!balance.data) {
      return "0.00";
    }

    return Number(
      formatUnits(balance.data.value, balance.data.decimals),
    ).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }, [balance.data]);

  return (
    <span className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-xs text-white/60">
      <TokenIcon symbol={symbol} />
      <span className="leading-tight">
        <span className="block font-mono text-xs text-white">
          {!token ? "—" : balance.isLoading ? "…" : formatted}
        </span>
        <span className="block text-[9px] font-semibold text-white/35">
          {symbol}
        </span>
      </span>
    </span>
  );
}

export function AssetBalanceChips({ mobile = false }: { mobile?: boolean }) {
  const { isConnected } = useArcLendAccount();

  if (!isConnected) {
    return null;
  }

  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-2",
        mobile && "grid w-full grid-cols-2",
      )}
    >
      <NetworkTokenBalanceChip symbol="USDC" contracts={usdcByChain} />
      <NetworkTokenBalanceChip symbol="EURC" contracts={eurcByChain} />
    </span>
  );
}
