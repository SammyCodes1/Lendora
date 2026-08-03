"use client";

import { useCallback, useEffect, useState } from "react";
import {
  erc20Abi,
  formatUnits,
  type Abi,
  type Address,
} from "viem";
import { usePublicClient } from "wagmi";
import lendingPoolAbi from "@/constants/abis/LendingPool.json";
import deployments from "@/constants/deployments.json";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import type { MarketAsset } from "@/components/modals/types";

const poolAddress = deployments.lendingPool as Address;
const poolAbi = lendingPoolAbi as Abi;

/**
 * Computes a withdraw amount that is likely to succeed on-chain:
 * min(aToken balance, pool cash, max amount keeping HF >= 1 when debt exists).
 * Uses binary search + eth_call simulation for the HF-safe bound.
 */
export function useSafeWithdrawMax(
  market: MarketAsset | null,
  aTokenBalance: bigint,
  enabled: boolean,
) {
  const { address } = useArcLendAccount();
  const publicClient = usePublicClient({ chainId: 5042002 });
  const [maxWithdrawable, setMaxWithdrawable] = useState(0n);
  const [poolCash, setPoolCash] = useState(0n);
  const [isLoading, setIsLoading] = useState(false);
  const [reason, setReason] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!market || !address || !publicClient || !enabled) {
      setMaxWithdrawable(0n);
      setPoolCash(0n);
      setReason(null);
      return;
    }

    setIsLoading(true);
    try {
      const cash = await publicClient.readContract({
        address: market.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [poolAddress],
      });
      setPoolCash(cash);

      const cashCap = cash < aTokenBalance ? cash : aTokenBalance;
      if (cashCap === 0n) {
        setMaxWithdrawable(0n);
        setReason(
          aTokenBalance === 0n
            ? "No aToken balance to withdraw."
            : "Pool has no free liquidity (funds are borrowed). Repay debt across the market or wait for repayments.",
        );
        return;
      }

      // Fast path: try cash cap first.
      try {
        await publicClient.simulateContract({
          address: poolAddress,
          abi: poolAbi,
          functionName: "withdraw",
          args: [market.address, cashCap, address],
          account: address,
        });
        setMaxWithdrawable(cashCap);
        setReason(
          cashCap < aTokenBalance
            ? cash < aTokenBalance
              ? `Limited by pool cash (${formatUnits(cash, 6)} ${market.symbol} available).`
              : null
            : null,
        );
        return;
      } catch {
        // Fall through to binary search (typically HF constraint).
      }

      let lo = 0n;
      let hi = cashCap;
      let best = 0n;
      while (lo <= hi) {
        const mid = (lo + hi) / 2n;
        if (mid === 0n) {
          lo = 1n;
          continue;
        }
        try {
          await publicClient.simulateContract({
            address: poolAddress,
            abi: poolAbi,
            functionName: "withdraw",
            args: [market.address, mid, address],
            account: address,
          });
          best = mid;
          lo = mid + 1n;
        } catch {
          hi = mid - 1n;
        }
      }

      setMaxWithdrawable(best);
      if (best === 0n) {
        setReason(
          "No safe withdraw amount right now. Repay debt first or reduce size so health factor stays ≥ 1.0.",
        );
      } else if (best < aTokenBalance) {
        setReason(
          best < cash
            ? "Limited by health factor — leave collateral to cover open debt (HF ≥ 1.0)."
            : `Limited by pool cash (${formatUnits(cash, 6)} ${market.symbol}).`,
        );
      } else {
        setReason(null);
      }
    } catch (error) {
      setMaxWithdrawable(0n);
      setReason(
        error instanceof Error
          ? error.message
          : "Could not compute safe withdraw max.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [aTokenBalance, address, enabled, market, publicClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    maxWithdrawable,
    poolCash,
    isLoading,
    reason,
    refresh,
    formattedMax: formatUnits(maxWithdrawable, 6),
  };
}
