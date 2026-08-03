"use client";

import { useCallback, useState } from "react";
import {
  erc20Abi,
  parseUnits,
  type Address,
  type Hash,
} from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
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

export type SwapToken = keyof typeof ARC_DEX_TOKENS;

export type SwapRouteQuote = {
  key: "curve" | "xylo" | "v3";
  output: bigint;
  router: Address;
  fee?: number;
};

export type SwapExecutionResult = {
  hash: Hash;
  quote: SwapRouteQuote;
  finalityMs: number;
};

export function useSwap() {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: 5042002 });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [isPending, setIsPending] = useState(false);
  const [txHash, setTxHash] = useState<Hash | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const quoteSwap = useCallback(
    async (
      tokenIn: SwapToken,
      tokenOut: SwapToken,
      amountIn: string,
    ): Promise<SwapRouteQuote> => {
      if (!publicClient) {
        throw new Error("Arc client unavailable");
      }
      if (tokenIn === tokenOut) {
        throw new Error("Swap assets must be different");
      }

      const fromToken = ARC_DEX_TOKENS[tokenIn];
      const toToken = ARC_DEX_TOKENS[tokenOut];
      const parsedAmount = parseUnits(amountIn, fromToken.decimals);
      if (parsedAmount <= 0n) {
        throw new Error("Swap amount must be greater than zero");
      }

      const path = [fromToken.address, toToken.address] as Address[];
      const stablePair = isStableSwapPair(tokenIn, tokenOut);
      const v3Fees = synthraV3FeesForPair(tokenIn, tokenOut);
      const [[curve, xylo], v3Quotes] = await Promise.all([
        Promise.allSettled([
          stablePair
            ? publicClient.readContract({
                address: ARC_DEX_ROUTERS.curve,
                abi: CURVE_ABI,
                functionName: "get_dy",
                args: [
                  tokenIn === "USDC" ? 0n : 1n,
                  tokenIn === "USDC" ? 1n : 0n,
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

      const quotes: SwapRouteQuote[] = [];
      if (
        curve.status === "fulfilled" &&
        curve.value !== null &&
        curve.value > 0n
      ) {
        quotes.push({
          key: "curve",
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
        quotes.push({
          key: "xylo",
          output: xylo.value[1],
          router: ARC_DEX_ROUTERS.xylo,
        });
      }
      const bestV3 = v3Quotes.reduce<SwapRouteQuote | null>(
        (best, quote, index) =>
          quote.status === "fulfilled" &&
          quote.value.result[0] > 0n &&
          (!best || quote.value.result[0] > best.output)
            ? {
                key: "v3",
                output: quote.value.result[0],
                router: ARC_DEX_ROUTERS.v3,
                fee: v3Fees[index],
              }
            : best,
        null,
      );
      if (bestV3) {
        quotes.push({
          ...bestV3,
        });
      }

      const best = quotes.reduce<SwapRouteQuote | null>(
        (current, quote) =>
          !current || quote.output > current.output ? quote : current,
        null,
      );
      if (!best) {
        throw new Error("No executable Arc swap route is available");
      }
      return best;
    },
    [publicClient],
  );

  const swap = useCallback(
    async (
      tokenIn: SwapToken,
      tokenOut: SwapToken,
      amountIn: string,
      slippageBps: number,
      confirmedQuote?: SwapRouteQuote,
    ): Promise<SwapExecutionResult> => {
      if (!address || !publicClient) {
        throw new Error("Connect a wallet before swapping");
      }
      if (tokenIn === tokenOut) {
        throw new Error("Swap assets must be different");
      }
      if (
        !Number.isInteger(slippageBps) ||
        slippageBps < 1 ||
        slippageBps > 500
      ) {
        throw new Error("Slippage must be between 1 and 500 basis points");
      }

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
        if (chainId !== 5042002) {
          await switchChainAsync({ chainId: 5042002 });
        }

        const path = [fromToken.address, toToken.address] as Address[];
        const best =
          confirmedQuote ??
          (await quoteSwap(tokenIn, tokenOut, amountIn));

        const allowance = await publicClient.readContract({
          address: fromToken.address,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, best.router],
        });
        if (allowance < parsedAmount) {
          const approvalHash = await writeContractAsync({
            chainId: 5042002,
            address: fromToken.address,
            abi: erc20Abi,
            functionName: "approve",
            args: [best.router, parsedAmount],
          });
          await publicClient.waitForTransactionReceipt({ hash: approvalHash });
        }

        const minimumOutput =
          (best.output * BigInt(10_000 - slippageBps)) / 10_000n;
        let hash: Hash;

        if (best.key === "curve") {
          const indices =
            tokenIn === "USDC"
              ? ([0n, 1n] as const)
              : ([1n, 0n] as const);
          hash = await writeContractAsync({
            chainId: 5042002,
            address: ARC_DEX_ROUTERS.curve,
            abi: CURVE_ABI,
            functionName: "exchange",
            args: [indices[0], indices[1], parsedAmount, minimumOutput],
          });
        } else if (best.key === "xylo") {
          hash = await writeContractAsync({
            chainId: 5042002,
            address: ARC_DEX_ROUTERS.xylo,
            abi: V2_ROUTER_ABI,
            functionName: "swapExactTokensForTokens",
            args: [
              parsedAmount,
              minimumOutput,
              path,
              address,
              BigInt(Math.floor(Date.now() / 1000) + 20 * 60),
            ],
          });
        } else {
          if (best.fee === undefined) {
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
                fee: best.fee,
                recipient: address,
                amountIn: parsedAmount,
                amountOutMinimum: minimumOutput,
                sqrtPriceLimitX96: 0n,
              },
            ],
          });
        }

        setTxHash(hash);
        const submittedAt = performance.now();
        await publicClient.waitForTransactionReceipt({ hash });
        return {
          hash,
          quote: best,
          finalityMs: Math.max(
            0,
            Math.round(performance.now() - submittedAt),
          ),
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
      switchChainAsync,
      writeContractAsync,
    ],
  );

  return { swap, quoteSwap, isPending, txHash, error };
}
