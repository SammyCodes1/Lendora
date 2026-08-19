"use client";

import { useMemo } from "react";
import { erc20Abi, formatUnits, type Address } from "viem";
import { useChainId, useReadContracts } from "wagmi";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import { cn } from "@/lib/utils";

type TokenConfig = {
  symbol: string;
  decimals: number;
  alwaysShow: boolean;
};

// Known tokens allowed to display on the navbar
const KNOWN_TOKENS: Record<number, Record<Address, TokenConfig>> = {
  // Arc Testnet (5042002)
  5042002: {
    "0x3600000000000000000000000000000000000000": { symbol: "USDC", decimals: 6, alwaysShow: true },
    "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a": { symbol: "EURC", decimals: 6, alwaysShow: true },
    "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF": { symbol: "cirBTC", decimals: 8, alwaysShow: false },
    "0x175CdB1D338945f0D851A741ccF787D343E57952": { symbol: "USDT", decimals: 18, alwaysShow: false },
  },
  // Sepolia (11155111)
  11155111: {
    "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238": { symbol: "USDC", decimals: 6, alwaysShow: true },
    "0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4": { symbol: "EURC", decimals: 6, alwaysShow: true },
  },
  // Base Sepolia (84532)
  84532: {
    "0x036CbD53842c5426634e7929541eC2318f3dCF7e": { symbol: "USDC", decimals: 6, alwaysShow: true },
    "0x808456652fdb597867f38412077A9182bf77359F": { symbol: "EURC", decimals: 6, alwaysShow: true },
  },
  // Polygon Amoy (80002)
  80002: {
    "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582": { symbol: "USDC", decimals: 6, alwaysShow: true },
  },
};

type DisplayChip = {
  key: string;
  symbol: string;
  formatted: string;
};

// ─── Token icon styling ───────────────────────────────────────────────────────

function TokenIcon({ symbol }: { symbol: string }) {
  const sym = symbol.toUpperCase();
  const isUsdc = sym === "USDC";
  const isEurc = sym === "EURC";
  const isBtc = sym.includes("BTC");
  const isUsdt = sym === "USDT";

  const label = isUsdc ? "$" : isEurc ? "€" : isBtc ? "₿" : isUsdt ? "₮" : symbol.slice(0, 2);
  const colorClass = isUsdc
    ? "border-blue-300/40 bg-blue-400/15 text-blue-200"
    : isEurc
      ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-100"
      : isBtc
        ? "border-amber-300/40 bg-amber-400/15 text-amber-200"
        : isUsdt
          ? "border-emerald-300/40 bg-emerald-400/15 text-emerald-200"
          : "border-purple-300/40 bg-purple-400/15 text-purple-200";

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold",
        colorClass,
      )}
    >
      {label}
    </span>
  );
}

function BalanceChip({ symbol, value }: { symbol: string; value: string }) {
  return (
    <span className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-xs text-white/60">
      <TokenIcon symbol={symbol} />
      <span className="leading-tight">
        <span className="block font-mono text-xs text-white">{value}</span>
        <span className="block text-[9px] font-semibold text-white/35">{symbol}</span>
      </span>
    </span>
  );
}

// ─── Main exported component ─────────────────────────────────────────────────

export function AssetBalanceChips({ mobile = false }: { mobile?: boolean }) {
  const { isConnected, address, source } = useArcLendAccount();
  const connectedChainId = useChainId();
  const chainId = source === "email" ? 5042002 : (connectedChainId || 5042002);

  const tokensForChain = useMemo(() => {
    return KNOWN_TOKENS[chainId] ?? KNOWN_TOKENS[5042002];
  }, [chainId]);

  const tokenEntries = useMemo(() => {
    return Object.entries(tokensForChain) as [Address, TokenConfig][];
  }, [tokensForChain]);

  // On-chain reads for allowed tokens
  const readContracts = useMemo(() => {
    if (!address) return [];
    return tokenEntries.map(([tokenAddress]) => ({
      chainId,
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [address] as const,
    }));
  }, [address, chainId, tokenEntries]);

  const { data: readData, isLoading: isReadLoading } = useReadContracts({
    contracts: readContracts,
    query: {
      enabled: Boolean(address && readContracts.length > 0),
      refetchInterval: 4_000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: false,
    },
  });

  // Filter chips to show strictly USDC, EURC, cirBTC, and USDT
  const chips = useMemo<DisplayChip[]>(() => {
    if (!address) return [];

    const result: DisplayChip[] = [];

    tokenEntries.forEach(([tokenAddress, config], index) => {
      const readResult = readData?.[index];
      const isSuccess = readResult?.status === "success" && typeof readResult.result === "bigint";
      const val = isSuccess ? (readResult.result as bigint) : 0n;

      if (config.alwaysShow || (isSuccess && val > 0n)) {
        let formatted = "0.00";
        if (isReadLoading && !isSuccess) {
          formatted = "…";
        } else if (isSuccess) {
          formatted = Number(formatUnits(val, config.decimals)).toLocaleString(undefined, {
            maximumFractionDigits: config.decimals === 8 ? 6 : 2,
          });
        }

        result.push({
          key: tokenAddress,
          symbol: config.symbol,
          formatted,
        });
      }
    });

    return result;
  }, [address, tokenEntries, readData, isReadLoading]);

  if (!isConnected) return null;

  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-2",
        mobile && "grid w-full grid-cols-2",
      )}
    >
      {chips.map((chip) => (
        <BalanceChip key={chip.key} symbol={chip.symbol} value={chip.formatted} />
      ))}
    </span>
  );
}
