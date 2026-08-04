"use client";

import { useEffect, useMemo, useState } from "react";
import { parseAbi, type Abi, type Address } from "viem";
import { useReadContracts } from "wagmi";
import lendingPoolAbi from "@/constants/abis/LendingPool.json";
import interestRateModelAbi from "@/constants/abis/InterestRateModel.json";
import mockPriceOracleAbi from "@/constants/abis/MockPriceOracle.json";
import erc20Abi from "@/constants/abis/ERC20.json";
import deployments from "@/constants/deployments.json";
import type { MarketAsset } from "@/components/modals/types";
import { marketDefinitions } from "@/lib/markets";
import { mapReserveData } from "@/hooks/useLendingPool";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";

const SECONDS_PER_YEAR = 31_536_000;
const RAY = 1e27;
const RAY_BIGINT = 1_000_000_000_000_000_000_000_000_000n;
const ASSET_UNIT = 1_000_000n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
/**
 * Calls per market in the base multicall (must stay in sync with contract order):
 * 0 reserve, 1 primary price, 2 fallback price, 3–6 balances,
 * 7 supplyCap, 8 borrowCap, 9 pool cash (underlying.balanceOf(pool)).
 */
const CALLS_PER_MARKET = 10;
const lendingPoolAddress = deployments.lendingPool as Address;
const priceOracleAddress = deployments.priceOracle as Address;
const fallbackPriceOracleAddress = (
  deployments.fallbackPriceOracle ?? ZERO_ADDRESS
) as Address;
const rateModelAddress = deployments.interestRateModel as Address;
const poolAbi = lendingPoolAbi as Abi;
const oracleAbi = mockPriceOracleAbi as Abi;
const rateAbi = interestRateModelAbi as Abi;
const tokenAbi = erc20Abi as Abi;
const indexedBalanceAbi = parseAbi([
  "function scaledBalanceOf(address account) view returns (uint256)",
]);

function projectedIndex(
  storedIndex: bigint,
  ratePerSecond: bigint,
  lastUpdateTimestamp: bigint,
  nowSeconds: bigint,
) {
  if (nowSeconds <= lastUpdateTimestamp || ratePerSecond === 0n) {
    return storedIndex;
  }
  const elapsed = nowSeconds - lastUpdateTimestamp;
  const growth = RAY_BIGINT + ratePerSecond * elapsed;
  return (storedIndex * growth) / RAY_BIGINT;
}

function resultAt(data: unknown, index: number) {
  if (!Array.isArray(data)) {
    return undefined;
  }

  return (data[index] as { result?: unknown } | undefined)?.result;
}

function entryAt(data: unknown, index: number) {
  if (!Array.isArray(data)) {
    return undefined;
  }

  return data[index] as
    | { status?: string; result?: unknown }
    | undefined;
}

function bigintResult(value: unknown) {
  if (typeof value === "bigint") return value;
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    try {
      return BigInt(value);
    } catch {
      return 0n;
    }
  }
  return 0n;
}

/**
 * Mirrors LendingPool._getPrice: prefer primary when price > 0 and 8 decimals,
 * otherwise use the fallback oracle.
 */
function resolveOraclePrice(
  primaryTuple: readonly [bigint, number] | undefined,
  fallbackTuple: readonly [bigint, number] | undefined,
): { price: bigint; priceDecimals: number } {
  const primaryPrice = bigintResult(primaryTuple?.[0]);
  const primaryDecimals = Number(primaryTuple?.[1] ?? 0);
  if (primaryPrice > 0n && primaryDecimals === 8) {
    return { price: primaryPrice, priceDecimals: 8 };
  }

  const fallbackPrice = bigintResult(fallbackTuple?.[0]);
  const fallbackDecimals = Number(fallbackTuple?.[1] ?? 8);
  if (fallbackPrice > 0n && fallbackDecimals === 8) {
    return { price: fallbackPrice, priceDecimals: 8 };
  }

  return { price: 0n, priceDecimals: 8 };
}

function annualizedPercent(ratePerSecond?: bigint) {
  if (!ratePerSecond) {
    return 0;
  }

  return (Number(ratePerSecond) / RAY) * SECONDS_PER_YEAR * 100;
}

function formatRate(value: number) {
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function assetToUsd(amount: bigint, price: bigint) {
  return (amount * price) / ASSET_UNIT;
}

export function useLiveMarkets(
  activeAssetAddresses?: ReadonlySet<string>,
) {
  const { address } = useArcLendAccount();
  const account = address ?? ZERO_ADDRESS;
  const [nowSeconds, setNowSeconds] = useState(() =>
    BigInt(Math.floor(Date.now() / 1_000)),
  );
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowSeconds(BigInt(Math.floor(Date.now() / 1_000)));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const activeDefinitions = useMemo(
    () =>
      activeAssetAddresses
        ? marketDefinitions.filter((market) =>
            activeAssetAddresses.has(market.address.toLowerCase()),
          )
        : marketDefinitions,
    [activeAssetAddresses],
  );

  const hasFallbackOracle =
    fallbackPriceOracleAddress !== ZERO_ADDRESS &&
    fallbackPriceOracleAddress.toLowerCase() !==
      priceOracleAddress.toLowerCase();

  const baseReads = useReadContracts({
    contracts: [
      ...activeDefinitions.flatMap((market) => [
        {
          chainId: 5042002,
          address: lendingPoolAddress,
          abi: poolAbi,
          functionName: "getReserveData" as const,
          args: [market.address],
        },
        {
          chainId: 5042002,
          address: priceOracleAddress,
          abi: oracleAbi,
          functionName: "getPrice" as const,
          args: [market.address],
        },
        {
          chainId: 5042002,
          // When no distinct fallback is configured, re-read primary so the
          // slot stays populated without inventing a zero address call.
          address: hasFallbackOracle
            ? fallbackPriceOracleAddress
            : priceOracleAddress,
          abi: oracleAbi,
          functionName: "getPrice" as const,
          args: [market.address],
        },
        {
          chainId: 5042002,
          address: market.aToken,
          abi: tokenAbi,
          functionName: "balanceOf" as const,
          args: [account],
        },
        {
          chainId: 5042002,
          address: market.aToken,
          abi: indexedBalanceAbi,
          functionName: "scaledBalanceOf" as const,
          args: [account],
        },
        {
          chainId: 5042002,
          address: market.debtToken,
          abi: tokenAbi,
          functionName: "balanceOf" as const,
          args: [account],
        },
        {
          chainId: 5042002,
          address: market.debtToken,
          abi: indexedBalanceAbi,
          functionName: "scaledBalanceOf" as const,
          args: [account],
        },
        {
          chainId: 5042002,
          address: lendingPoolAddress,
          abi: poolAbi,
          functionName: "supplyCaps" as const,
          args: [market.address],
        },
        {
          chainId: 5042002,
          address: lendingPoolAddress,
          abi: poolAbi,
          functionName: "borrowCaps" as const,
          args: [market.address],
        },
        {
          chainId: 5042002,
          address: market.address,
          abi: tokenAbi,
          functionName: "balanceOf" as const,
          args: [lendingPoolAddress],
        },
      ]),
      {
        chainId: 5042002,
        address: lendingPoolAddress,
        abi: poolAbi,
        functionName: "paused" as const,
      },
    ],
    allowFailure: true,
    query: {
      enabled:
        lendingPoolAddress !== ZERO_ADDRESS &&
        priceOracleAddress !== ZERO_ADDRESS &&
        rateModelAddress !== ZERO_ADDRESS,
      refetchInterval: 4_000,
    },
  });

  const reserves = useMemo(
    () =>
      activeDefinitions.map((_, index) =>
        mapReserveData(resultAt(baseReads.data, index * CALLS_PER_MARKET)),
      ),
    [activeDefinitions, baseReads.data],
  );

  const rateReads = useReadContracts({
    contracts: activeDefinitions.flatMap((_, index) => {
      const reserve = reserves[index];
      const args = [reserve?.totalBorrowed ?? 0n, reserve?.totalLiquidity ?? 0n] as const;

      return [
        {
          chainId: 5042002,
          address: rateModelAddress,
          abi: rateAbi,
          functionName: "calculateSupplyRate" as const,
          args,
        },
        {
          chainId: 5042002,
          address: rateModelAddress,
          abi: rateAbi,
          functionName: "calculateBorrowRate" as const,
          args,
        },
      ];
    }),
    allowFailure: true,
    query: {
      enabled: reserves.every(Boolean) && rateModelAddress !== ZERO_ADDRESS,
      refetchInterval: 4_000,
    },
  });

  const markets = useMemo(
    () =>
      activeDefinitions.map((definition, index): MarketAsset => {
        const offset = index * CALLS_PER_MARKET;
        const reserve = reserves[index];
        const primaryPriceTuple = resultAt(baseReads.data, offset + 1) as
          | readonly [bigint, number]
          | undefined;
        const fallbackPriceTuple = resultAt(baseReads.data, offset + 2) as
          | readonly [bigint, number]
          | undefined;
        const { price, priceDecimals } = resolveOraclePrice(
          primaryPriceTuple,
          fallbackPriceTuple,
        );
        const totalSupply = reserve?.totalLiquidity ?? 0n;
        const totalBorrow = reserve?.totalBorrowed ?? 0n;
        const accountingAvailable =
          totalSupply > totalBorrow ? totalSupply - totalBorrow : 0n;
        const poolCash = bigintResult(resultAt(baseReads.data, offset + 9));
        // Borrow/withdraw capacity is limited by actual pool cash, not only
        // accounting (totalLiquidity - totalBorrowed).
        const availableLiquidity =
          accountingAvailable < poolCash ? accountingAvailable : poolCash;
        const supplyApyValue = annualizedPercent(
          resultAt(rateReads.data, index * 2) as bigint | undefined,
        );
        const borrowAprValue = annualizedPercent(
          resultAt(rateReads.data, index * 2 + 1) as bigint | undefined,
        );
        const supplyRate =
          bigintResult(resultAt(rateReads.data, index * 2));
        const borrowRate =
          bigintResult(resultAt(rateReads.data, index * 2 + 1));
        const settledUserSupply =
          bigintResult(resultAt(baseReads.data, offset + 3));
        const scaledUserSupply =
          bigintResult(resultAt(baseReads.data, offset + 4));
        const settledUserDebt =
          bigintResult(resultAt(baseReads.data, offset + 5));
        const scaledUserDebt =
          bigintResult(resultAt(baseReads.data, offset + 6));
        const projectedLiquidityIndex = reserve
          ? projectedIndex(
              reserve.liquidityIndex,
              supplyRate,
              reserve.lastUpdateTimestamp,
              nowSeconds,
            )
          : RAY_BIGINT;
        const projectedBorrowIndex = reserve
          ? projectedIndex(
              reserve.borrowIndex,
              borrowRate,
              reserve.lastUpdateTimestamp,
              nowSeconds,
            )
          : RAY_BIGINT;
        const userSupply =
          (scaledUserSupply * projectedLiquidityIndex) / RAY_BIGINT;
        const userDebt =
          (scaledUserDebt * projectedBorrowIndex) / RAY_BIGINT;
        const supplyCap = bigintResult(resultAt(baseReads.data, offset + 7));
        const borrowCap = bigintResult(resultAt(baseReads.data, offset + 8));
        const isSupplyCapped = supplyCap > 0n;
        const isBorrowCapped = borrowCap > 0n;
        const remainingSupplyCap = isSupplyCapped
          ? supplyCap > totalSupply
            ? supplyCap - totalSupply
            : 0n
          : 0n;
        const remainingBorrowCap = isBorrowCapped
          ? borrowCap > totalBorrow
            ? borrowCap - totalBorrow
            : 0n
          : 0n;

        return {
          ...definition,
          price,
          priceDecimals,
          supplyApy: formatRate(supplyApyValue),
          supplyApyValue,
          borrowApr: formatRate(borrowAprValue),
          borrowAprValue,
          totalSupply,
          totalBorrow,
          availableLiquidity,
          poolCash,
          totalSupplyUsd: assetToUsd(totalSupply, price),
          totalBorrowUsd: assetToUsd(totalBorrow, price),
          availableLiquidityUsd: assetToUsd(availableLiquidity, price),
          poolCashUsd: assetToUsd(poolCash, price),
          supplyCap,
          borrowCap,
          supplyCapUsd: assetToUsd(supplyCap, price),
          borrowCapUsd: assetToUsd(borrowCap, price),
          remainingSupplyCap,
          remainingBorrowCap,
          remainingSupplyCapUsd: assetToUsd(remainingSupplyCap, price),
          remainingBorrowCapUsd: assetToUsd(remainingBorrowCap, price),
          isSupplyCapped,
          isBorrowCapped,
          utilization:
            totalSupply > 0n ? (Number(totalBorrow) / Number(totalSupply)) * 100 : 0,
          ltv: reserve?.ltv ?? 0,
          liquidationThreshold: reserve?.liquidationThreshold ?? 0,
          liquidationBonus: reserve?.liquidationBonus ?? 0,
          isActive: reserve?.isActive ?? false,
          isBorrowingEnabled: reserve?.isBorrowingEnabled ?? false,
          isCollateralEnabled: reserve?.isCollateralEnabled ?? false,
          settledUserSupply,
          userSupply,
          accruedSupply:
            userSupply > settledUserSupply
              ? userSupply - settledUserSupply
              : 0n,
          settledUserDebt,
          userDebt,
          accruedBorrowInterest:
            userDebt > settledUserDebt ? userDebt - settledUserDebt : 0n,
          accrualUpdatedAt: reserve?.lastUpdateTimestamp ?? 0n,
        };
      }),
    [
      activeDefinitions,
      baseReads.data,
      nowSeconds,
      rateReads.data,
      reserves,
    ],
    // reserves is already stable from its own useMemo above
  );

  // Treat as failed only when critical slots fail. A stale primary oracle is
  // expected and must not surface as a market-load error if fallback works.
  const baseFailed =
    Array.isArray(baseReads.data) &&
    activeDefinitions.some((_, index) => {
      const offset = index * CALLS_PER_MARKET;
      const reserveFailed = entryAt(baseReads.data, offset)?.status === "failure";
      const primaryOk =
        entryAt(baseReads.data, offset + 1)?.status === "success";
      const fallbackOk =
        entryAt(baseReads.data, offset + 2)?.status === "success";
      const priceFailed = !primaryOk && !fallbackOk;
      const tokenReadsFailed = [3, 4, 5, 6].some(
        (slot) => entryAt(baseReads.data, offset + slot)?.status === "failure",
      );
      // Caps are non-critical for core market math; default to 0 (uncapped view).
      return reserveFailed || priceFailed || tokenReadsFailed;
    });
  const ratesFailed = Array.isArray(rateReads.data)
    && rateReads.data.some((entry) => entry.status === "failure");

  return {
    markets,
    isPaused: Boolean(
      resultAt(baseReads.data, activeDefinitions.length * CALLS_PER_MARKET),
    ),
    // Use isLoading (pending + fetching), not isPending alone. Disabled rate
    // queries stay isPending forever with no data (TanStack Query v5).
    isLoading: baseReads.isLoading || rateReads.isLoading,
    isError: baseReads.isError || rateReads.isError || baseFailed || ratesFailed,
    refetch: async () => {
      await Promise.all([baseReads.refetch(), rateReads.refetch()]);
    },
  };
}
