"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  CircleDollarSign,
  ExternalLink,
  Loader2,
  RotateCcw,
  Sparkles,
  Trophy,
  User,
} from "lucide-react";
import {
  erc20Abi,
  formatUnits,
  parseUnits,
  type Hash,
} from "viem";
import {
  useChainId,
  usePublicClient,
  useSwitchChain,
} from "wagmi";
import {
  ARCANA_MARKETS_ADDRESS,
  ARC_USDC_ADDRESS,
  arcanaMarketsAbi,
} from "@/constants/arcana";
import {
  type ArcanaMarket,
  useArcanaMarkets,
} from "@/hooks/useArcanaMarkets";
import { GlassButton } from "@/components/ui/GlassButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { showToast } from "@/lib/toast";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import {
  resultHash,
  useArcLendContractWrite,
} from "@/hooks/useArcLendContractWrite";

type MarketAction =
  | { type: "predict"; market: ArcanaMarket; side: "YES" | "NO" }
  | { type: "claim"; market: ArcanaMarket }
  | { type: "refund"; market: ArcanaMarket };

type TransactionProgress = {
  step: number;
  message: string;
  hash: Hash | null;
  error: string | null;
};

type PredictionView = "markets" | "positions";

const initialProgress: TransactionProgress = {
  step: 0,
  message: "Ready for wallet confirmation",
  hash: null,
  error: null,
};

function odds(market: ArcanaMarket) {
  const total = market.yesPool + market.noPool;
  if (total === 0n) return { yes: 50, no: 50 };
  const yes = Number((market.yesPool * 10_000n) / total) / 100;
  return { yes, no: 100 - yes };
}

function statusFor(market: ArcanaMarket, nowSeconds: bigint | null) {
  if (market.cancelled) return "Cancelled";
  if (market.resolved) return market.yesWon ? "Resolved YES" : "Resolved NO";
  if (nowSeconds !== null && market.endTime <= nowSeconds) {
    return "Awaiting resolution";
  }
  return "Open";
}

function predictionQuote(
  action: MarketAction | null,
  amount: string,
) {
  if (action?.type !== "predict" || !amount.trim()) return null;

  try {
    const stake = parseUnits(amount, 6);
    if (stake <= 0n) return null;

    const selectedPool =
      action.side === "YES"
        ? action.market.yesPool
        : action.market.noPool;
    const totalPool =
      action.market.yesPool + action.market.noPool;
    const winnerPoolAfterPurchase = selectedPool + stake;
    const totalPoolAfterPurchase = totalPool + stake;
    const potentialPayout =
      (stake * totalPoolAfterPurchase) / winnerPoolAfterPurchase;

    return {
      stake,
      shares: stake,
      potentialPayout,
      estimatedProfit:
        potentialPayout > stake ? potentialPayout - stake : 0n,
    };
  } catch {
    return null;
  }
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export function PredictionMarkets() {
  const { address, source } = useArcLendAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: 5_042_002 });
  const { switchChainAsync } = useSwitchChain();
  const contractWrite = useArcLendContractWrite();
  const { markets, isLoading, isError, refetch } = useArcanaMarkets();
  const [view, setView] = useState<PredictionView>("markets");
  const [filter, setFilter] = useState("All");
  const [action, setAction] = useState<MarketAction | null>(null);
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState(false);
  const [nowSeconds, setNowSeconds] = useState<bigint | null>(null);
  const [progress, setProgress] =
    useState<TransactionProgress>(initialProgress);
  const categories = useMemo(
    () => ["All", ...Array.from(new Set(markets.map((market) => market.category)))],
    [markets],
  );
  const visibleMarkets =
    filter === "All"
      ? markets
      : markets.filter((market) => market.category === filter);
  const quote = useMemo(
    () => predictionQuote(action, amount),
    [action, amount],
  );
  const myPositions = useMemo(
    () =>
      markets.filter(
        (market) =>
          market.yesShares + market.noShares > 0n || market.claimed,
      ),
    [markets],
  );
  const positionSummary = useMemo(() => {
    const yesShares = myPositions.reduce(
      (sum, market) => sum + market.yesShares,
      0n,
    );
    const noShares = myPositions.reduce(
      (sum, market) => sum + market.noShares,
      0n,
    );
    const claimable = myPositions.filter((market) => {
      const winningShares = market.yesWon
        ? market.yesShares
        : market.noShares;
      return market.resolved && !market.claimed && winningShares > 0n;
    }).length;

    return {
      totalMarkets: myPositions.length,
      totalShares: yesShares + noShares,
      claimable,
    };
  }, [myPositions]);

  useEffect(() => {
    const updateNow = () =>
      setNowSeconds(BigInt(Math.floor(Date.now() / 1_000)));
    updateNow();
    const timer = window.setInterval(updateNow, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const execute = async () => {
    if (!action || !address || !publicClient || pending) return;
    setPending(true);
    setProgress({
      step: 0,
      message: "Checking network and wallet state",
      hash: null,
      error: null,
    });
    try {
      if (source === "wallet" && chainId !== 5_042_002) {
        setProgress((current) => ({
          ...current,
          message: "Switching wallet to Arc Testnet",
        }));
        await switchChainAsync({ chainId: 5_042_002 });
      }

      let hash: Hash | null = null;
      if (action.type === "predict") {
        const parsedAmount = parseUnits(amount, 6);
        if (parsedAmount <= 0n) throw new Error("Enter a valid USDC amount");
        setProgress((current) => ({
          ...current,
          message: "Checking USDC approval",
        }));
        const allowance = await publicClient.readContract({
          address: ARC_USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, ARCANA_MARKETS_ADDRESS],
        });
        if (allowance < parsedAmount) {
          setProgress((current) => ({
            ...current,
            message: "Approve USDC in your wallet",
          }));
          const approvalResult = await contractWrite.writeContractAsync({
            chainId: 5_042_002,
            address: ARC_USDC_ADDRESS,
            abi: erc20Abi,
            functionName: "approve",
            args: [ARCANA_MARKETS_ADDRESS, parsedAmount],
          });
          const approvalHash = resultHash(approvalResult);
          setProgress((current) => ({
            ...current,
            message: "Waiting for USDC approval confirmation",
          }));
          if (approvalHash) {
            await publicClient.waitForTransactionReceipt({ hash: approvalHash });
          }
        }
        setProgress((current) => ({
          ...current,
          step: 1,
          message: "Confirm the prediction in your wallet",
        }));
        hash = resultHash(await contractWrite.writeContractAsync({
          chainId: 5_042_002,
          address: ARCANA_MARKETS_ADDRESS,
          abi: arcanaMarketsAbi,
          functionName: "buyShares",
          args: [
            action.market.id,
            action.side === "YES",
            parsedAmount,
          ],
        })) ?? null;
      } else {
        setProgress((current) => ({
          ...current,
          step: 1,
          message:
            action.type === "claim"
              ? "Confirm the winnings claim in your wallet"
              : "Confirm the refund in your wallet",
        }));
        hash = resultHash(await contractWrite.writeContractAsync({
          chainId: 5_042_002,
          address: ARCANA_MARKETS_ADDRESS,
          abi: arcanaMarketsAbi,
          functionName:
            action.type === "claim" ? "claimWinnings" : "refund",
          args: [action.market.id],
        })) ?? null;
      }
      setProgress({
        step: 2,
        message: "Transaction submitted — confirming on Arc Testnet",
        hash,
        error: null,
      });
      if (hash) await publicClient.waitForTransactionReceipt({ hash });
      setProgress({
        step: 3,
        message: "Transaction confirmed on Arc Testnet",
        hash,
        error: null,
      });
      showToast(
        "success",
        action.type === "predict"
          ? `${amount} USDC prediction confirmed`
          : action.type === "claim"
            ? "Winnings claimed"
            : "Position refunded",
      );
      await refetch();
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Transaction failed";
      setProgress((current) => ({
        ...current,
        message: "Transaction stopped",
        error: message,
      }));
      showToast(
        "error",
        message,
      );
    } finally {
      setPending(false);
    }
  };

  if (isLoading && markets.length === 0) {
    return <Skeleton height={560} />;
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-white/10 bg-white/[0.035] p-1">
          {[
            { id: "markets" as const, label: "Markets" },
            { id: "positions" as const, label: "My Predictions" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={`rounded-md px-3 py-2 text-xs font-medium transition ${
                view === item.id
                  ? "bg-emerald-200/[0.12] text-emerald-100"
                  : "text-white/45 hover:text-white"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {address ? (
          <div className="flex items-center gap-2 rounded-lg border border-violet-200/15 bg-violet-200/[0.05] px-3 py-2 text-xs text-violet-100/70">
            <User className="h-3.5 w-3.5" />
            {positionSummary.totalMarkets} participated
          </div>
        ) : null}
      </div>

      {view === "markets" ? (
        <>
      <div className="mb-5 flex flex-wrap gap-2">
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => setFilter(category)}
            className={`rounded-lg border px-3 py-2 text-xs transition ${
              filter === category
                ? "border-emerald-200/30 bg-emerald-200/[0.1] text-emerald-100"
                : "border-white/10 bg-white/[0.035] text-white/45 hover:text-white"
            }`}
          >
            {category}
          </button>
        ))}
      </div>

      {isError ? (
        <p className="mb-5 rounded-lg border border-red-300/15 bg-red-300/[0.06] p-4 text-sm text-red-100/75">
          Arcana market data is temporarily unavailable.
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleMarkets.map((market) => {
          const marketOdds = odds(market);
          const status = statusFor(market, nowSeconds);
          const isOpen = status === "Open";
          const winningShares = market.yesWon
            ? market.yesShares
            : market.noShares;
          const canClaim =
            market.resolved && !market.claimed && winningShares > 0n;
          const canRefund =
            market.cancelled &&
            !market.claimed &&
            market.yesShares + market.noShares > 0n;

          return (
            <article
              key={market.id.toString()}
              className="flex flex-col rounded-lg border border-white/10 bg-[#0d1012]/88 p-5 backdrop-blur-2xl"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="rounded-md border border-cyan-200/15 bg-cyan-200/[0.06] px-2.5 py-1 text-[10px] font-semibold uppercase text-cyan-100/70">
                  {market.category}
                </span>
                <span className="text-[10px] font-medium uppercase text-white/35">
                  {status}
                </span>
              </div>
              <h2 className="mt-4 min-h-14 text-lg font-semibold leading-7 text-white">
                {market.title}
              </h2>
              <p className="mt-1 font-mono text-[10px] text-white/25">
                Market #{market.id.toString()}
              </p>
              <div className="mt-4 rounded-lg border border-white/[0.07] bg-black/20 p-3">
                <div className="flex justify-between text-xs">
                  <span className="text-emerald-200">YES {marketOdds.yes.toFixed(1)}%</span>
                  <span className="text-rose-200">NO {marketOdds.no.toFixed(1)}%</span>
                </div>
                <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-white/10">
                  <span
                    className="bg-emerald-200"
                    style={{ width: `${marketOdds.yes}%` }}
                  />
                  <span className="flex-1 bg-rose-200/70" />
                </div>
                <div className="mt-3 flex justify-between font-mono text-[10px] text-white/35">
                  <span>{formatUnits(market.yesPool, 6)} USDC</span>
                  <span>{formatUnits(market.noPool, 6)} USDC</span>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 text-xs text-white/40">
                <CalendarClock className="h-3.5 w-3.5" />
                Ends{" "}
                {dateFormatter.format(
                  new Date(Number(market.endTime) * 1_000),
                )}{" "}
                UTC
              </div>
              {market.yesShares + market.noShares > 0n ? (
                <div className="mt-3 rounded-lg border border-violet-200/10 bg-violet-200/[0.04] p-3 text-xs text-white/45">
                  Your position: {formatUnits(market.yesShares, 6)} YES /{" "}
                  {formatUnits(market.noShares, 6)} NO
                </div>
              ) : null}
              <div className="mt-auto pt-5">
                {isOpen ? (
                  <div className="grid grid-cols-2 gap-2">
                    <GlassButton
                      type="button"
                      variant="primary"
                      onClick={() =>
                        {
                          setProgress(initialProgress);
                          setAction({ type: "predict", market, side: "YES" });
                        }
                      }
                    >
                      Predict YES
                    </GlassButton>
                    <GlassButton
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        {
                          setProgress(initialProgress);
                          setAction({ type: "predict", market, side: "NO" });
                        }
                      }
                    >
                      Predict NO
                    </GlassButton>
                  </div>
                ) : canClaim ? (
                  <GlassButton
                    type="button"
                    variant="primary"
                    className="w-full"
                    onClick={() => {
                      setProgress(initialProgress);
                      setAction({ type: "claim", market });
                    }}
                  >
                    <Trophy className="h-4 w-4" />
                    Claim winnings
                  </GlassButton>
                ) : canRefund ? (
                  <GlassButton
                    type="button"
                    variant="primary"
                    className="w-full"
                    onClick={() => {
                      setProgress(initialProgress);
                      setAction({ type: "refund", market });
                    }}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Refund position
                  </GlassButton>
                ) : (
                  <div className="flex items-center justify-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] py-2.5 text-xs text-white/30">
                    <BadgeCheck className="h-4 w-4" />
                    No action available
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
        </>
      ) : (
        <div className="rounded-lg border border-white/10 bg-[#0d1012]/88 p-5 backdrop-blur-2xl">
          <div className="flex flex-col justify-between gap-4 border-b border-white/[0.07] pb-5 md:flex-row md:items-end">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-violet-200/20 bg-violet-200/[0.07] text-violet-200">
                  <User className="h-4 w-4" />
                </span>
                <h2 className="text-base font-semibold text-white">My Predictions</h2>
              </div>
              <p className="mt-2 text-sm text-white/45">
                Markets this connected wallet has taken a YES or NO position in.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 py-2">
                <p className="text-[10px] uppercase text-white/35">Markets</p>
                <p className="mt-1 font-mono text-sm text-white">
                  {positionSummary.totalMarkets}
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 py-2">
                <p className="text-[10px] uppercase text-white/35">Shares</p>
                <p className="mt-1 font-mono text-sm text-white">
                  {formatUnits(positionSummary.totalShares, 6)}
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 py-2">
                <p className="text-[10px] uppercase text-white/35">Claimable</p>
                <p className="mt-1 font-mono text-sm text-emerald-200">
                  {positionSummary.claimable}
                </p>
              </div>
            </div>
          </div>

          {!address ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <User className="h-9 w-9 text-white/20" />
              <p className="text-sm font-medium text-white/70">Connect a wallet to view predictions.</p>
              <p className="max-w-md text-xs leading-5 text-white/35">
                The list is loaded from the ArcanaMarkets contract for the connected wallet.
              </p>
            </div>
          ) : myPositions.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Sparkles className="h-9 w-9 text-white/20" />
              <p className="text-sm font-medium text-white/70">No prediction positions found.</p>
              <p className="max-w-md text-xs leading-5 text-white/35">
                Take a YES or NO position in an open market and it will appear here.
              </p>
            </div>
          ) : (
            <div className="mt-5 overflow-hidden rounded-lg border border-white/[0.08]">
              <div className="hidden grid-cols-[1fr_120px_160px_120px] gap-4 border-b border-white/[0.08] bg-white/[0.035] px-4 py-3 text-[10px] font-semibold uppercase text-white/35 md:grid">
                <span>Market</span>
                <span>Position</span>
                <span>Status</span>
                <span className="text-right">Action</span>
              </div>
              <div className="divide-y divide-white/[0.06]">
                {myPositions.map((market) => {
                  const status = statusFor(market, nowSeconds);
                  const statusColor =
                    status === "Open"
                      ? "border-emerald-200/20 bg-emerald-200/[0.07] text-emerald-200"
                      : status.startsWith("Resolved")
                        ? "border-violet-200/20 bg-violet-200/[0.07] text-violet-200"
                        : status === "Awaiting resolution"
                          ? "border-amber-200/20 bg-amber-200/[0.07] text-amber-200"
                          : "border-red-300/20 bg-red-300/[0.07] text-red-300";
                  const winningShares = market.yesWon
                    ? market.yesShares
                    : market.noShares;
                  const canClaim =
                    market.resolved && !market.claimed && winningShares > 0n;
                  const canRefund =
                    market.cancelled &&
                    !market.claimed &&
                    market.yesShares + market.noShares > 0n;

                  return (
                    <div
                      key={market.id.toString()}
                      className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_120px_160px_120px] md:items-center md:gap-4"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">
                          {market.title}
                        </p>
                        <p className="mt-1 font-mono text-[10px] text-white/30">
                          Market #{market.id.toString()} · {market.category}
                        </p>
                      </div>
                      <div className="font-mono text-[11px] text-white/50">
                        <span className="text-emerald-300/80">
                          {formatUnits(market.yesShares, 6)} YES
                        </span>
                        <span className="block text-rose-300/80">
                          {formatUnits(market.noShares, 6)} NO
                        </span>
                      </div>
                      <span
                        className={`w-fit rounded-md border px-2 py-1 text-[10px] font-semibold uppercase ${statusColor}`}
                      >
                        {market.claimed ? "Claimed" : status}
                      </span>
                      <div className="flex justify-start md:justify-end">
                        {canClaim ? (
                          <button
                            type="button"
                            onClick={() => {
                              setAction({ type: "claim", market });
                              setProgress(initialProgress);
                            }}
                            className="rounded-lg border border-emerald-200/25 bg-emerald-200/[0.09] px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-200/[0.15]"
                          >
                            <Trophy className="mr-1.5 inline h-3.5 w-3.5 align-middle" />
                            Claim
                          </button>
                        ) : canRefund ? (
                          <button
                            type="button"
                            onClick={() => {
                              setAction({ type: "refund", market });
                              setProgress(initialProgress);
                            }}
                            className="rounded-lg border border-amber-200/25 bg-amber-200/[0.09] px-3 py-1.5 text-xs font-semibold text-amber-100 transition hover:bg-amber-200/[0.15]"
                          >
                            <RotateCcw className="mr-1.5 inline h-3.5 w-3.5 align-middle" />
                            Refund
                          </button>
                        ) : (
                          <span className="text-xs text-white/30">
                            {market.claimed ? "Complete" : "No action"}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {action ? (
        <div className="fixed inset-0 z-[160] flex items-center justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm">
          <div className="my-auto max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-lg border border-white/12 bg-[#0b0e10] p-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <span className="rounded-lg border border-emerald-200/20 bg-emerald-200/[0.08] p-2 text-emerald-100">
                {action.type === "predict" ? (
                  <Sparkles className="h-5 w-5" />
                ) : (
                  <CircleDollarSign className="h-5 w-5" />
                )}
              </span>
              <div>
                <p className="text-xs uppercase text-emerald-200/55">
                  Arcana Markets
                </p>
                <h3 className="text-lg font-semibold text-white">
                  {action.type === "predict"
                    ? `Predict ${action.side}`
                    : action.type === "claim"
                      ? "Claim winnings"
                      : "Refund position"}
                </h3>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-white/55">
              {action.market.title}
            </p>
            {action.type === "predict" ? (
              <>
                <label className="mt-5 block">
                  <span className="text-xs text-white/45">USDC amount</span>
                  <input
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    disabled={pending || progress.step === 3}
                    inputMode="decimal"
                    placeholder="10.00"
                    className="mt-2 w-full rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 font-mono text-white"
                  />
                </label>
                {quote ? (
                  <div
                    className={`mt-4 grid grid-cols-2 gap-2 rounded-lg border p-3 ${
                      progress.step === 3
                        ? "border-emerald-200/20 bg-emerald-200/[0.055]"
                        : "border-white/[0.08] bg-white/[0.025]"
                    }`}
                  >
                    <div>
                      <p className="text-[10px] uppercase text-white/35">
                        Amount used
                      </p>
                      <p className="mt-1 font-mono text-sm text-white">
                        {formatUnits(quote.stake, 6)} USDC
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-white/35">
                        Shares {progress.step === 3 ? "purchased" : "received"}
                      </p>
                      <p className="mt-1 font-mono text-sm text-white">
                        {formatUnits(quote.shares, 6)} {action.side}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-white/35">
                        Potential payout
                      </p>
                      <p className="mt-1 font-mono text-sm text-cyan-100">
                        {formatUnits(quote.potentialPayout, 6)} USDC
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-white/35">
                        Estimated profit
                      </p>
                      <p className="mt-1 font-mono text-sm text-emerald-200">
                        +{formatUnits(quote.estimatedProfit, 6)} USDC
                      </p>
                    </div>
                    <p className="col-span-2 text-[10px] leading-4 text-white/30">
                      Payout and profit are estimates if {action.side} wins.
                      They change as other users buy shares before the market
                      closes.
                    </p>
                  </div>
                ) : null}
              </>
            ) : null}
            <p className="mt-4 text-xs leading-5 text-amber-100/55">
              ArcanaMarkets is an external Arc Testnet contract. Review every
              wallet prompt before signing.
            </p>
            <div className="mt-5 rounded-lg border border-white/[0.08] bg-black/20 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase text-white/40">
                  Transaction progress
                </p>
                <span className="font-mono text-[10px] text-emerald-200/55">
                  {progress.step}/3
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {[
                  action.type === "predict"
                    ? "Approve USDC spending"
                    : "Verify wallet and position",
                  action.type === "predict"
                    ? "Submit prediction"
                    : action.type === "claim"
                      ? "Submit claim"
                      : "Submit refund",
                  "Confirm on Arc Testnet",
                ].map((label, index) => {
                  const stepNumber = index + 1;
                  const complete = progress.step >= stepNumber;
                  const active =
                    pending && progress.step === index && !progress.error;

                  return (
                    <div
                      key={label}
                      className="flex items-center gap-3 text-xs"
                    >
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                          complete
                            ? "border-emerald-200/35 bg-emerald-200/[0.1] text-emerald-200"
                            : active
                              ? "border-cyan-200/30 bg-cyan-200/[0.08] text-cyan-200"
                              : "border-white/10 bg-white/[0.035] text-white/25"
                        }`}
                      >
                        {complete ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : active ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CircleDot className="h-3.5 w-3.5" />
                        )}
                      </span>
                      <span className={complete ? "text-white/75" : "text-white/40"}>
                        {label}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p
                className={`mt-4 text-xs ${
                  progress.error ? "text-red-200" : "text-white/45"
                }`}
              >
                {progress.error ?? progress.message}
              </p>
              {progress.hash ? (
                <a
                  href={`https://testnet.arcscan.app/tx/${progress.hash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-emerald-200/15 bg-emerald-200/[0.055] px-3 py-2.5 text-xs text-emerald-100 transition hover:bg-emerald-200/[0.1]"
                >
                  <span className="min-w-0 truncate font-mono">
                    {progress.hash}
                  </span>
                  <ExternalLink className="h-4 w-4 shrink-0" />
                </a>
              ) : null}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <GlassButton
                type="button"
                variant="primary"
                disabled={
                  !address ||
                  pending ||
                  progress.step === 3 ||
                  (action.type === "predict" && !amount)
                }
                onClick={() => void execute()}
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {progress.step === 3 ? "Confirmed" : "Confirm"}
              </GlassButton>
              <GlassButton
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setAction(null);
                  setAmount("");
                  setProgress(initialProgress);
                }}
              >
                {progress.step === 3 ? "Done" : "Cancel"}
              </GlassButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
