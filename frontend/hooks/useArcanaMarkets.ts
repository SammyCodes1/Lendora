"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import {
  ARCANA_MARKETS_ADDRESS,
  arcanaMarketsAbi,
} from "@/constants/arcana";

const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as Address;

export type ArcanaMarket = {
  id: bigint;
  title: string;
  category: string;
  yesPool: bigint;
  noPool: bigint;
  endTime: bigint;
  resolved: boolean;
  yesWon: boolean;
  cancelled: boolean;
  yesShares: bigint;
  noShares: bigint;
  claimed: boolean;
};

function tupleValue<T>(
  value: unknown,
  key: string,
  index: number,
  fallback: T,
): T {
  if (!value || typeof value !== "object") return fallback;
  const tuple = value as Record<string | number, unknown>;
  return (tuple[key] ?? tuple[index] ?? fallback) as T;
}

export function useArcanaMarkets() {
  const { address } = useArcLendAccount();
  const account = address ?? ZERO_ADDRESS;
  const countRead = useReadContract({
    chainId: 5_042_002,
    address: ARCANA_MARKETS_ADDRESS,
    abi: arcanaMarketsAbi,
    functionName: "marketCount",
    query: { refetchInterval: 10_000 },
  });
  const count = countRead.data ?? 0n;
  const safeCount =
    typeof count === "bigint" && count >= 0n && count <= 250n
      ? Number(count)
      : 0;
  const ids = useMemo(
    () =>
      Array.from(
        { length: safeCount },
        (_, index) => BigInt(index + 1),
      ),
    [safeCount],
  );

  const reads = useReadContracts({
    contracts: ids.flatMap((id) => [
      {
        chainId: 5_042_002,
        address: ARCANA_MARKETS_ADDRESS,
        abi: arcanaMarketsAbi,
        functionName: "getMarket" as const,
        args: [id],
      },
      {
        chainId: 5_042_002,
        address: ARCANA_MARKETS_ADDRESS,
        abi: arcanaMarketsAbi,
        functionName: "getPosition" as const,
        args: [id, account],
      },
    ]),
    allowFailure: true,
    query: {
      enabled: ids.length > 0,
      refetchInterval: 10_000,
    },
  });

  const markets = useMemo(
    () =>
      ids
        .map((id, index): ArcanaMarket | null => {
          const marketResult = reads.data?.[index * 2];
          if (!marketResult || marketResult.status !== "success") return null;
          const market = marketResult.result;
          const positionResult = reads.data?.[index * 2 + 1];
          const position =
            positionResult?.status === "success"
              ? positionResult.result
              : undefined;

          return {
            id: tupleValue(market, "id", 0, id),
            title: tupleValue(market, "title", 1, ""),
            category: tupleValue(market, "category", 2, "General"),
            yesPool: tupleValue(market, "yesPool", 3, 0n),
            noPool: tupleValue(market, "noPool", 4, 0n),
            endTime: tupleValue(market, "endTime", 5, 0n),
            resolved: tupleValue(market, "resolved", 6, false),
            yesWon: tupleValue(market, "yesWon", 7, false),
            cancelled: tupleValue(market, "cancelled", 8, false),
            yesShares: tupleValue(position, "yesShares", 0, 0n),
            noShares: tupleValue(position, "noShares", 1, 0n),
            claimed: tupleValue(position, "claimed", 2, false),
          };
        })
        .filter(
          (market): market is ArcanaMarket =>
            Boolean(
              market &&
                typeof market.title === "string" &&
                market.title.trim(),
            ),
        )
        .reverse(),
    [ids, reads.data],
  );

  return {
    markets,
    count,
    isLoading: countRead.isPending || reads.isPending,
    isError: countRead.isError || reads.isError,
    refetch: async () => {
      await Promise.all([countRead.refetch(), reads.refetch()]);
    },
  };
}
