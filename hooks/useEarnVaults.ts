"use client";

import { useMemo } from "react";
import type { Abi, Address } from "viem";
import { formatUnits } from "viem";
import { useReadContracts } from "wagmi";
import earnVaultAbi from "@/constants/abis/EarnVault.json";
import deployments from "@/constants/deployments.json";
import { marketDefinitions } from "@/lib/markets";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import {
  resultHash,
  useArcLendContractWrite,
} from "@/hooks/useArcLendContractWrite";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const abi = earnVaultAbi as Abi;

export type EarnVaultMarket = {
  name: string;
  symbol: "USDC" | "EURC";
  asset: Address;
  vault: Address;
  deployed: boolean;
  totalAssets: bigint;
  totalShares: bigint;
  userShares: bigint;
  userAssets: bigint;
  availableAssets: bigint;
  assetsPerShare: number;
};

function vaultAddress(symbol: "USDC" | "EURC") {
  const configured = deployments.earnVaults?.[symbol] as Address | undefined;
  return configured ?? ZERO_ADDRESS;
}

function bigintResult(value: unknown): bigint {
  return typeof value === "bigint" ? value : 0n;
}

export function useEarnVaultMarkets() {
  const { address } = useArcLendAccount();
  const definitions = useMemo(
    () =>
      marketDefinitions.map((market) => ({
        ...market,
        vault: vaultAddress(market.symbol),
      })),
    [],
  );
  const deployedDefinitions = definitions.filter(
    (market) => market.vault !== ZERO_ADDRESS,
  );

  const reads = useReadContracts({
    contracts: deployedDefinitions.flatMap((market) => [
      {
        chainId: 5042002,
        address: market.vault,
        abi,
        functionName: "totalAssets",
      },
      {
        chainId: 5042002,
        address: market.vault,
        abi,
        functionName: "totalSupply",
      },
      {
        chainId: 5042002,
        address: market.vault,
        abi,
        functionName: "balanceOf",
        args: [address ?? ZERO_ADDRESS],
      },
      {
        chainId: 5042002,
        address: market.vault,
        abi,
        functionName: "availableAssets",
      },
    ]),
    query: {
      enabled: deployedDefinitions.length > 0,
      refetchInterval: 4_000,
    },
  });

  const markets = useMemo(() => {
    let deployedIndex = 0;
    return definitions.map((definition): EarnVaultMarket => {
      if (definition.vault === ZERO_ADDRESS) {
        return {
          name: definition.name,
          symbol: definition.symbol,
          asset: definition.address,
          vault: definition.vault,
          deployed: false,
          totalAssets: 0n,
          totalShares: 0n,
          userShares: 0n,
          userAssets: 0n,
          availableAssets: 0n,
          assetsPerShare: 1,
        };
      }

      const offset = deployedIndex * 4;
      deployedIndex += 1;
      const totalAssets = bigintResult(reads.data?.[offset]?.result);
      const totalShares = bigintResult(reads.data?.[offset + 1]?.result);
      const userShares = bigintResult(reads.data?.[offset + 2]?.result);
      const availableAssets = bigintResult(reads.data?.[offset + 3]?.result);
      const userAssets =
        totalShares > 0n ? (userShares * totalAssets) / totalShares : userShares;
      const assetsPerShare =
        totalShares > 0n
          ? Number(formatUnits(totalAssets, 6)) /
            Number(formatUnits(totalShares, 6))
          : 1;

      return {
        name: definition.name,
        symbol: definition.symbol,
        asset: definition.address,
        vault: definition.vault,
        deployed: true,
        totalAssets,
        totalShares,
        userShares,
        userAssets,
        availableAssets,
        assetsPerShare,
      };
    });
  }, [definitions, reads.data]);

  return {
    markets,
    isLoading: reads.isPending,
    isError: reads.isError,
    error: reads.error,
    refetch: reads.refetch,
  };
}

export function useEarnVaultAction() {
  const write = useArcLendContractWrite();

  return {
    txHash: write.txHash,
    isPending: write.isPending,
    isSuccess: write.isSuccess,
    error: write.error,
    reset: write.reset,
    deposit: (vault: Address, assets: bigint, receiver: Address, minShares: bigint) =>
      write.writeContractAsync({
        chainId: 5042002,
        address: vault,
        abi,
        functionName: "deposit",
        args: [assets, receiver, minShares],
      }).then(resultHash),
    withdraw: (vault: Address, assets: bigint, receiver: Address, owner: Address) =>
      write.writeContractAsync({
        chainId: 5042002,
        address: vault,
        abi,
        functionName: "withdraw",
        args: [assets, receiver, owner],
      }).then(resultHash),
  };
}
