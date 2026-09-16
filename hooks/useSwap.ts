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
  encodeTowerAdapterSwapCalldata,
  TOWER_ABI,
  TOWER_ADAPTER_ABI,
  towerSwapAmountIn,
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
export type RouteKey = "tower";

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

      const towerAmountIn = towerSwapAmountIn(parsedAmount);

      // Tower Exchange quote
      let towerQuote: SwapRouteQuote | null = null;
      let towerApiError: string | null = null;
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
        const payload = (await response.json()) as QuoteApiResponse & { error?: string };
        if (response.ok && payload.quote) {
          towerQuote = toRouteQuote(parseTowerQuote(payload.quote));
        } else if (payload.error) {
          towerApiError = payload.error;
        }
      } catch {}

      if (!towerQuote && publicClient && towerAmountIn > 0n) {
        try {
          const out = await publicClient.readContract({
            address: ARC_DEX_ROUTERS.towerAdapter,
            abi: TOWER_ADAPTER_ABI,
            functionName: "getAmountOut",
            args: [fromToken.address, toToken.address, towerAmountIn],
          });
          if (out > 0n) {
            const minOut = (out * BigInt(10_000 - slippageBps)) / 10_000n;
            towerQuote = {
              key: "tower",
              output: out,
              minOut,
              router: ARC_DEX_ROUTERS.tower,
              label: "Tower Exchange",
              detail: "Official DEX router on Arc via Tower Exchange.",
              feeBps: 25,
              priceImpact: 0,
              routeLabel: "Tower Exchange",
            };
          }
        } catch {}
      }

      if (!towerQuote) {
        throw new Error(towerApiError ?? "No executable Tower Exchange route is available");
      }

      return [towerQuote];
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
