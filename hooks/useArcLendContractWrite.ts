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
  gas?: bigint;
};

function circleFunctionSignature(abi: Abi, functionName: string) {
  const item = (
    abi as readonly {
      type?: string;
      name?: string;
      inputs?: readonly { type: string }[];
    }[]
  ).find((entry) => entry.type === "function" && entry.name === functionName);
  if (!item) return null;
  const types = (item.inputs ?? []).map((input) => input.type).join(",");
  return `${functionName}(${types})`;
}

function circleAbiParameter(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(circleAbiParameter);
  return value;
}

export type ArcLendContractWriteResult =
  | { source: "wallet"; hash: Hash; challengeId?: never }
  | { source: "email"; hash?: Hash; challengeId: string };

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
        const signature = circleFunctionSignature(
          request.abi,
          request.functionName,
        );
        const amount = request.value ? formatEther(request.value) : undefined;
        const response = signature
          ? await circleWrite.executeContract({
              contractAddress: request.address,
              abiFunctionSignature: signature,
              abiParameters: (request.args ?? []).map(circleAbiParameter),
              amount,
            })
          : await circleWrite.executeContract({
              contractAddress: request.address,
              callData: encodeFunctionData({
                abi: request.abi,
                functionName: request.functionName,
                args: request.args ?? [],
              }),
              amount,
            });
        if (!response.challengeId) {
          throw new Error("Circle did not return a transaction challenge.");
        }
        setCircleChallengeId(response.challengeId);
        setCircleSuccess(true);
        const txHashCandidate = (
          response.challengeResult as { data?: { txHash?: string } } | undefined
        )?.data?.txHash;
        const hash =
          typeof txHashCandidate === "string" &&
          /^0x[a-fA-F0-9]{64}$/.test(txHashCandidate)
            ? (txHashCandidate as Hash)
            : undefined;
        return { source: "email", challengeId: response.challengeId, hash };
      }

      const hash = await wagmiWrite.writeContractAsync({
        chainId: request.chainId ?? 5042002,
        address: request.address,
        abi: request.abi,
        functionName: request.functionName,
        args: request.args,
        value: request.value,
        gas: request.gas,
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
