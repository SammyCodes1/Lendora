"use client";

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  type Abi,
  type Address,
} from "viem";
import {
  usePublicClient,
} from "wagmi";
import positionManagerAbi from "@/constants/abis/PositionManager.json";
import positionNFTAbi from "@/constants/abis/PositionNFT.json";
import multicall3Abi from "@/constants/abis/Multicall3.json";
import deployments from "@/constants/deployments.json";
import { MULTICALL3 } from "@/constants/contracts";
import { marketDefinitions } from "@/lib/markets";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import {
  resultHash,
  useArcLendContractWrite,
} from "@/hooks/useArcLendContractWrite";

export type PositionType = 0 | 1;

export type PositionNFTMetadata = {
  name: string;
  description: string;
  image: string;
  attributes: Array<{
    trait_type: string;
    value: string | number;
  }>;
};

export type UserPositionNFT = {
  tokenId: bigint;
  asset: Address;
  symbol: "USDC" | "EURC";
  positionType: PositionType;
  typeLabel: "Supply" | "Borrow";
  linkedToken: Address;
  openedAt: bigint;
  liveBalance: bigint;
  formattedBalance: string;
  tokenURI: string;
  metadata: PositionNFTMetadata | null;
};

export type ClaimablePositionReceipt = {
  asset: Address;
  symbol: "USDC" | "EURC";
  positionType: PositionType;
  typeLabel: "Supply" | "Borrow";
  liveBalance: bigint;
};

const managerAddress = deployments.PositionManager as Address;
const nftAddress = deployments.PositionNFT as Address;
const managerAbi = positionManagerAbi as Abi;
const nftAbi = positionNFTAbi as Abi;

const positionKeys = marketDefinitions.flatMap((market) => [
  {
    asset: market.address,
    symbol: market.symbol,
    linkedToken: market.aToken,
    positionType: 0 as const,
    typeLabel: "Supply" as const,
  },
  {
    asset: market.address,
    symbol: market.symbol,
    linkedToken: market.debtToken,
    positionType: 1 as const,
    typeLabel: "Borrow" as const,
  },
]);

function decodeMetadata(uri: string): PositionNFTMetadata | null {
  const prefix = "data:application/json;base64,";
  if (!uri.startsWith(prefix) || typeof window === "undefined") {
    return null;
  }
  try {
    const bytes = Uint8Array.from(
      window.atob(uri.slice(prefix.length)),
      (character) => character.charCodeAt(0),
    );
    return JSON.parse(
      new TextDecoder().decode(bytes),
    ) as PositionNFTMetadata;
  } catch {
    return null;
  }
}

function useManagerAction(
  functionName:
    | "supply"
    | "borrow"
    | "claimExistingPosition"
    | "closePosition",
) {
  const write = useArcLendContractWrite();

  return {
    txHash: write.txHash,
    isPending: write.isPending,
    isSuccess: write.isSuccess,
    error: write.error,
    execute: (args: readonly unknown[]) =>
      write.writeContractAsync({
        chainId: 5042002,
        address: managerAddress,
        abi: managerAbi,
        functionName,
        args,
      }).then(resultHash),
  };
}

export function useSupplyWithReceipt() {
  const action = useManagerAction("supply");
  return {
    ...action,
    supply: (asset: Address, amount: bigint) =>
      action.execute([asset, amount]),
  };
}

export function useBorrowWithReceipt() {
  const action = useManagerAction("borrow");
  return {
    ...action,
    borrow: (asset: Address, amount: bigint) =>
      action.execute([asset, amount]),
  };
}

export function useClaimExistingPosition() {
  const action = useManagerAction("claimExistingPosition");
  return {
    ...action,
    claimExistingPosition: (
      asset: Address,
      positionType: PositionType,
    ) => action.execute([asset, positionType]),
  };
}

export function useClosePosition() {
  const action = useManagerAction("closePosition");
  return {
    ...action,
    closePosition: (
      asset: Address,
      positionType: PositionType,
    ) => action.execute([asset, positionType]),
  };
}

export type BurnAllProgress = {
  total: number;
};

export function useBurnAllPositions() {
  const write = useArcLendContractWrite();
  const [isBurning, setIsBurning] = useState(false);
  const [progress, setProgress] = useState<BurnAllProgress | null>(null);
  const [results, setResults] = useState<
    Array<{ tokenId: bigint; success: boolean; error?: string }>
  >([]);

  const burnAll = useCallback(
    async (positions: UserPositionNFT[]) => {
      if (isBurning || positions.length === 0) return results;

      setIsBurning(true);
      setResults([]);
      setProgress({ total: positions.length });

      try {
        const calls = positions.map((p) => ({
          target: managerAddress,
          allowFailure: true,
          callData: encodeFunctionData({
            abi: managerAbi,
            functionName: "closePosition",
            args: [p.asset, p.positionType],
          }),
        }));

        const hash = resultHash(
          await write.writeContractAsync({
            chainId: 5042002,
            address: MULTICALL3 as Address,
            abi: multicall3Abi as Abi,
            functionName: "aggregate3",
            args: [calls],
          }),
        );

        if (!hash) {
          throw new Error("Transaction was not submitted.");
        }

        const newResults = positions.map((p) => ({
          tokenId: p.tokenId,
          success: true,
        }));

        setResults(newResults);
        setProgress(null);
        setIsBurning(false);
        return newResults;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        const newResults = positions.map((p) => ({
          tokenId: p.tokenId,
          success: false,
          error: errorMessage,
        }));
        setResults(newResults);
        setProgress(null);
        setIsBurning(false);
        return newResults;
      }
    },
    [isBurning, results, write],
  );

  const reset = useCallback(() => {
    setIsBurning(false);
    setProgress(null);
    setResults([]);
  }, []);

  return {
    burnAll,
    isBurning,
    progress,
    results,
    reset,
  };
}

export function useUserPositionNFTs() {
  const { address } = useArcLendAccount();
  const publicClient = usePublicClient({ chainId: 5042002 });
  const query = useQuery({
    queryKey: ["arclend", "position-nfts", address],
    enabled: Boolean(address && publicClient),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: 2,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 10_000),
    queryFn: async () => {
      if (!address || !publicClient) {
        return { positions: [], claimable: [] };
      }

      // Pin every read to one block, but batch them through Multicall3. All
      // hook consumers share this query key, so modals no longer start their
      // own competing RPC polling loops.
      const blockNumber = await publicClient.getBlockNumber();
      const snapshotResults = await publicClient.multicall({
        allowFailure: false,
        blockNumber,
        contracts: positionKeys.flatMap((key) => [
          {
            address: nftAddress,
            abi: nftAbi,
            functionName: "userPositionToken",
            args: [address, key.asset, key.positionType],
          },
          {
            address: key.linkedToken,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address],
          },
        ]),
      });
      const snapshots = positionKeys.map((key, index) => ({
        ...key,
        tokenId: snapshotResults[index * 2] as bigint,
        liveBalance: snapshotResults[index * 2 + 1] as bigint,
      }));
      const owned = snapshots.filter((snapshot) => snapshot.tokenId > 0n);
      const detailResults = owned.length
        ? await publicClient.multicall({
            allowFailure: true,
            blockNumber,
            contracts: owned.flatMap((snapshot) => [
              {
                address: nftAddress,
                abi: nftAbi,
                functionName: "positions",
                args: [snapshot.tokenId],
              },
              {
                address: nftAddress,
                abi: nftAbi,
                functionName: "tokenURI",
                args: [snapshot.tokenId],
              },
            ]),
          })
        : [];

      const positions = owned.map((snapshot, index) => {
        const positionResult = detailResults[index * 2];
        const metadataResult = detailResults[index * 2 + 1];
        if (!positionResult || positionResult.status !== "success") {
          throw positionResult?.error ?? new Error("Position data is unavailable");
        }
        const position = positionResult.result as readonly [
          Address,
          number,
          Address,
          bigint,
        ];
        const tokenURI =
          metadataResult?.status === "success"
            ? (metadataResult.result as string)
            : "";
        return {
          tokenId: snapshot.tokenId,
          asset: position[0],
          symbol: snapshot.symbol,
          positionType: Number(position[1]) as PositionType,
          typeLabel: snapshot.typeLabel,
          linkedToken: position[2],
          openedAt: position[3],
          liveBalance: snapshot.liveBalance,
          formattedBalance: formatUnits(snapshot.liveBalance, 6),
          tokenURI,
          metadata: decodeMetadata(tokenURI),
        } satisfies UserPositionNFT;
      }).sort((left, right) =>
        left.tokenId === right.tokenId ? 0 : left.tokenId > right.tokenId ? -1 : 1,
      );
      const claimable = snapshots.flatMap((snapshot) =>
        snapshot.tokenId === 0n && snapshot.liveBalance > 0n
          ? [{
              asset: snapshot.asset,
              symbol: snapshot.symbol,
              positionType: snapshot.positionType,
              typeLabel: snapshot.typeLabel,
              liveBalance: snapshot.liveBalance,
            } satisfies ClaimablePositionReceipt]
          : [],
      );
      return { positions, claimable };
    },
  });

  return {
    positions: query.data?.positions ?? [],
    claimable: query.data?.claimable ?? [],
    isLoading: query.isPending && Boolean(address),
    isError: query.isError,
    refetch: query.refetch,
  };
}

export { managerAddress as POSITION_MANAGER_ADDRESS };
