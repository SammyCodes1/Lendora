"use client";

import { useMemo } from "react";
import type { Abi, Address } from "viem";
import { formatUnits } from "viem";
import { useReadContracts } from "wagmi";
import earnVaultAbi from "@/constants/abis/EarnVault.json";
import earnReferralControllerAbi from "@/constants/abis/EarnReferralController.json";
import deployments from "@/constants/deployments.json";
import { marketDefinitions } from "@/lib/markets";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import {
  resultHash,
  useArcLendContractWrite,
} from "@/hooks/useArcLendContractWrite";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const abi = earnVaultAbi as Abi;
const referralAbi = earnReferralControllerAbi as Abi;
export const EARN_REFERRAL_CONTROLLER_ADDRESS =
  ((deployments.EarnReferralController as Address | undefined) ?? ZERO_ADDRESS);

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
  assetsPerShare: number;
  pendingReferralRewards: bigint;
  referredVolume: bigint;
};

export type EarnReferralSummary = {
  deployed: boolean;
  referrer: Address;
  level: number;
  pendingPoints: bigint;
  claimedPoints: bigint;
  referredUsers: bigint;
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
    ]),
    query: {
      enabled: deployedDefinitions.length > 0,
      refetchInterval: 4_000,
    },
  });
  const referralDeployed = EARN_REFERRAL_CONTROLLER_ADDRESS !== ZERO_ADDRESS;
  const referralReads = useReadContracts({
    contracts: [
      {
        chainId: 5042002,
        address: EARN_REFERRAL_CONTROLLER_ADDRESS,
        abi: referralAbi,
        functionName: "referrerOf",
        args: [address ?? ZERO_ADDRESS],
      },
      {
        chainId: 5042002,
        address: EARN_REFERRAL_CONTROLLER_ADDRESS,
        abi: referralAbi,
        functionName: "referralLevel",
        args: [address ?? ZERO_ADDRESS],
      },
      {
        chainId: 5042002,
        address: EARN_REFERRAL_CONTROLLER_ADDRESS,
        abi: referralAbi,
        functionName: "pendingPoints",
        args: [address ?? ZERO_ADDRESS],
      },
      {
        chainId: 5042002,
        address: EARN_REFERRAL_CONTROLLER_ADDRESS,
        abi: referralAbi,
        functionName: "claimedPoints",
        args: [address ?? ZERO_ADDRESS],
      },
      {
        chainId: 5042002,
        address: EARN_REFERRAL_CONTROLLER_ADDRESS,
        abi: referralAbi,
        functionName: "referredUsers",
        args: [address ?? ZERO_ADDRESS],
      },
      ...definitions.flatMap((market) => [
        {
          chainId: 5042002,
          address: EARN_REFERRAL_CONTROLLER_ADDRESS,
          abi: referralAbi,
          functionName: "pendingRewards",
          args: [address ?? ZERO_ADDRESS, market.address],
        },
        {
          chainId: 5042002,
          address: EARN_REFERRAL_CONTROLLER_ADDRESS,
          abi: referralAbi,
          functionName: "referredVolume",
          args: [address ?? ZERO_ADDRESS, market.address],
        },
      ]),
    ],
    query: {
      enabled: referralDeployed && Boolean(address),
      refetchInterval: 4_000,
    },
  });

  const markets = useMemo(() => {
    let deployedIndex = 0;
    return definitions.map((definition, marketIndex): EarnVaultMarket => {
      const referralOffset = 5 + marketIndex * 2;
      const pendingReferralRewards = bigintResult(
        referralReads.data?.[referralOffset]?.result,
      );
      const referredVolume = bigintResult(
        referralReads.data?.[referralOffset + 1]?.result,
      );
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
          assetsPerShare: 1,
          pendingReferralRewards,
          referredVolume,
        };
      }

      const offset = deployedIndex * 3;
      deployedIndex += 1;
      const totalAssets = bigintResult(reads.data?.[offset]?.result);
      const totalShares = bigintResult(reads.data?.[offset + 1]?.result);
      const userShares = bigintResult(reads.data?.[offset + 2]?.result);
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
        assetsPerShare,
        pendingReferralRewards,
        referredVolume,
      };
    });
  }, [definitions, reads.data, referralReads.data]);

  const referralSummary = useMemo(
    (): EarnReferralSummary => ({
      deployed: referralDeployed,
      referrer:
        typeof referralReads.data?.[0]?.result === "string"
          ? (referralReads.data[0].result as Address)
          : ZERO_ADDRESS,
      level: Number(referralReads.data?.[1]?.result ?? 1),
      pendingPoints: bigintResult(referralReads.data?.[2]?.result),
      claimedPoints: bigintResult(referralReads.data?.[3]?.result),
      referredUsers: bigintResult(referralReads.data?.[4]?.result),
    }),
    [referralDeployed, referralReads.data],
  );

  return {
    markets,
    referral: referralSummary,
    isLoading: reads.isPending,
    isError: reads.isError || referralReads.isError,
    error: reads.error || referralReads.error,
    refetch: async () => {
      await Promise.all([reads.refetch(), referralReads.refetch()]);
    },
  };
}

export function useEarnVaultAction() {
  const write = useArcLendContractWrite();

  return {
    txHash: write.txHash,
    isPending: write.isPending,
    isSuccess: write.isSuccess,
    error: write.error,
    deposit: (vault: Address, assets: bigint, receiver: Address, minShares: bigint) =>
      write.writeContractAsync({
        chainId: 5042002,
        address: vault,
        abi,
        functionName: "deposit",
        args: [assets, receiver, minShares],
      }).then(resultHash),
    depositWithReferral: (
      vault: Address,
      assets: bigint,
      receiver: Address,
      referrer: Address,
      minShares: bigint,
    ) =>
      write.writeContractAsync({
        chainId: 5042002,
        address: EARN_REFERRAL_CONTROLLER_ADDRESS,
        abi: referralAbi,
        functionName: "depositWithReferral",
        args: [vault, assets, receiver, referrer, minShares],
      }).then(resultHash),
    registerReferrer: (referrer: Address) =>
      write.writeContractAsync({
        chainId: 5042002,
        address: EARN_REFERRAL_CONTROLLER_ADDRESS,
        abi: referralAbi,
        functionName: "registerReferrer",
        args: [referrer],
      }).then(resultHash),
    claimReferralRewards: (asset: Address, receiver: Address) =>
      write.writeContractAsync({
        chainId: 5042002,
        address: EARN_REFERRAL_CONTROLLER_ADDRESS,
        abi: referralAbi,
        functionName: "claimRewards",
        args: [asset, receiver],
      }).then(resultHash),
    claimReferralPoints: () =>
      write.writeContractAsync({
        chainId: 5042002,
        address: EARN_REFERRAL_CONTROLLER_ADDRESS,
        abi: referralAbi,
        functionName: "claimPoints",
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
