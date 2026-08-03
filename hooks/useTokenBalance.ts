"use client";

import { useMemo } from "react";
import {
  erc20Abi,
  formatUnits,
  type Address,
} from "viem";
import { useReadContracts } from "wagmi";

const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as Address;

type UseTokenBalanceOptions = {
  address?: Address;
  token?: Address;
  chainId: number;
  enabled?: boolean;
  refetchInterval?: number;
};

export function useTokenBalance({
  address,
  token,
  chainId,
  enabled = true,
  refetchInterval,
}: UseTokenBalanceOptions) {
  const tokenAddress = token ?? ZERO_ADDRESS;
  const result = useReadContracts({
    contracts: [
      {
        chainId,
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address ?? ZERO_ADDRESS],
      },
      {
        chainId,
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "decimals",
      },
      {
        chainId,
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "symbol",
      },
    ],
    allowFailure: true,
    query: {
      enabled: enabled && Boolean(address && token),
      refetchInterval,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: false,
      retry: 2,
      retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
    },
  });

  const data = useMemo(() => {
    const valueResult = result.data?.[0];
    const decimalsResult = result.data?.[1];
    const symbolResult = result.data?.[2];
    if (
      valueResult?.status !== "success" ||
      typeof valueResult.result !== "bigint"
    ) {
      return undefined;
    }

    const decimals =
      decimalsResult?.status === "success" &&
      typeof decimalsResult.result === "number"
        ? decimalsResult.result
        : 18;
    const symbol =
      symbolResult?.status === "success" &&
      typeof symbolResult.result === "string"
        ? symbolResult.result
        : "TOKEN";

    return {
      value: valueResult.result,
      decimals,
      symbol,
      formatted: formatUnits(valueResult.result, decimals),
    };
  }, [result.data]);

  return {
    ...result,
    data,
    isLoading: result.isPending,
  };
}
