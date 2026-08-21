"use client";

import { useCallback, useMemo } from "react";
import {
  erc20Abi,
  formatUnits,
  parseAbi,
  parseUnits,
  type Address,
  type Hash,
} from "viem";
import { usePublicClient, useReadContract, useReadContracts } from "wagmi";
import deployments from "@/constants/deployments.json";
import { ARC_DEX_TOKENS } from "@/lib/arcDex";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import {
  resultHash,
  useArcLendContractWrite,
} from "@/hooks/useArcLendContractWrite";
import { useWithdrawAction } from "@/hooks/useLendingPool";
import { useLiveMarkets } from "@/hooks/useLiveMarkets";

export const spokenPayAddress = (
  deployments as typeof deployments & { SpokenPay?: Address }
).SpokenPay as Address | undefined;

export const spokenPayAbi = parseAbi([
  "function nextPlanId() view returns (uint256)",
  "function planIdsOf(address user) view returns (uint256[])",
  "function lastOutcome(uint256 planId) view returns (bytes32)",
  "function plans(uint256 planId) view returns (address user, address token, address recipient, string domainName, uint128 amount, uint64 interval, uint64 nextRunAt, uint64 minHealthFactorWad, bool fromYieldOnly, bool active)",
  "function previewPlan(uint256 planId) view returns (bool due, bool active, bytes32 blocker, address payTo, uint256 walletBalance, uint256 healthFactor)",
  "function createPlan(address token, address recipient, string domainName, uint128 amount, uint64 interval, uint64 firstRunAt, uint64 minHealthFactorWad, bool fromYieldOnly) returns (uint256)",
  "function cancelPlan(uint256 planId)",
  "function executePlan(uint256 planId) returns (bytes32)",
]);

export type SpokenPayPlan = {
  id: bigint;
  user: Address;
  token: Address;
  recipient: Address;
  domainName: string;
  amount: bigint;
  interval: bigint;
  nextRunAt: bigint;
  minHealthFactorWad: bigint;
  fromYieldOnly: boolean;
  active: boolean;
  lastOutcome: string;
  due: boolean;
  blocker: string;
  walletBalance: bigint;
  healthFactor: bigint;
  asset: "USDC" | "EURC";
};

function bytes32ToLabel(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("0x")) return "";
  let out = "";
  for (let i = 2; i < value.length; i += 2) {
    const code = Number.parseInt(value.slice(i, i + 2), 16);
    if (!code) break;
    out += String.fromCharCode(code);
  }
  return out;
}

function assetForToken(token: Address): "USDC" | "EURC" {
  return token.toLowerCase() === ARC_DEX_TOKENS.EURC.address.toLowerCase()
    ? "EURC"
    : "USDC";
}

export function useSpokenPayPlans() {
  const { address, isConnected } = useArcLendAccount();
  const idsRead = useReadContract({
    chainId: 5042002,
    address: spokenPayAddress,
    abi: spokenPayAbi,
    functionName: "planIdsOf",
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(spokenPayAddress && address),
      refetchInterval: 8_000,
    },
  });

  const ids = (idsRead.data as bigint[] | undefined) ?? [];
  const detailsRead = useReadContracts({
    contracts: ids.flatMap((id) => [
      {
        chainId: 5042002 as const,
        address: spokenPayAddress,
        abi: spokenPayAbi,
        functionName: "plans" as const,
        args: [id],
      },
      {
        chainId: 5042002 as const,
        address: spokenPayAddress,
        abi: spokenPayAbi,
        functionName: "previewPlan" as const,
        args: [id],
      },
      {
        chainId: 5042002 as const,
        address: spokenPayAddress,
        abi: spokenPayAbi,
        functionName: "lastOutcome" as const,
        args: [id],
      },
    ]),
    query: {
      enabled: Boolean(spokenPayAddress && ids.length > 0),
      refetchInterval: 8_000,
    },
  });

  const plans = useMemo<SpokenPayPlan[]>(() => {
    if (ids.length === 0) return [];
    const rows: SpokenPayPlan[] = [];
    for (let index = 0; index < ids.length; index++) {
      const planResult = detailsRead.data?.[index * 3]?.result as
        | readonly [
            Address,
            Address,
            Address,
            string,
            bigint,
            bigint,
            bigint,
            bigint,
            boolean,
            boolean,
          ]
        | undefined;
      const previewResult = detailsRead.data?.[index * 3 + 1]?.result as
        | readonly [boolean, boolean, `0x${string}`, Address, bigint, bigint]
        | undefined;
      const outcomeResult = detailsRead.data?.[index * 3 + 2]?.result;
      if (!planResult) continue;
      rows.push({
        id: ids[index],
        user: planResult[0],
        token: planResult[1],
        recipient: planResult[2],
        domainName: planResult[3],
        amount: planResult[4],
        interval: planResult[5],
        nextRunAt: planResult[6],
        minHealthFactorWad: planResult[7],
        fromYieldOnly: planResult[8],
        active: planResult[9],
        lastOutcome: bytes32ToLabel(outcomeResult) || bytes32ToLabel(previewResult?.[2]),
        due: Boolean(previewResult?.[0]),
        blocker: bytes32ToLabel(previewResult?.[2]),
        walletBalance: previewResult?.[4] ?? 0n,
        healthFactor: previewResult?.[5] ?? 0n,
        asset: assetForToken(planResult[1]),
      });
    }
    return rows.reverse();
  }, [detailsRead.data, ids]);

  const refetch = useCallback(async () => {
    await idsRead.refetch();
    await detailsRead.refetch();
  }, [detailsRead, idsRead]);

  return {
    plans,
    isLoading: idsRead.isLoading || detailsRead.isLoading,
    isConnected,
    address,
    refetch,
  };
}

export function useSpokenPayActions() {
  const { address } = useArcLendAccount();
  const write = useArcLendContractWrite();
  const withdraw = useWithdrawAction();
  const publicClient = usePublicClient({ chainId: 5042002 });
  const liveMarkets = useLiveMarkets();

  const createPlan = useCallback(
    async (input: {
      asset: "USDC" | "EURC";
      amount: string;
      recipient: Address;
      domainName: string;
      intervalSeconds: bigint;
      firstRunAt: bigint;
      minHealthFactorWad: bigint;
      fromYieldOnly: boolean;
    }) => {
      if (!spokenPayAddress || !address) {
        throw new Error("Connect a wallet to create a spoken payment.");
      }
      const token = ARC_DEX_TOKENS[input.asset];
      const amount = parseUnits(input.amount, 6);
      const allowance = await publicClient?.readContract({
        address: token.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, spokenPayAddress],
      });
      if ((allowance ?? 0n) < amount * 104n) {
        const approveHash = resultHash(
          await write.writeContractAsync({
            chainId: 5042002,
            address: token.address,
            abi: erc20Abi,
            functionName: "approve",
            args: [spokenPayAddress, amount * 104n],
          }),
        );
        if (approveHash && publicClient) {
          await publicClient.waitForTransactionReceipt({ hash: approveHash as Hash });
        }
      }
      const hash = resultHash(
        await write.writeContractAsync({
          chainId: 5042002,
          address: spokenPayAddress,
          abi: spokenPayAbi,
          functionName: "createPlan",
          args: [
            token.address,
            input.recipient,
            input.domainName,
            amount,
            input.intervalSeconds,
            input.firstRunAt,
            input.minHealthFactorWad,
            input.fromYieldOnly,
          ],
          gas: 500_000n,
        }),
      );
      if (hash && publicClient) {
        await publicClient.waitForTransactionReceipt({ hash: hash as Hash });
      }
      return hash;
    },
    [address, publicClient, write],
  );

  const cancelPlan = useCallback(
    async (planId: bigint) => {
      if (!spokenPayAddress) throw new Error("SpokenPay is not deployed.");
      const hash = resultHash(
        await write.writeContractAsync({
          chainId: 5042002,
          address: spokenPayAddress,
          abi: spokenPayAbi,
          functionName: "cancelPlan",
          args: [planId],
        }),
      );
      if (hash && publicClient) {
        await publicClient.waitForTransactionReceipt({ hash: hash as Hash });
      }
      return hash;
    },
    [publicClient, write],
  );

  const runPlan = useCallback(
    async (plan: SpokenPayPlan) => {
      if (!spokenPayAddress) throw new Error("SpokenPay is not deployed.");
      if (plan.fromYieldOnly && plan.walletBalance < plan.amount) {
        const market = liveMarkets.markets.find((item) => item.symbol === plan.asset);
        const pending = market?.accruedSupply ?? 0n;
        if (pending === 0n) {
          throw new Error(
            "Yield-only plans need claimed interest in your wallet. Claim yield first, then run.",
          );
        }
        const claim = pending;
        const withdrawHash = await withdraw.withdraw(plan.token, claim);
        if (withdrawHash && publicClient) {
          await publicClient.waitForTransactionReceipt({ hash: withdrawHash as Hash });
        }
      }
      const hash = resultHash(
        await write.writeContractAsync({
          chainId: 5042002,
          address: spokenPayAddress,
          abi: spokenPayAbi,
          functionName: "executePlan",
          args: [plan.id],
          gas: 400_000n,
        }),
      );
      if (hash && publicClient) {
        await publicClient.waitForTransactionReceipt({ hash: hash as Hash });
      }
      return hash;
    },
    [liveMarkets.markets, publicClient, withdraw, write],
  );

  return {
    createPlan,
    cancelPlan,
    runPlan,
    isPending: write.isPending || withdraw.isPending,
  };
}

export function formatHealthFloor(wad: bigint) {
  return Number(formatUnits(wad, 18)).toFixed(2);
}

export function cadenceFromInterval(interval: bigint) {
  if (interval === 24n * 60n * 60n) return "every day";
  if (interval === 7n * 24n * 60n * 60n) return "every week";
  const hours = Number(interval) / 3600;
  if (hours < 48) return `every ${Math.max(1, Math.round(hours))}h`;
  return `every ${Math.round(hours / 24)}d`;
}
