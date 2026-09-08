"use client";

import { useCallback, useState } from "react";
import {
  erc20Abi,
  parseUnits,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSendTransaction,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import {
  ARC_DEX_ROUTERS,
  ARC_DEX_TOKENS,
  CURVE_ABI,
  encodeTowerAdapterSwapCalldata,
  isArcLendSwapPair,
  isStableSwapPair,
  SWAP_POOL_ABI,
  synthraV3FeesForPair,
  TOWER_ABI,
  TOWER_ADAPTER_ABI,
  towerSwapAmountIn,
  V2_ROUTER_ABI,
  V3_QUOTER_ABI,
  V3_ROUTER_ABI,
} from "@/lib/arcDex";
import {
  assertPreparedSwap,
  fromTowerQuoteAmount,
  parseOptionalTowerTxPayload,
  parseSlippageBps,
  parseTowerQuote,
  parseTowerTxPayload,
  tokenByAddress,
  TOWER_SWAP_CHAIN_ID,
  TOWER_SWAP_EXECUTOR,
  towerRouteLabel,
  type SwapTokenSymbol,
  type TowerPreparedSwap,
  type TowerQuoteData,
} from "@/lib/towerSwap";

export type SwapToken = SwapTokenSymbol;
export type RouteKey = "tower" | "arclend" | "curve" | "xylo" | "v3";

export type SwapRouteQuote = {
  key: RouteKey;
  output: bigint;
  minOut: bigint;
  router: Address;
  label: string;
  detail: string;
  dexId?: string;
  dexName?: string;
  feeBps?: number;
  fee?: number;
  priceImpact?: number;
  routeLabel?: string;
  quote?: TowerQuoteData;
};

export type SwapExecutionStep = "switch" | "approve" | "swap";

export type SwapExecutionResult = {
  hash: Hash;
  quote: SwapRouteQuote;
  approvalHash?: Hash;
  finalityMs: number;
};

export type SwapStepUpdate = {
  state: "waiting" | "active" | "success" | "error";
  hash?: Hash;
  finalityMs?: number;
};

type QuoteApiResponse = {
  error?: string;
  quote?: unknown;
};

type PrepareApiResponse = {
  error?: string;
  quote?: unknown;
  approval?: unknown;
  swap?: unknown;
};

function apiError(payload: { error?: string }, fallback: string) {
  return payload.error?.trim() || fallback;
}

function toRouteQuote(quote: TowerQuoteData): SwapRouteQuote {
  const outputToken = tokenByAddress(quote.outputToken);
  const decimals = outputToken?.decimals ?? 18;
  return {
    key: "tower",
    output: fromTowerQuoteAmount(quote.outputAmount, decimals),
    minOut: fromTowerQuoteAmount(quote.minOut, decimals),
    router: TOWER_SWAP_EXECUTOR,
    label: "Tower Exchange",
    detail: "Official Tower router. Quotes and calldata via TowerSwapExecutor.",
    dexId: quote.dexId,
    dexName: quote.dexName,
    feeBps: quote.feeBps,
    priceImpact: quote.priceImpact,
    routeLabel: towerRouteLabel(quote),
    quote,
  };
}

function parsePrepared(payload: PrepareApiResponse): TowerPreparedSwap {
  const quote = parseTowerQuote(payload.quote);
  const swap = parseTowerTxPayload(payload.swap, "Tower swap");
  const approval = parseOptionalTowerTxPayload(payload.approval, "Tower approval");
  return { quote, approval, swap };
}

export function useSwap() {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: TOWER_SWAP_CHAIN_ID });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const [isPending, setIsPending] = useState(false);
  const [txHash, setTxHash] = useState<Hash | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const quoteRoutes = useCallback(
    async (
      tokenIn: SwapToken,
      tokenOut: SwapToken,
      amountIn: string,
      slippageBps = 50,
    ): Promise<SwapRouteQuote[]> => {
      if (tokenIn === tokenOut) {
        throw new Error("Swap assets must be different");
      }
      parseSlippageBps(slippageBps);
      const fromToken = ARC_DEX_TOKENS[tokenIn];
      const toToken = ARC_DEX_TOKENS[tokenOut];
      const parsedAmount = parseUnits(amountIn, fromToken.decimals);
      if (parsedAmount <= 0n) {
        throw new Error("Swap amount must be greater than zero");
      }

      const stablePair = isStableSwapPair(tokenIn, tokenOut);
      const arcLendPair = isArcLendSwapPair(tokenIn, tokenOut);
      const v3Fees = synthraV3FeesForPair(tokenIn, tokenOut);
      const towerAmountIn = towerSwapAmountIn(parsedAmount);

      // Tower quote promise
      const towerPromise = (async (): Promise<SwapRouteQuote | null> => {
        try {
          const response = await fetch("/api/swap/quote", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              tokenIn,
              tokenOut,
              amountIn,
              slippageBps,
            }),
          });
          const payload = (await response.json()) as QuoteApiResponse;
          if (response.ok && payload.quote) {
            return toRouteQuote(parseTowerQuote(payload.quote));
          }
        } catch {}

        if (publicClient && towerAmountIn > 0n) {
          try {
            const out = await publicClient.readContract({
              address: ARC_DEX_ROUTERS.towerAdapter,
              abi: TOWER_ADAPTER_ABI,
              functionName: "getAmountOut",
              args: [fromToken.address, toToken.address, towerAmountIn],
            });
            if (out > 0n) {
              const minOut = (out * BigInt(10_000 - slippageBps)) / 10_000n;
              return {
                key: "tower",
                output: out,
                minOut,
                router: ARC_DEX_ROUTERS.tower,
                label: "Tower Exchange",
                detail: "Official Tower router. Quotes and calldata via TowerSwapExecutor.",
                feeBps: 25,
                priceImpact: 0,
                routeLabel: "Tower Exchange",
              };
            }
          } catch {}
        }
        return null;
      })();

      // Concurrently query peer routers on Arc
      const [towerQuote, arclendQuote, curveQuote, xyloQuote, v3Quotes] =
        await Promise.all([
          towerPromise,
          publicClient && arcLendPair
            ? publicClient
                .readContract({
                  address: ARC_DEX_ROUTERS.arclend,
                  abi: SWAP_POOL_ABI,
                  functionName: "getQuote",
                  args: [fromToken.address, parsedAmount],
                })
                .then((out) =>
                  out > 0n
                    ? {
                        key: "arclend" as const,
                        output: out,
                        minOut: (out * BigInt(10_000 - slippageBps)) / 10_000n,
                        router: ARC_DEX_ROUTERS.arclend,
                        label: "Lendora SwapPool",
                        detail: "Native USDC/EURC constant-product pool on Arc.",
                      }
                    : null,
                )
                .catch(() => null)
            : Promise.resolve(null),
          publicClient && stablePair
            ? publicClient
                .readContract({
                  address: ARC_DEX_ROUTERS.curve,
                  abi: CURVE_ABI,
                  functionName: "get_dy",
                  args: [
                    tokenIn === "USDC" ? 0n : 1n,
                    tokenIn === "USDC" ? 1n : 0n,
                    parsedAmount,
                  ],
                })
                .then((out) =>
                  out > 0n
                    ? {
                        key: "curve" as const,
                        output: out,
                        minOut: (out * BigInt(10_000 - slippageBps)) / 10_000n,
                        router: ARC_DEX_ROUTERS.curve,
                        label: "Curve",
                        detail: "Stable pool for pegged assets on Arc.",
                      }
                    : null,
                )
                .catch(() => null)
            : Promise.resolve(null),
          publicClient && stablePair
            ? publicClient
                .readContract({
                  address: ARC_DEX_ROUTERS.xylo,
                  abi: V2_ROUTER_ABI,
                  functionName: "getAmountsOut",
                  args: [parsedAmount, [fromToken.address, toToken.address]],
                })
                .then((amounts) =>
                  amounts && amounts.length > 1 && amounts[1] > 0n
                    ? {
                        key: "xylo" as const,
                        output: amounts[1],
                        minOut:
                          (amounts[1] * BigInt(10_000 - slippageBps)) / 10_000n,
                        router: ARC_DEX_ROUTERS.xylo,
                        label: "Xylo",
                        detail: "V2 AMM router on Arc.",
                      }
                    : null,
                )
                .catch(() => null)
            : Promise.resolve(null),
          publicClient && v3Fees.length > 0
            ? Promise.allSettled(
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
              )
            : Promise.resolve([]),
        ]);

      const quotes: SwapRouteQuote[] = [];
      if (towerQuote) quotes.push(towerQuote);
      if (arclendQuote) quotes.push(arclendQuote);
      if (curveQuote) quotes.push(curveQuote);
      if (xyloQuote) quotes.push(xyloQuote);

      if (Array.isArray(v3Quotes)) {
        const bestV3 = v3Quotes.reduce<SwapRouteQuote | null>(
          (best, quoteResult, index) => {
            if (
              quoteResult.status === "fulfilled" &&
              quoteResult.value.result[0] > 0n &&
              (!best || quoteResult.value.result[0] > best.output)
            ) {
              const out = quoteResult.value.result[0];
              return {
                key: "v3",
                output: out,
                minOut: (out * BigInt(10_000 - slippageBps)) / 10_000n,
                router: ARC_DEX_ROUTERS.v3,
                fee: v3Fees[index],
                label: "Synthra V3",
                detail: `Concentrated liquidity (${v3Fees[index] / 10000}% fee).`,
              };
            }
            return best;
          },
          null,
        );
        if (bestV3) quotes.push(bestV3);
      }

      if (quotes.length === 0) {
        throw new Error("No executable Arc swap route is available");
      }
      return quotes;
    },
    [publicClient],
  );

  const quoteSwap = useCallback(
    async (
      tokenIn: SwapToken,
      tokenOut: SwapToken,
      amountIn: string,
      slippageBps = 50,
    ): Promise<SwapRouteQuote> => {
      const allQuotes = await quoteRoutes(tokenIn, tokenOut, amountIn, slippageBps);
      const best = allQuotes.reduce((prev, current) =>
        !prev || current.output > prev.output ? current : prev,
      );
      return best;
    },
    [quoteRoutes],
  );

  const swap = useCallback(
    async (
      tokenIn: SwapToken,
      tokenOut: SwapToken,
      amountIn: string,
      slippageBps: number,
      confirmedQuote?: SwapRouteQuote,
      onStep?: (step: SwapExecutionStep, update: SwapStepUpdate) => void,
    ): Promise<SwapExecutionResult> => {
      if (!address || !publicClient) {
        throw new Error("Connect a wallet before swapping");
      }
      if (tokenIn === tokenOut) {
        throw new Error("Swap assets must be different");
      }
      parseSlippageBps(slippageBps);

      const fromToken = ARC_DEX_TOKENS[tokenIn];
      const toToken = ARC_DEX_TOKENS[tokenOut];
      const parsedAmount = parseUnits(amountIn, fromToken.decimals);
      if (parsedAmount <= 0n) {
        throw new Error("Swap amount must be greater than zero");
      }

      setIsPending(true);
      setError(null);
      setTxHash(null);

      try {
        if (chainId !== TOWER_SWAP_CHAIN_ID) {
          onStep?.("switch", { state: "active" });
          const switchStartedAt = performance.now();
          await switchChainAsync({ chainId: TOWER_SWAP_CHAIN_ID });
          onStep?.("switch", {
            state: "success",
            finalityMs: Math.max(0, Math.round(performance.now() - switchStartedAt)),
          });
        } else {
          onStep?.("switch", { state: "success", finalityMs: 0 });
        }

        const best =
          confirmedQuote ??
          (await quoteSwap(tokenIn, tokenOut, amountIn, slippageBps));

        let approvalHash: Hash | undefined;
        let hash: Hash;
        const submittedAt = performance.now();

        if (best.key === "tower") {
          let prepared: TowerPreparedSwap | null = null;
          try {
            const prepareResponse = await fetch("/api/swap/prepare", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                tokenIn,
                tokenOut,
                amountIn,
                slippageBps,
                userAddress: address,
              }),
            });
            if (prepareResponse.ok) {
              const preparedPayload = (await prepareResponse.json()) as PrepareApiResponse;
              if (preparedPayload.swap) {
                prepared = parsePrepared(preparedPayload);
              }
            }
          } catch {}

          if (prepared) {
            const spender = (prepared.approval?.to as Address) ?? TOWER_SWAP_EXECUTOR;
            const allowance = await publicClient.readContract({
              address: fromToken.address,
              abi: erc20Abi,
              functionName: "allowance",
              args: [address, spender],
            });
            if (allowance < parsedAmount) {
              onStep?.("approve", { state: "active" });
              const approvalStartedAt = performance.now();
              approvalHash = await writeContractAsync({
                chainId: TOWER_SWAP_CHAIN_ID,
                address: fromToken.address,
                abi: erc20Abi,
                functionName: "approve",
                args: [spender, parsedAmount],
              });
              onStep?.("approve", { state: "active", hash: approvalHash });
              const approvalReceipt = await publicClient.waitForTransactionReceipt({
                hash: approvalHash,
              });
              if (approvalReceipt.status !== "success") {
                throw new Error("Token approval reverted onchain");
              }
              onStep?.("approve", {
                state: "success",
                hash: approvalHash,
                finalityMs: Math.max(0, Math.round(performance.now() - approvalStartedAt)),
              });
            } else {
              onStep?.("approve", { state: "success", finalityMs: 0 });
            }

            onStep?.("swap", { state: "active" });
            hash = await sendTransactionAsync({
              chainId: TOWER_SWAP_CHAIN_ID,
              to: prepared.swap.to,
              data: prepared.swap.data as Hex,
              value: BigInt(prepared.swap.value),
            });
          } else {
            const swapAmountIn = towerSwapAmountIn(parsedAmount);
            if (swapAmountIn <= 0n) {
              throw new Error("Swap amount too small after Tower fee");
            }
            const minimumOutput = (best.output * BigInt(10_000 - slippageBps)) / 10_000n;
            const allowance = await publicClient.readContract({
              address: fromToken.address,
              abi: erc20Abi,
              functionName: "allowance",
              args: [address, ARC_DEX_ROUTERS.tower],
            });
            if (allowance < parsedAmount) {
              onStep?.("approve", { state: "active" });
              const approvalStartedAt = performance.now();
              approvalHash = await writeContractAsync({
                chainId: TOWER_SWAP_CHAIN_ID,
                address: fromToken.address,
                abi: erc20Abi,
                functionName: "approve",
                args: [ARC_DEX_ROUTERS.tower, parsedAmount],
              });
              onStep?.("approve", { state: "active", hash: approvalHash });
              const approvalReceipt = await publicClient.waitForTransactionReceipt({
                hash: approvalHash,
              });
              if (approvalReceipt.status !== "success") {
                throw new Error("Token approval reverted onchain");
              }
              onStep?.("approve", {
                state: "success",
                hash: approvalHash,
                finalityMs: Math.max(0, Math.round(performance.now() - approvalStartedAt)),
              });
            } else {
              onStep?.("approve", { state: "success", finalityMs: 0 });
            }

            const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
            const routeCalldata = encodeTowerAdapterSwapCalldata({
              tokenIn: fromToken.address,
              tokenOut: toToken.address,
              amountIn: swapAmountIn,
              minAmountOut: minimumOutput,
              deadline,
            });

            onStep?.("swap", { state: "active" });
            hash = await writeContractAsync({
              chainId: TOWER_SWAP_CHAIN_ID,
              address: ARC_DEX_ROUTERS.tower,
              abi: TOWER_ABI,
              functionName: "executeSwap",
              args: [
                {
                  tokenIn: fromToken.address,
                  tokenOut: toToken.address,
                  amountIn: parsedAmount,
                  minAmountOut: minimumOutput,
                  recipient: address,
                  routeTarget: ARC_DEX_ROUTERS.towerAdapter,
                  approvalSpender: ARC_DEX_ROUTERS.towerAdapter,
                  routeCalldata,
                },
              ],
            });
          }
        } else {
          const routerAddress = best.router;
          const allowance = await publicClient.readContract({
            address: fromToken.address,
            abi: erc20Abi,
            functionName: "allowance",
            args: [address, routerAddress],
          });
          if (allowance < parsedAmount) {
            onStep?.("approve", { state: "active" });
            const approvalStartedAt = performance.now();
            approvalHash = await writeContractAsync({
              chainId: TOWER_SWAP_CHAIN_ID,
              address: fromToken.address,
              abi: erc20Abi,
              functionName: "approve",
              args: [routerAddress, parsedAmount],
            });
            onStep?.("approve", { state: "active", hash: approvalHash });
            const approvalReceipt = await publicClient.waitForTransactionReceipt({
              hash: approvalHash,
            });
            if (approvalReceipt.status !== "success") {
              throw new Error("Token approval reverted onchain");
            }
            onStep?.("approve", {
              state: "success",
              hash: approvalHash,
              finalityMs: Math.max(0, Math.round(performance.now() - approvalStartedAt)),
            });
          } else {
            onStep?.("approve", { state: "success", finalityMs: 0 });
          }

          const minimumOutput = (best.output * BigInt(10_000 - slippageBps)) / 10_000n;
          onStep?.("swap", { state: "active" });

          if (best.key === "arclend") {
            hash = await writeContractAsync({
              chainId: TOWER_SWAP_CHAIN_ID,
              address: ARC_DEX_ROUTERS.arclend,
              abi: SWAP_POOL_ABI,
              functionName: "swap",
              args: [fromToken.address, parsedAmount, minimumOutput],
            });
          } else if (best.key === "curve") {
            const indices = tokenIn === "USDC" ? ([0n, 1n] as const) : ([1n, 0n] as const);
            hash = await writeContractAsync({
              chainId: TOWER_SWAP_CHAIN_ID,
              address: ARC_DEX_ROUTERS.curve,
              abi: CURVE_ABI,
              functionName: "exchange",
              args: [indices[0], indices[1], parsedAmount, minimumOutput],
            });
          } else if (best.key === "xylo") {
            hash = await writeContractAsync({
              chainId: TOWER_SWAP_CHAIN_ID,
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
          } else if (best.key === "v3") {
            if (best.fee === undefined) {
              throw new Error("Synthra V3 fee tier is unavailable");
            }
            hash = await writeContractAsync({
              chainId: TOWER_SWAP_CHAIN_ID,
              address: ARC_DEX_ROUTERS.v3,
              abi: V3_ROUTER_ABI,
              functionName: "exactInputSingle",
              args: [
                {
                  tokenIn: fromToken.address,
                  tokenOut: toToken.address,
                  fee: best.fee,
                  recipient: address,
                  amountIn: parsedAmount,
                  amountOutMinimum: minimumOutput,
                  sqrtPriceLimitX96: 0n,
                },
              ],
            });
          } else {
            throw new Error(`Unknown route key: ${(best as any).key}`);
          }
        }

        setTxHash(hash);
        onStep?.("swap", { state: "active", hash });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          throw new Error("Swap transaction reverted onchain");
        }
        onStep?.("swap", {
          state: "success",
          hash,
          finalityMs: Math.max(0, Math.round(performance.now() - submittedAt)),
        });
        return {
          hash,
          quote: best,
          approvalHash,
          finalityMs: Math.max(0, Math.round(performance.now() - submittedAt)),
        };
      } catch (caught) {
        const nextError =
          caught instanceof Error ? caught : new Error("Swap failed");
        setError(nextError);
        throw nextError;
      } finally {
        setIsPending(false);
      }
    },
    [
      address,
      chainId,
      publicClient,
      quoteSwap,
      sendTransactionAsync,
      switchChainAsync,
      writeContractAsync,
    ],
  );

  return { swap, quoteSwap, quoteRoutes, isPending, txHash, error };
}
