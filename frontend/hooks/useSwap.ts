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
import { ARC_DEX_TOKENS } from "@/lib/arcDex";
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

export type SwapRouteQuote = {
  key: "tower";
  output: bigint;
  minOut: bigint;
  router: Address;
  dexId: string;
  dexName: string;
  feeBps: number;
  priceImpact: number;
  routeLabel: string;
  quote: TowerQuoteData;
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

  const quoteSwap = useCallback(
    async (
      tokenIn: SwapToken,
      tokenOut: SwapToken,
      amountIn: string,
      slippageBps = 50,
    ): Promise<SwapRouteQuote> => {
      if (tokenIn === tokenOut) {
        throw new Error("Swap assets must be different");
      }
      parseSlippageBps(slippageBps);
      const parsedAmount = parseUnits(amountIn, ARC_DEX_TOKENS[tokenIn].decimals);
      if (parsedAmount <= 0n) {
        throw new Error("Swap amount must be greater than zero");
      }

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
      if (!response.ok || !payload.quote) {
        throw new Error(apiError(payload, "No Tower Exchange route is available"));
      }
      return toRouteQuote(parseTowerQuote(payload.quote));
    },
    [],
  );

  const swap = useCallback(
    async (
      tokenIn: SwapToken,
      tokenOut: SwapToken,
      amountIn: string,
      slippageBps: number,
      _confirmedQuote?: SwapRouteQuote,
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
        const preparedPayload = (await prepareResponse.json()) as PrepareApiResponse;
        if (!prepareResponse.ok) {
          throw new Error(
            apiError(preparedPayload, "Tower Exchange could not build this swap"),
          );
        }
        const prepared = parsePrepared(preparedPayload);
        assertPreparedSwap(prepared, {
          userAddress: address,
          tokenIn,
          tokenOut,
          inputAmount: parsedAmount.toString(),
        });
        const best = toRouteQuote(prepared.quote);

        const allowance = await publicClient.readContract({
          address: fromToken.address,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, TOWER_SWAP_EXECUTOR],
        });
        let approvalHash: Hash | undefined;
        if (allowance < parsedAmount) {
          onStep?.("approve", { state: "active" });
          const approvalStartedAt = performance.now();
          approvalHash = await writeContractAsync({
            chainId: TOWER_SWAP_CHAIN_ID,
            address: fromToken.address,
            abi: erc20Abi,
            functionName: "approve",
            args: [TOWER_SWAP_EXECUTOR, parsedAmount],
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
            finalityMs: Math.max(
              0,
              Math.round(performance.now() - approvalStartedAt),
            ),
          });
        } else {
          onStep?.("approve", { state: "success", finalityMs: 0 });
        }

        onStep?.("swap", { state: "active" });
        const hash = await sendTransactionAsync({
          chainId: TOWER_SWAP_CHAIN_ID,
          to: prepared.swap.to,
          data: prepared.swap.data as Hex,
          value: BigInt(prepared.swap.value),
        });
        setTxHash(hash);
        onStep?.("swap", { state: "active", hash });
        const submittedAt = performance.now();
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          throw new Error("Tower swap reverted onchain");
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
      sendTransactionAsync,
      switchChainAsync,
      writeContractAsync,
    ],
  );

  return { swap, quoteSwap, isPending, txHash, error };
}
