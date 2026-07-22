"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownUp,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  ExternalLink,
  Loader2,
  Route,
  Settings2,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";
import {
  erc20Abi,
  formatUnits,
  parseUnits,
  type Address,
  type Hash,
} from "viem";
import {
  useChainId,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { TokenMark } from "@/components/ui/TokenMark";
import { useDismissibleDropdown } from "@/hooks/useDismissibleDropdown";
import {
  ARC_DEX_ROUTERS,
  ARC_DEX_TOKENS,
  CURVE_ABI,
  isStableSwapPair,
  synthraV3FeesForPair,
  V2_ROUTER_ABI,
  V3_QUOTER_ABI,
  V3_ROUTER_ABI,
} from "@/lib/arcDex";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type TokenSymbol = keyof typeof ARC_DEX_TOKENS;
type RouteKey = "curve" | "xylo" | "v3";
type Quote = {
  key: RouteKey;
  label: string;
  output: bigint;
  router: Address;
  fee?: number;
};
type SwapProgressStep = {
  key: "switch" | "approve" | "swap";
  label: string;
  state: "waiting" | "active" | "success" | "error";
  finalityMs?: number;
  txHash?: Hash;
  errorMessage?: string;
};

const routeMeta: Record<RouteKey, { label: string; detail: string }> = {
  curve: { label: "Curve", detail: "Stable pool" },
  xylo: { label: "Xylo", detail: "V2 router" },
  v3: { label: "Synthra V3", detail: "Concentrated liquidity" },
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
        className="flex min-w-28 items-center justify-between gap-2 rounded-xl border border-white/15 bg-[#090b0d] py-1.5 pl-1.5 pr-2 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.07)] transition hover:border-white/30 hover:bg-[#0d1012]"
      >
        <span className="flex items-center gap-2">
          <TokenMark symbol={value} />
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
            "absolute right-0 z-50 min-w-48 rounded-xl border border-white/20 bg-[#050607] p-1.5 shadow-[0_24px_70px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.08)]",
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
                  "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm transition",
                  selected
                    ? "bg-white/[0.15] text-white"
                    : "text-white/85 hover:bg-white/[0.09] hover:text-white",
                )}
              >
                <span className="flex items-center gap-2.5">
                  <TokenMark
                    symbol={symbol}
                    className="h-6 w-6"
                    iconClassName="h-4 w-4"
                  />
                  <span>
                    <span className="block font-semibold">{symbol}</span>
                    <span className="block text-[10px] font-normal text-white/55">
                      {symbol === "USDC"
                        ? "USD Coin"
                        : symbol === "EURC"
                          ? "Euro Coin"
                          : symbol === "USDT"
                            ? "Arc Testnet USDT"
                            : "Circle Wrapped Bitcoin"}
                    </span>
                  </span>
                </span>
                {selected ? <Check className="h-4 w-4 text-white/75" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function formatBalance(value: bigint, decimals: number) {
  return Number(formatUnits(value, decimals)).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });
}

export function SwapWidget() {
  const { address, isConnected, source } = useArcLendAccount();
  const connectorReady = isConnected && source === "wallet";
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: 5042002 });
  const { writeContractAsync } = useWriteContract();
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
  const bestRoute = quotes.reduce<Quote | null>(
    (best, quote) => (!best || quote.output > best.output ? quote : best),
    null,
  );
  const activeRoute =
    quotes.find((quote) => quote.key === selectedRoute) ?? bestRoute;
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
    if (!publicClient || parsedAmount <= 0n || fromSymbol === toSymbol) {
      setQuotes([]);
      return;
    }

    setQuoteLoading(true);
    setError(null);
    const path = [fromToken.address, toToken.address] as Address[];
    const stablePair = isStableSwapPair(fromSymbol, toSymbol);
    const v3Fees = synthraV3FeesForPair(fromSymbol, toSymbol);

    try {
      const [[curve, xylo], v3Quotes] = await Promise.all([
        Promise.allSettled([
          stablePair
            ? publicClient.readContract({
                address: ARC_DEX_ROUTERS.curve,
                abi: CURVE_ABI,
                functionName: "get_dy",
                args: [
                  fromSymbol === "USDC" ? 0n : 1n,
                  fromSymbol === "USDC" ? 1n : 0n,
                  parsedAmount,
                ],
              })
            : Promise.resolve(null),
          stablePair
            ? publicClient.readContract({
                address: ARC_DEX_ROUTERS.xylo,
                abi: V2_ROUTER_ABI,
                functionName: "getAmountsOut",
                args: [parsedAmount, path],
              })
            : Promise.resolve(null),
        ]),
        Promise.allSettled(
          v3Fees.map((fee) =>
            publicClient.simulateContract({
              address: ARC_DEX_ROUTERS.v3Quoter,
              abi: V3_QUOTER_ABI,
              functionName: "quoteExactInputSingle",
              args: [
                {
                  tokenIn: fromToken.address,
                  tokenOut: toToken.address,
                  amountIn: parsedAmount,
                  fee,
                  sqrtPriceLimitX96: 0n,
                },
              ],
            }),
          ),
        ),
      ]);

      const nextQuotes: Quote[] = [];
      if (
        curve.status === "fulfilled" &&
        curve.value !== null &&
        curve.value > 0n
      ) {
        nextQuotes.push({
          key: "curve",
          label: routeMeta.curve.label,
          output: curve.value,
          router: ARC_DEX_ROUTERS.curve,
        });
      }
      if (
        xylo.status === "fulfilled" &&
        xylo.value !== null &&
        xylo.value.length > 1 &&
        xylo.value[1] > 0n
      ) {
        nextQuotes.push({
          key: "xylo",
          label: routeMeta.xylo.label,
          output: xylo.value[1],
          router: ARC_DEX_ROUTERS.xylo,
        });
      }
      const bestV3 = v3Quotes.reduce<Quote | null>(
        (best, quote, index) =>
          quote.status === "fulfilled" &&
          quote.value.result[0] > 0n &&
          (!best || quote.value.result[0] > best.output)
            ? {
                key: "v3",
                label: routeMeta.v3.label,
                output: quote.value.result[0],
                router: ARC_DEX_ROUTERS.v3,
                fee: v3Fees[index],
              }
            : best,
        null,
      );
      if (bestV3) {
        nextQuotes.push(bestV3);
      }
      setQuotes(nextQuotes);
      setSelectedRoute((current) =>
        current && nextQuotes.some((quote) => quote.key === current)
          ? current
          : null,
      );
    } catch (caught) {
      setError(errorMessage(caught));
      setQuotes([]);
    } finally {
      setQuoteLoading(false);
    }
  }, [
    fromSymbol,
    fromToken.address,
    parsedAmount,
    publicClient,
    toSymbol,
    toToken.address,
  ]);

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
    if (
      !address ||
      !publicClient ||
      !activeRoute ||
      parsedAmount <= 0n ||
      exceedsBalance
    ) {
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
      { key: "approve", label: `Approve ${fromSymbol}`, state: "waiting" },
      {
        key: "swap",
        label: `Swap ${fromSymbol} for ${toSymbol}`,
        state: "waiting",
      },
    ]);
    const startedAt = performance.now();
    const quotedOutput = formatUnits(activeRoute.output, toToken.decimals);
    setReceivedAmount(quotedOutput);

    try {
      if (chainId !== 5042002) {
        const switchStartedAt = performance.now();
        await switchChainAsync({ chainId: 5042002 });
        updateProgress("switch", {
          state: "success",
          finalityMs: Math.max(
            0,
            Math.round(performance.now() - switchStartedAt),
          ),
        });
      }

      const allowance = await publicClient.readContract({
        address: fromToken.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, activeRoute.router],
      });
      if (allowance < parsedAmount) {
        const approvalStartedAt = performance.now();
        updateProgress("approve", { state: "active" });
        const approvalHash = await writeContractAsync({
          chainId: 5042002,
          address: fromToken.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [activeRoute.router, parsedAmount],
        });
        updateProgress("approve", { txHash: approvalHash });
        await publicClient.waitForTransactionReceipt({ hash: approvalHash });
        updateProgress("approve", {
          state: "success",
          finalityMs: Math.max(
            0,
            Math.round(performance.now() - approvalStartedAt),
          ),
        });
      } else {
        updateProgress("approve", { state: "success", finalityMs: 0 });
      }

      const minimumOutput =
        (activeRoute.output * BigInt(10_000 - slippageBps)) / 10_000n;
      let hash: Hash;
      const swapStartedAt = performance.now();
      updateProgress("swap", { state: "active" });

      if (activeRoute.key === "curve") {
        const [i, j] =
          fromSymbol === "USDC" ? ([0n, 1n] as const) : ([1n, 0n] as const);
        hash = await writeContractAsync({
          chainId: 5042002,
          address: ARC_DEX_ROUTERS.curve,
          abi: CURVE_ABI,
          functionName: "exchange",
          args: [i, j, parsedAmount, minimumOutput],
        });
      } else if (activeRoute.key === "xylo") {
        hash = await writeContractAsync({
          chainId: 5042002,
          address: ARC_DEX_ROUTERS.xylo,
          abi: V2_ROUTER_ABI,
          functionName: "swapExactTokensForTokens",
          args: [
            parsedAmount,
            minimumOutput,
            [fromToken.address, toToken.address],
            address,
            BigInt(Math.floor(Date.now() / 1000) + 20 * 60),
          ],
        });
      } else {
        if (activeRoute.fee === undefined) {
          throw new Error("Synthra V3 fee tier is unavailable");
        }
        hash = await writeContractAsync({
          chainId: 5042002,
          address: ARC_DEX_ROUTERS.v3,
          abi: V3_ROUTER_ABI,
          functionName: "exactInputSingle",
          args: [
            {
              tokenIn: fromToken.address,
              tokenOut: toToken.address,
              fee: activeRoute.fee,
              recipient: address,
              amountIn: parsedAmount,
              amountOutMinimum: minimumOutput,
              sqrtPriceLimitX96: 0n,
            },
          ],
        });
      }

      setTxHash(hash);
      updateProgress("swap", { txHash: hash });
      await publicClient.waitForTransactionReceipt({ hash });
      updateProgress("swap", {
        state: "success",
        finalityMs: Math.max(0, Math.round(performance.now() - swapStartedAt)),
      });
      setFinalityMs(Math.max(0, Math.round(performance.now() - startedAt)));
      showToast("success", `Swapped ${fromSymbol} to ${toSymbol} on Arc`);
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
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/50">
            <ShieldCheck className="h-4 w-4 text-white/60" />
            Arc DEX routes only
          </div>
        </div>
      </div>

      <div className="space-y-5 p-5">
        <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.055)]">
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
              placeholder="0.00"
              className="min-w-0 flex-1 bg-transparent font-mono text-2xl text-white outline-none placeholder:text-white/20"
            />
            <button
              type="button"
              onClick={() => setAmount(available)}
              className="rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] font-semibold text-white/65 transition hover:bg-white/[0.1] hover:text-white"
            >
              MAX
            </button>
            <TokenSelector value={fromSymbol} onChange={selectFromToken} />
          </div>
        </div>

        <div className="flex justify-center">
          <motion.button
            type="button"
            aria-label="Switch swap tokens"
            whileHover={{ scale: 1.05, rotate: 180 }}
            whileTap={{ scale: 0.92 }}
            onClick={() => {
              const previousFrom = fromSymbol;
              setFromSymbol(toSymbol);
              setToSymbol(previousFrom);
              resetPairState();
            }}
            className="rounded-full border border-white/15 bg-black p-3 text-white/65 shadow-[0_12px_30px_rgba(0,0,0,0.5)] transition hover:border-white/25 hover:text-white"
          >
            <ArrowDownUp className="h-4 w-4" />
          </motion.button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.055)]">
          <div className="flex items-center justify-between text-xs text-white/45">
            <span>You receive</span>
            <span>
              Balance: {toBalance.isLoading ? "…" : formattedToBalance}{" "}
              {toSymbol}
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="font-mono text-2xl text-white">
              {quoteLoading
                ? "…"
                : activeRoute
                  ? Number(
                      formatUnits(activeRoute.output, toToken.decimals),
                    ).toLocaleString(undefined, { maximumFractionDigits: 6 })
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
              Router path
            </p>
            <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] p-1">
              <span className="flex items-center gap-1.5 px-2 text-[10px] font-medium text-white/40">
                <Settings2 className="h-3.5 w-3.5" />
                Slippage
              </span>
              <div className="flex gap-1" aria-label="Slippage tolerance">
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

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {(Object.keys(routeMeta) as RouteKey[]).map((key) => {
              const quote = quotes.find((item) => item.key === key);
              const selected = activeRoute?.key === key;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!quote}
                  onClick={() => setSelectedRoute(key)}
                  className={cn(
                    "rounded-xl border p-3 text-left transition",
                    selected
                      ? "border-white/25 bg-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                      : "border-white/[0.08] bg-white/[0.025]",
                    !quote && "cursor-not-allowed opacity-35",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <Route className="h-4 w-4 text-white/55" />
                    {bestRoute?.key === key ? (
                      <span className="text-[9px] font-semibold uppercase text-white/65">
                        Best
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm font-medium text-white">
                    {routeMeta[key].label}
                  </p>
                  <p className="mt-1 text-[10px] text-white/35">
                    {routeMeta[key].detail}
                  </p>
                  <p className="mt-3 truncate font-mono text-xs text-white/70">
                    {quote
                      ? `${formatUnits(quote.output, toToken.decimals)} ${toSymbol}`
                      : "No route"}
                  </p>
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
          className="w-full"
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
            <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-8 sm:px-6 sm:py-12">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <p className="text-xs font-semibold uppercase text-white/40">
                    Arc onchain swap
                  </p>
                  <h2 className="mt-3 text-3xl font-semibold text-white">
                    Swap in progress
                  </h2>
                  <p className="mt-2 text-sm text-white/45">
                    {fromSymbol} → {toSymbol} via {activeRoute?.label ?? "Arc DEX"}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Close swap progress"
                  disabled={swapLoading}
                  onClick={() => setProgressOpen(false)}
                  className="rounded-lg border border-white/10 bg-white/[0.045] p-2.5 text-white/55 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.045] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                <div className="flex items-center justify-between gap-4 border-b border-white/[0.08] pb-5">
                  <span className="text-sm text-white/45">Swap amount</span>
                  <span className="font-mono text-xl text-white">
                    {amount} {fromSymbol}
                  </span>
                </div>

                <div className="mt-4 space-y-2">
                  {progress.map((step, index) => (
                    <div
                      key={step.key}
                      className="flex items-center gap-4 rounded-xl border border-white/[0.06] bg-black/15 px-4 py-4"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.045]">
                        {step.state === "success" ? (
                          <CheckCircle2 className="h-5 w-5 text-white/75" />
                        ) : step.state === "error" ? (
                          <XCircle className="h-5 w-5 text-red-300" />
                        ) : step.state === "active" ? (
                          <Loader2 className="h-5 w-5 animate-spin text-white/65" />
                        ) : (
                          <CircleDashed className="h-5 w-5 text-white/20" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "text-sm font-medium",
                            step.state === "waiting"
                              ? "text-white/35"
                              : "text-white",
                          )}
                        >
                          <span className="mr-2 text-white/25">{index + 1}.</span>
                          {step.label}
                        </p>
                        {step.errorMessage ? (
                          <p className="mt-1 text-xs text-red-300">
                            {step.errorMessage}
                          </p>
                        ) : null}
                      </div>
                      <span className="shrink-0 font-mono text-xs text-white/45">
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
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-white/45 transition hover:bg-white/[0.06] hover:text-white"
                        >
                          ArcScan
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
            className="fixed inset-0 z-[150] flex items-center justify-center bg-[#07090b]/90 p-4 backdrop-blur-xl"
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
              className="w-full max-w-lg rounded-2xl border border-white/12 bg-black/85 p-6 shadow-[0_30px_100px_rgba(0,0,0,0.72)] backdrop-blur-3xl"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/[0.06]">
                    <CheckCircle2 className="h-6 w-6 text-white/75" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase text-white/40">
                      Swap complete
                    </p>
                    <h2
                      id="swap-complete-title"
                      className="mt-1 text-xl font-semibold text-white"
                    >
                      {fromSymbol} swapped for {toSymbol}
                    </h2>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Close swap completion"
                  onClick={() => setCompletionOpen(false)}
                  className="rounded-lg border border-white/10 bg-white/[0.045] p-2 text-white/50 transition hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <dl className="mt-6 divide-y divide-white/[0.07] rounded-xl border border-white/[0.08] bg-white/[0.035] px-4">
                <div className="flex items-center justify-between gap-4 py-4">
                  <dt className="text-sm text-white/45">Amount sent</dt>
                  <dd className="font-mono text-sm text-white">
                    {amount} {fromSymbol}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-4">
                  <dt className="text-sm text-white/45">Quoted output</dt>
                  <dd className="font-mono text-sm text-white">
                    {receivedAmount} {toSymbol}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-4">
                  <dt className="text-sm text-white/45">Finality time</dt>
                  <dd className="font-mono text-sm text-white">
                    {finalityMs?.toLocaleString() ?? "—"} ms
                  </dd>
                </div>
                <div className="py-4">
                  <dt className="text-sm text-white/45">Transaction hash</dt>
                  <dd className="mt-2 break-all font-mono text-xs leading-5 text-white/75">
                    {txHash}
                  </dd>
                </div>
              </dl>

              <div className="mt-5 flex gap-3">
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
                  className="flex-1"
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
