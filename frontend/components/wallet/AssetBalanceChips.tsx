"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits, type Address } from "viem";
import { useChainId } from "wagmi";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { cn } from "@/lib/utils";

const EXPLORER_API = "https://testnet.arcscan.app/api/v2";

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

// ─── Explorer token balance (for Google / email wallet) ───────────────────────

type ExplorerTokenBalance = {
  token: {
    symbol: string | null;
    decimals: string | null;
  };
  value: string;
};

type TokenChip = { symbol: string; formatted: string };

function useExplorerTokenBalances(address: Address | undefined): {
  tokens: TokenChip[];
  isLoading: boolean;
} {
  const [tokens, setTokens] = useState<TokenChip[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!address) return;

    let cancelled = false;

    function parseBalances(data: unknown): TokenChip[] {
      return (Array.isArray(data) ? data : [])
        .filter((item: ExplorerTokenBalance) => {
          try { return BigInt(item.value ?? "0") > 0n && item.token?.symbol; }
          catch { return false; }
        })
        .map((item: ExplorerTokenBalance) => {
          const decimals = Number(item.token.decimals ?? "18");
          const formatted = Number(
            formatUnits(BigInt(item.value), decimals),
          ).toLocaleString(undefined, { maximumFractionDigits: 4 });
          return { symbol: item.token.symbol!, formatted };
        });
    }

    setIsLoading(true);
    fetch(`${EXPLORER_API}/addresses/${address}/token-balances`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setTokens(parseBalances(data)); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setIsLoading(false); });

    const interval = window.setInterval(() => {
      fetch(`${EXPLORER_API}/addresses/${address}/token-balances`)
        .then((r) => r.json())
        .then((data) => { if (!cancelled) setTokens(parseBalances(data)); })
        .catch(() => {});
    }, 8_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [address]);

  return { tokens, isLoading };
}

// ─── Token icon ───────────────────────────────────────────────────────────────

function TokenIcon({ symbol }: { symbol: string }) {
  const isUsdc = symbol === "USDC";
  const isEurc = symbol === "EURC";
  const label = isUsdc ? "$" : isEurc ? "€" : symbol.slice(0, 2).toUpperCase();
  const colorClass = isUsdc
    ? "border-blue-300/40 bg-blue-400/15 text-blue-200"
    : isEurc
      ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-100"
      : "border-amber-300/40 bg-amber-400/15 text-amber-200";

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

// ─── Chip components ──────────────────────────────────────────────────────────

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
    if (!balance.data) return "0.00";
    return Number(
      formatUnits(balance.data.value, balance.data.decimals),
    ).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }, [balance.data]);

  return (
    <BalanceChip
      symbol={symbol}
      value={!token ? "—" : balance.isLoading ? "…" : formatted}
    />
  );
}

// ─── Public export ────────────────────────────────────────────────────────────

export function AssetBalanceChips({ mobile = false }: { mobile?: boolean }) {
  const { isConnected, address, source } = useArcLendAccount();
  const isEmailWallet = source === "email";

  const { tokens: explorerTokens, isLoading: explorerLoading } =
    useExplorerTokenBalances(isEmailWallet ? address : undefined);

  if (!isConnected) return null;

  if (isEmailWallet) {
    if (explorerLoading && explorerTokens.length === 0) {
      return (
        <span className="inline-flex min-h-10 items-center px-2.5 text-xs text-white/30">
          …
        </span>
      );
    }
    if (explorerTokens.length === 0) return null;
    return (
      <span
        className={cn(
          "flex shrink-0 items-center gap-2",
          mobile && "grid w-full grid-cols-2",
        )}
      >
        {explorerTokens.map((t) => (
          <BalanceChip key={t.symbol} symbol={t.symbol} value={t.formatted} />
        ))}

      </span>
    );
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
