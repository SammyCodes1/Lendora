"use client";

import { useCallback, useState } from "react";
import {
  encodeFunctionData,
  formatEther,
  type Abi,
  type Address,
  type Hash,
} from "viem";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import { useCircleContractExecution } from "@/hooks/useCircleContractExecution";

export type ArcLendContractWriteRequest = {
  chainId?: number;
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
};

export type ArcLendContractWriteResult =
  | { source: "wallet"; hash: Hash; challengeId?: never }
  | { source: "email"; hash?: never; challengeId: string };

export function resultHash(
  result: ArcLendContractWriteResult | Hash | undefined,
) {
  if (!result) return undefined;
  if (typeof result === "string") return result;
  return result.hash;
}

export function useArcLendContractWrite() {
  const { source } = useArcLendAccount();
  const wagmiWrite = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: wagmiWrite.data });
  const circleWrite = useCircleContractExecution();
  const [circleSuccess, setCircleSuccess] = useState(false);
  const [circleChallengeId, setCircleChallengeId] = useState<string | null>(null);

  const writeContractAsync = useCallback(
    async (
      request: ArcLendContractWriteRequest,
    ): Promise<ArcLendContractWriteResult> => {
      setCircleSuccess(false);
      setCircleChallengeId(null);

      if (source === "email") {
        const callData = encodeFunctionData({
          abi: request.abi,
          functionName: request.functionName,
          args: request.args ?? [],
        });
        // executeContract only resolves after the Circle challenge succeeds;
        // do not mark success when a challengeId is merely created.
        const response = await circleWrite.executeContract({
          contractAddress: request.address,
          callData,
          amount: request.value ? formatEther(request.value) : undefined,
        });
        if (!response.challengeId) {
          throw new Error("Circle did not return a transaction challenge.");
        }
        setCircleChallengeId(response.challengeId);
        setCircleSuccess(true);
        return { source: "email", challengeId: response.challengeId };
      }

      const hash = await wagmiWrite.writeContractAsync({
        chainId: request.chainId ?? 5042002,
        address: request.address,
        abi: request.abi,
        functionName: request.functionName,
        args: request.args,
        value: request.value,
      });
      return { source: "wallet", hash };
    },
    [circleWrite, source, wagmiWrite],
  );

  const writeContract = useCallback(
    (request: ArcLendContractWriteRequest) => {
      void writeContractAsync(request);
    },
    [writeContractAsync],
  );

  const reset = useCallback(() => {
    wagmiWrite.reset();
    setCircleSuccess(false);
    setCircleChallengeId(null);
  }, [wagmiWrite]);

  return {
    data: wagmiWrite.data,
    txHash: wagmiWrite.data,
    circleChallengeId,
    isPending: wagmiWrite.isPending || receipt.isLoading || circleWrite.isPending,
    // Email path: challenge completed in-wallet. On-chain finality is async;
    // do not claim success merely because a challengeId was created.
    isSuccess: source === "email" ? circleSuccess : receipt.isSuccess,
    error: wagmiWrite.error || receipt.error || circleWrite.error,
    writeContract,
    writeContractAsync,
    reset,
  };
}
