"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { formatUnits, parseUnits, type Hash } from "viem";
import { useChainId } from "wagmi";
import {
  ArrowDownUp,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  ExternalLink,
  Loader2,
  Route,
  Settings2,
  X,
  XCircle,
} from "lucide-react";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { TokenMark } from "@/components/ui/TokenMark";
import { useDismissibleDropdown } from "@/hooks/useDismissibleDropdown";
import { useSwap, type RouteKey, type SwapRouteQuote } from "@/hooks/useSwap";
import { ARC_DEX_TOKENS } from "@/lib/arcDex";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type TokenSymbol = keyof typeof ARC_DEX_TOKENS;
type Quote = SwapRouteQuote;
type SwapProgressStep = {
  key: "switch" | "approve" | "swap";
  label: string;
  state: "waiting" | "active" | "success" | "error";
  finalityMs?: number;
  txHash?: Hash;
  errorMessage?: string;
};

const ROUTE_METAS: Record<RouteKey, { label: string; detail: string }> = {
  tower: {
    label: "Tower Exchange",
    detail: "Official Tower router. Quotes and routes via TowerSwapExecutor.",
  },
  arclend: {
    label: "Lendora SwapPool",
    detail: "Native USDC/EURC constant-product pool on Arc.",
  },
  curve: { label: "Curve", detail: "Stable pool for pegged assets on Arc." },
  xylo: { label: "Xylo", detail: "V2 AMM router on Arc." },
  v3: { label: "Synthra V3", detail: "Concentrated liquidity pools on Arc." },
};

const tokenSymbols = Object.keys(ARC_DEX_TOKENS) as TokenSymbol[];
const slippageOptions = [25, 50, 100] as const;
const initialSwapProgress: SwapProgressStep[] = [
  { key: "switch", label: "Switch to Arc Testnet", state: "waiting" },
  { key: "approve", label: "Approve input token", state: "waiting" },
  { key: "swap", label: "Execute and settle swap", state: "waiting" },
];

function arcScanTransaction(hash: Hash) {
  return `https://testnet.arcscan.app/tx/${hash}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Swap failed";
}

function formatBalance(value: bigint, decimals: number) {
  return Number(formatUnits(value, decimals)).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });
}

function TokenSelector({
  value,
  onChange,
  menuPosition = "bottom",
}: {
  value: TokenSymbol;
  onChange: (symbol: TokenSymbol) => void;
  menuPosition?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const containerRef = useDismissibleDropdown(open, close);

  return (
    <div
      ref={containerRef}
      className={cn("relative shrink-0", open && "z-[70]")}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex min-w-28 items-center justify-between gap-2 overflow-hidden rounded-xl border border-white/15 bg-[#090b0d] py-1.5 pl-1.5 pr-2 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.07)] transition hover:border-white/30 hover:bg-[#0d1012]"
      >
        <span className="flex min-w-0 items-center gap-2">
          <TokenMark symbol={value} className="h-7 w-7" iconClassName="h-4 w-4" />
          {value}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-white/60 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Select token"
          className={cn(
            "absolute right-0 z-50 min-w-48 overflow-hidden rounded-xl border border-white/20 bg-[#050607] p-1.5 shadow-[0_24px_70px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.08)]",
            menuPosition === "top" ? "bottom-full mb-2" : "mt-2",
          )}
        >
          {tokenSymbols.map((symbol) => {
            const selected = symbol === value;

            return (
              <button
                key={symbol}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(symbol);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition",
                  selected
                    ? "bg-white/15 text-white"
                    : "text-white/70 hover:bg-white/10 hover:text-white",
                )}
              >
                <span className="flex items-center gap-2.5">
                  <TokenMark symbol={symbol} className="h-6 w-6" iconClassName="h-3.5 w-3.5" />
                  <span>{symbol}</span>
                </span>
                {selected ? (
                  <span className="text-xs text-white/60">Selected</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function SwapWidget() {
  const { address, isConnected, source } = useArcLendAccount();
  const connectorReady = isConnected && source === "wallet";
  const chainId = useChainId();
  const { quoteRoutes, swap } = useSwap();
  const [fromSymbol, setFromSymbol] = useState<TokenSymbol>("USDC");
  const [toSymbol, setToSymbol] = useState<TokenSymbol>("EURC");
  const [amount, setAmount] = useState("");
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<RouteKey | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [swapLoading, setSwapLoading] = useState(false);
  const [slippageBps, setSlippageBps] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hash | null>(null);
  const [progressOpen, setProgressOpen] = useState(false);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [progress, setProgress] =
    useState<SwapProgressStep[]>(initialSwapProgress);
  const [finalityMs, setFinalityMs] = useState<number | null>(null);
  const [receivedAmount, setReceivedAmount] = useState("0.00");

  const fromToken = ARC_DEX_TOKENS[fromSymbol];
  const toToken = ARC_DEX_TOKENS[toSymbol];
  const fromBalance = useTokenBalance({
    address,
    token: fromToken.address,
    chainId: 5042002,
    enabled: Boolean(address),
    refetchInterval: 4_000,
  });
  const toBalance = useTokenBalance({
    address,
    token: toToken.address,
    chainId: 5042002,
    enabled: Boolean(address),
    refetchInterval: 4_000,
  });
  const available = fromBalance.data
    ? formatUnits(fromBalance.data.value, fromBalance.data.decimals)
    : "0";
  const formattedFromBalance = fromBalance.data
    ? formatBalance(fromBalance.data.value, fromBalance.data.decimals)
    : "0";
  const formattedToBalance = toBalance.data
    ? formatBalance(toBalance.data.value, toBalance.data.decimals)
    : "0";
  const parsedAmount = useMemo(() => {
    try {
      return amount && Number(amount) > 0
        ? parseUnits(amount, fromToken.decimals)
        : 0n;
    } catch {
      return 0n;
    }
  }, [amount, fromToken.decimals]);

  const bestRoute = useMemo(() => {
    if (quotes.length === 0) return null;
    return quotes.reduce((best, quote) => (!best || quote.output > best.output ? quote : best), quotes[0]);
  }, [quotes]);

  const activeRoute = useMemo(() => {
    if (selectedRoute) {
      const found = quotes.find((quote) => quote.key === selectedRoute);
      if (found) return found;
    }
    return bestRoute;
  }, [selectedRoute, quotes, bestRoute]);

  const exceedsBalance =
    parsedAmount > 0n && fromBalance.data
      ? parsedAmount > fromBalance.data.value
      : false;

  const updateProgress = (
    key: SwapProgressStep["key"],
    update: Partial<SwapProgressStep>,
  ) => {
    setProgress((steps) =>
      steps.map((step) => (step.key === key ? { ...step, ...update } : step)),
    );
  };

  const resetPairState = () => {
    setAmount("");
    setQuotes([]);
    setSelectedRoute(null);
    setTxHash(null);
    setError(null);
    setCompletionOpen(false);
    setFinalityMs(null);
    setProgress(initialSwapProgress);
  };

  const selectFromToken = (symbol: TokenSymbol) => {
    if (symbol === fromSymbol) {
      return;
    }
    if (symbol === toSymbol) {
      setToSymbol(fromSymbol);
    }
    setFromSymbol(symbol);
    resetPairState();
  };

  const selectToToken = (symbol: TokenSymbol) => {
    if (symbol === toSymbol) {
      return;
    }
    if (symbol === fromSymbol) {
      setFromSymbol(toSymbol);
    }
    setToSymbol(symbol);
    resetPairState();
  };

  const fetchQuotes = useCallback(async () => {
    if (parsedAmount <= 0n || fromSymbol === toSymbol) {
      setQuotes([]);
      setSelectedRoute(null);
      return;
    }

    setQuoteLoading(true);
    setError(null);
    try {
      const allQuotes = await quoteRoutes(
        fromSymbol,
        toSymbol,
        amount,
        slippageBps,
      );
      setQuotes(allQuotes);
    } catch (caught) {
      setError(errorMessage(caught));
      setQuotes([]);
      setSelectedRoute(null);
    } finally {
      setQuoteLoading(false);
    }
  }, [amount, fromSymbol, parsedAmount, quoteRoutes, slippageBps, toSymbol]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchQuotes();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [fetchQuotes]);

  useEffect(() => {
    if (!progressOpen && !completionOpen) {
      return;
    }

    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [completionOpen, progressOpen]);

  const executeSwap = async () => {
    if (!address || !activeRoute || parsedAmount <= 0n || exceedsBalance) {
      return;
    }

    setSwapLoading(true);
    setError(null);
    setTxHash(null);
    setCompletionOpen(false);
    setProgressOpen(true);
    setFinalityMs(null);
    setProgress([
      {
        key: "switch",
        label: "Switch to Arc Testnet",
        state: chainId === 5042002 ? "success" : "active",
        finalityMs: chainId === 5042002 ? 0 : undefined,
      },
      { key: "approve", label: `Approve ${fromSymbol} for ${activeRoute.label}`, state: "waiting" },
      {
        key: "swap",
        label: `Swap ${fromSymbol} for ${toSymbol} via ${activeRoute.label}`,
        state: "waiting",
      },
    ]);
    const startedAt = performance.now();
    const quotedOutput = formatUnits(activeRoute.output, toToken.decimals);
    setReceivedAmount(quotedOutput);

    try {
      const result = await swap(
        fromSymbol,
        toSymbol,
        amount,
        slippageBps,
        activeRoute,
        (step, update) => {
          updateProgress(step, {
            state: update.state,
            txHash: update.hash,
            finalityMs: update.finalityMs,
          });
        },
      );
      setTxHash(result.hash);
      setReceivedAmount(formatUnits(result.quote.output, toToken.decimals));
      setFinalityMs(Math.max(0, Math.round(performance.now() - startedAt)));
      showToast("success", `Swapped ${fromSymbol} to ${toSymbol} via ${activeRoute.label}`);
      await Promise.all([fromBalance.refetch(), toBalance.refetch()]);
      await fetchQuotes();
      setProgressOpen(false);
      setCompletionOpen(true);
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      setProgress((steps) => {
        const activeIndex = steps.findIndex((step) => step.state === "active");
        return steps.map((step, index) =>
          index === activeIndex
            ? { ...step, state: "error", errorMessage: message }
            : step,
        );
      });
      showToast("error", message);
    } finally {
      setSwapLoading(false);
    }
  };

  return (
    <>
    <GlassCard depth="foreground" className="overflow-visible">
      <div className="border-b border-white/[0.08] p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase text-white/35">
              Arc Testnet
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">
              Swap assets
            </h2>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-4 sm:p-5">
        <div className="rounded-2xl border border-white/10 bg-[#0a0c0e]/90 p-4 sm:p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.055)]">
          <div className="flex items-center justify-between text-xs text-white/45">
            <span>You pay</span>
            <span>
              Balance: {fromBalance.isLoading ? "…" : formattedFromBalance}{" "}
              {fromSymbol}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <input
              aria-label="Swap amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setTxHash(null);
              }}
              placeholder="0.0"
              className="w-full bg-transparent font-mono text-xl sm:text-2xl font-semibold text-white placeholder:text-white/20 focus:outline-none"
            />
            <TokenSelector
              value={fromSymbol}
              onChange={selectFromToken}
              menuPosition="bottom"
            />
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-white/40">
            <span>Available: {available}</span>
            <button
              type="button"
              disabled={!fromBalance.data || fromBalance.data.value <= 0n}
              onClick={() => {
                if (fromBalance.data) {
                  setAmount(
                    formatUnits(fromBalance.data.value, fromBalance.data.decimals),
                  );
                }
              }}
              className="font-medium text-white/60 transition hover:text-white disabled:opacity-40"
            >
              MAX
            </button>
          </div>
        </div>

        <div className="relative flex items-center justify-center">
          <button
            type="button"
            aria-label="Switch swap direction"
            onClick={() => {
              setFromSymbol(toSymbol);
              setToSymbol(fromSymbol);
              resetPairState();
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/80 text-white/70 shadow-[0_10px_25px_rgba(0,0,0,0.5)] transition hover:scale-105 active:scale-95 hover:border-white/30 hover:text-white"
          >
            <ArrowDownUp className="h-4 w-4" />
          </button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0a0c0e]/90 p-4 sm:p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.055)]">
          <div className="flex items-center justify-between text-xs text-white/45">
            <span>You receive</span>
            <span>
              Balance: {toBalance.isLoading ? "…" : formattedToBalance}{" "}
              {toSymbol}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span className="w-full truncate font-mono text-xl sm:text-2xl font-semibold text-white">
              {quoteLoading
                ? "…"
                : activeRoute
                  ? formatUnits(activeRoute.output, toToken.decimals)
                  : "0.00"}
            </span>
            <TokenSelector
              value={toSymbol}
              onChange={selectToToken}
              menuPosition="top"
            />
          </div>
        </div>

        <div>
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
              Router paths
            </p>
            <div className="flex items-center justify-between sm:justify-start gap-1.5 sm:gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] p-1 overflow-x-auto">
              <span className="flex items-center gap-1.5 px-2 text-[10px] font-medium text-white/40 shrink-0">
                <Settings2 className="h-3.5 w-3.5" />
                Slippage
              </span>
              <div className="flex gap-1 shrink-0" aria-label="Slippage tolerance">
                {slippageOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={slippageBps === option}
                    onClick={() => setSlippageBps(option)}
                    className={cn(
                      "rounded-lg px-2.5 py-1.5 font-mono text-[10px] transition",
                      slippageBps === option
                        ? "bg-white text-black shadow-[0_0_18px_rgba(255,255,255,0.12)]"
                        : "text-white/45 hover:bg-white/[0.06] hover:text-white",
                    )}
                  >
                    {(option / 100).toFixed(2)}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3 grid gap-2.5 sm:gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {(Object.keys(ROUTE_METAS) as RouteKey[]).map((key) => {
              const quote = quotes.find((item) => item.key === key);
              const selected = activeRoute?.key === key;
              const isBest = bestRoute?.key === key && Boolean(quote);

              return (
                <button
                  key={key}
                  type="button"
                  disabled={!quote}
                  onClick={() => setSelectedRoute(key)}
                  className={cn(
                    "rounded-xl border p-3 sm:p-3.5 text-left transition flex flex-col justify-between active:scale-[0.99]",
                    selected
                      ? "border-white/30 bg-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ring-1 ring-white/20"
                      : "border-white/[0.08] bg-white/[0.025] hover:border-white/15 hover:bg-white/[0.04]",
                    !quote && "cursor-not-allowed opacity-40 hover:border-white/[0.08] hover:bg-white/[0.025]",
                  )}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <Route className="h-4 w-4 shrink-0 text-white/55" />
                        <span className="sm:hidden font-medium text-xs text-white truncate">
                          {ROUTE_METAS[key].label}
                        </span>
                      </div>
                      {isBest ? (
                        <span className="shrink-0 rounded bg-emerald-400/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-emerald-300">
                          Best
                        </span>
                      ) : key === "tower" ? (
                        <span className="shrink-0 rounded bg-sky-400/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-sky-300">
                          Tower
                        </span>
                      ) : selected ? (
                        <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white/70">
                          Selected
                        </span>
                      ) : null}
                    </div>
                    <p className="hidden sm:block mt-2.5 text-sm font-medium text-white">
                      {ROUTE_METAS[key].label}
                    </p>
                    <p className="mt-1 text-[10px] leading-4 text-white/35 line-clamp-2">
                      {ROUTE_METAS[key].detail}
                    </p>
                  </div>
                  <div className="mt-2.5 sm:mt-3 border-t border-white/[0.06] pt-2">
                    <p className="truncate font-mono text-xs font-medium text-white/90">
                      {quote
                        ? `${formatUnits(quote.output, toToken.decimals)} ${toSymbol}`
                        : quoteLoading
                          ? "Quoting…"
                          : "No route"}
                    </p>
                    {quote ? (
                      <p className="mt-0.5 font-mono text-[9px] text-white/40 truncate">
                        min {formatUnits(quote.minOut, toToken.decimals)}
                        {quote.feeBps ? ` · ${quote.feeBps / 100}% fee` : ""}
                      </p>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {exceedsBalance ? (
          <p className="text-sm text-red-300">Amount exceeds your balance.</p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        ) : null}
        {txHash ? (
          <a
            href={`https://testnet.arcscan.app/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.05] p-3 text-sm text-white/75"
          >
            <span className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Swap confirmed
            </span>
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : null}

        <GlassButton
          type="button"
          variant="primary"
          className="w-full min-h-[48px] text-sm sm:text-base font-semibold"
          disabled={
            !connectorReady ||
            parsedAmount <= 0n ||
            !activeRoute ||
            exceedsBalance ||
            quoteLoading ||
            swapLoading
          }
          onClick={() => void executeSwap()}
        >
          {swapLoading || quoteLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowDownUp className="h-4 w-4" />
          )}
          {!isConnected
            ? "Connect wallet"
            : !connectorReady
              ? "Use browser wallet"
            : chainId !== 5042002
              ? "Switch to Arc and swap"
              : swapLoading
                ? "Confirming swap"
                : `Swap via ${activeRoute?.label ?? "best route"}`}
        </GlassButton>
      </div>
    </GlassCard>

      <AnimatePresence>
        {progressOpen ? (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Swap progress"
            className="fixed inset-0 z-[140] overflow-y-auto bg-[#07090b]/96 backdrop-blur-2xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-6 sm:px-6 sm:py-12">
              <div className="flex items-start justify-between gap-4 sm:gap-6">
                <div>
                  <p className="text-xs font-semibold uppercase text-white/40">
                    Arc onchain swap
                  </p>
                  <h2 className="mt-2 text-2xl sm:text-3xl font-semibold text-white">
                    Swap in progress
                  </h2>
                  <p className="mt-1.5 text-xs sm:text-sm text-white/45">
                    {fromSymbol} → {toSymbol} via {activeRoute?.label ?? "Arc DEX"}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Close swap progress"
                  disabled={swapLoading}
                  onClick={() => setProgressOpen(false)}
                  className="rounded-lg border border-white/10 bg-white/[0.045] p-2 sm:p-2.5 text-white/55 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <X className="h-4 w-4 sm:h-5 sm:w-5" />
                </button>
              </div>

              <div className="mt-6 sm:mt-10 rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                <div className="flex items-center justify-between text-xs text-white/40">
                  <span>Execution stages</span>
                  <span>
                    {progress.filter((step) => step.state === "success").length}{" "}
                    of {progress.length} complete
                  </span>
                </div>

                <div className="mt-4 space-y-2">
                  {progress.map((step, index) => (
                    <div
                      key={step.key}
                      className="flex items-center gap-3 sm:gap-4 rounded-xl border border-white/[0.06] bg-black/15 p-3 sm:px-4 sm:py-4"
                    >
                      <span className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.045]">
                        {step.state === "success" ? (
                          <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5 text-white/75" />
                        ) : step.state === "error" ? (
                          <XCircle className="h-4 w-4 sm:h-5 sm:w-5 text-red-300" />
                        ) : step.state === "active" ? (
                          <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin text-white/65" />
                        ) : (
                          <CircleDashed className="h-4 w-4 sm:h-5 sm:w-5 text-white/20" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "text-xs sm:text-sm font-medium",
                            step.state === "waiting"
                              ? "text-white/35"
                              : "text-white",
                          )}
                        >
                          <span className="mr-1.5 sm:mr-2 text-white/25">{index + 1}.</span>
                          {step.label}
                        </p>
                        {step.errorMessage ? (
                          <p className="mt-1 text-xs text-red-300">
                            {step.errorMessage}
                          </p>
                        ) : null}
                      </div>
                      <span className="shrink-0 font-mono text-[11px] sm:text-xs text-white/45">
                        {step.finalityMs !== undefined
                          ? `${step.finalityMs.toLocaleString()} ms`
                          : step.state === "active"
                            ? "Timing…"
                            : "— ms"}
                      </span>
                      {step.txHash ? (
                        <a
                          href={arcScanTransaction(step.txHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-white/45 transition hover:bg-white/[0.06] hover:text-white shrink-0"
                        >
                          <span className="hidden sm:inline">ArcScan</span>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 text-center">
                {error ? (
                  <>
                    <p className="text-sm text-red-300">
                      The swap stopped before completion.
                    </p>
                    <GlassButton
                      type="button"
                      variant="ghost"
                      className="mt-4"
                      onClick={() => setProgressOpen(false)}
                    >
                      Return to swap
                    </GlassButton>
                  </>
                ) : (
                  <p className="text-xs text-white/35">
                    Keep this page open while Arc confirms the transactions.
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {completionOpen && txHash ? (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="swap-complete-title"
            className="fixed inset-0 z-[150] flex items-center justify-center bg-[#07090b]/90 p-3 sm:p-4 backdrop-blur-xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={() => setCompletionOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              onMouseDown={(event) => event.stopPropagation()}
              className="w-full max-w-lg rounded-2xl border border-white/12 bg-black/85 p-4 sm:p-6 shadow-[0_30px_100px_rgba(0,0,0,0.72)] backdrop-blur-3xl"
            >
              <div className="flex items-start justify-between gap-3 sm:gap-4">
                <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                  <span className="flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.06]">
                    <CheckCircle2 className="h-5 w-5 sm:h-6 sm:w-6 text-white/75" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase text-white/40">
                      Swap complete
                    </p>
                    <h2
                      id="swap-complete-title"
                      className="mt-0.5 truncate text-lg sm:text-xl font-semibold text-white"
                    >
                      {fromSymbol} swapped for {toSymbol}
                    </h2>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Close swap completion"
                  onClick={() => setCompletionOpen(false)}
                  className="rounded-lg border border-white/10 bg-white/[0.045] p-2 text-white/50 transition hover:text-white shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <dl className="mt-5 sm:mt-6 divide-y divide-white/[0.07] rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 sm:px-4">
                <div className="flex items-center justify-between gap-4 py-3 sm:py-4">
                  <dt className="text-xs sm:text-sm text-white/45">Amount sent</dt>
                  <dd className="font-mono text-xs sm:text-sm text-white">
                    {amount} {fromSymbol}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-3 sm:py-4">
                  <dt className="text-xs sm:text-sm text-white/45">Quoted output</dt>
                  <dd className="font-mono text-xs sm:text-sm text-white">
                    {receivedAmount} {toSymbol}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-3 sm:py-4">
                  <dt className="text-xs sm:text-sm text-white/45">Finality time</dt>
                  <dd className="font-mono text-xs sm:text-sm text-white">
                    {finalityMs?.toLocaleString() ?? "—"} ms
                  </dd>
                </div>
                <div className="py-3 sm:py-4">
                  <dt className="text-xs sm:text-sm text-white/45">Transaction hash</dt>
                  <dd className="mt-1.5 break-all font-mono text-[11px] sm:text-xs leading-5 text-white/75">
                    {txHash}
                  </dd>
                </div>
              </dl>

              <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2.5 sm:gap-3">
                <a
                  href={arcScanTransaction(txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-4 text-sm font-medium text-white transition hover:bg-white/[0.1]"
                >
                  View transaction
                  <ExternalLink className="h-4 w-4" />
                </a>
                <GlassButton
                  type="button"
                  variant="primary"
                  className="flex-1 min-h-11"
                  onClick={() => setCompletionOpen(false)}
                >
                  Done
                </GlassButton>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
