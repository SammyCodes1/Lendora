"use client";

import { useMemo } from "react";
import type { Abi, Address } from "viem";
import { formatUnits } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import lendingPoolAbi from "@/constants/abis/LendingPool.json";
import deployments from "@/constants/deployments.json";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import {
  resultHash,
  useArcLendContractWrite,
} from "@/hooks/useArcLendContractWrite";
import { useTokenBalance } from "@/hooks/useTokenBalance";

export type ReserveData = {
  aToken: Address;
  debtToken: Address;
  underlyingAsset: Address;
  liquidityIndex: bigint;
  borrowIndex: bigint;
  lastUpdateTimestamp: bigint;
  totalLiquidity: bigint;
  totalBorrowed: bigint;
  ltv: number;
  liquidationThreshold: number;
  liquidationBonus: number;
  isActive: boolean;
  isBorrowingEnabled: boolean;
  isCollateralEnabled: boolean;
};

export type UserAccountData = {
  totalCollateralUSD: bigint;
  totalDebtUSD: bigint;
  availableBorrowsUSD: bigint;
  healthFactor: bigint;
};

const lendingPoolAddress = deployments.lendingPool as Address;
const abi = lendingPoolAbi as Abi;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

function bigintValue(value: unknown): bigint | null {
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
      return null;
    }
  }
  return null;
}

function addressValue(value: unknown): Address | null {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value)
    ? (value as Address)
    : null;
}

export function mapReserveData(data: unknown): ReserveData | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const reserve = data as Partial<ReserveData> & Record<number, unknown>;
  const aToken = addressValue(reserve.aToken ?? reserve[0]);
  const debtToken = addressValue(reserve.debtToken ?? reserve[1]);
  const underlyingAsset = addressValue(
    reserve.underlyingAsset ?? reserve[2],
  );
  const liquidityIndex = bigintValue(
    reserve.liquidityIndex ?? reserve[3],
  );
  const borrowIndex = bigintValue(reserve.borrowIndex ?? reserve[4]);
  const lastUpdateTimestamp = bigintValue(
    reserve.lastUpdateTimestamp ?? reserve[5],
  );
  const totalLiquidity = bigintValue(
    reserve.totalLiquidity ?? reserve[6],
  );
  const totalBorrowed = bigintValue(
    reserve.totalBorrowed ?? reserve[7],
  );

  if (
    !aToken ||
    !debtToken ||
    !underlyingAsset ||
    liquidityIndex === null ||
    borrowIndex === null ||
    lastUpdateTimestamp === null ||
    totalLiquidity === null ||
    totalBorrowed === null
  ) {
    return undefined;
  }

  return {
    aToken,
    debtToken,
    underlyingAsset,
    liquidityIndex,
    borrowIndex,
    lastUpdateTimestamp,
    totalLiquidity,
    totalBorrowed,
    ltv: Number(reserve.ltv ?? reserve[8]),
    liquidationThreshold: Number(reserve.liquidationThreshold ?? reserve[9]),
    liquidationBonus: Number(reserve.liquidationBonus ?? reserve[10]),
    isActive: Boolean(reserve.isActive ?? reserve[11]),
    isBorrowingEnabled: Boolean(reserve.isBorrowingEnabled ?? reserve[12]),
    isCollateralEnabled: Boolean(reserve.isCollateralEnabled ?? reserve[13]),
  };
}

function mapUserAccountData(data: unknown): UserAccountData | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const account = data as Partial<UserAccountData> & Record<number, unknown>;
  const totalCollateralUSD = bigintValue(
    account.totalCollateralUSD ?? account[0],
  );
  const totalDebtUSD = bigintValue(account.totalDebtUSD ?? account[1]);
  const availableBorrowsUSD = bigintValue(
    account.availableBorrowsUSD ?? account[2],
  );
  const healthFactor = bigintValue(account.healthFactor ?? account[3]);

  if (
    totalCollateralUSD === null ||
    totalDebtUSD === null ||
    availableBorrowsUSD === null ||
    healthFactor === null
  ) {
    return undefined;
  }

  return {
    totalCollateralUSD,
    totalDebtUSD,
    availableBorrowsUSD,
    healthFactor,
  };
}

export function useReservesList() {
  const result = useReadContract({
    chainId: 5042002,
    address: lendingPoolAddress,
    abi,
    functionName: "getReservesList",
    query: {
      enabled:
        lendingPoolAddress !==
        "0x0000000000000000000000000000000000000000",
      refetchInterval: 4_000,
    },
  });

  return {
    ...result,
    reserves: Array.isArray(result.data)
      ? (result.data as Address[])
      : [],
  };
}

export function useReserveData(asset: Address, enabled = true) {
  const result = useReadContracts({
    contracts: [
      {
        chainId: 5042002,
        address: lendingPoolAddress,
        abi,
        functionName: "getReserveData",
        args: [asset],
      },
    ],
    query: {
      enabled:
        enabled &&
        lendingPoolAddress !==
          "0x0000000000000000000000000000000000000000",
    },
  });

  return {
    ...result,
    reserveData: mapReserveData(result.data?.[0]?.result),
  };
}

export function useUserAccountData(user?: Address) {
  const result = useReadContract({
    chainId: 5042002,
    address: lendingPoolAddress,
    abi,
    functionName: "getUserAccountData",
    args: user ? [user] : undefined,
    query: {
      enabled: Boolean(user) && lendingPoolAddress !== "0x0000000000000000000000000000000000000000",
      refetchInterval: 4_000,
    },
  });

  return {
    ...result,
    accountData: mapUserAccountData(result.data),
  };
}

export function useSupplyAction() {
  const { address } = useArcLendAccount();
  const write = useArcLendContractWrite();

  return {
    txHash: write.txHash,
    isPending: write.isPending,
    isSuccess: write.isSuccess,
    error: write.error,
    supply: (asset: Address, amount: bigint, onBehalfOf: Address = address as Address) =>
      write.writeContractAsync({
        chainId: 5042002,
        address: lendingPoolAddress,
        abi,
        functionName: "supply",
        args: [asset, amount, onBehalfOf],
      }).then(resultHash),
  };
}

export function useWithdrawAction() {
  const { address } = useArcLendAccount();
  const write = useArcLendContractWrite();

  return {
    txHash: write.txHash,
    isPending: write.isPending,
    isSuccess: write.isSuccess,
    error: write.error,
    withdraw: (asset: Address, amount: bigint, to: Address = address as Address) =>
      write.writeContractAsync({
        chainId: 5042002,
        address: lendingPoolAddress,
        abi,
        functionName: "withdraw",
        args: [asset, amount, to],
      }).then(resultHash),
  };
}

export function useBorrowAction() {
  const { address } = useArcLendAccount();
  const write = useArcLendContractWrite();

  return {
    txHash: write.txHash,
    isPending: write.isPending,
    isSuccess: write.isSuccess,
    error: write.error,
    borrow: (asset: Address, amount: bigint, onBehalfOf: Address = address as Address) =>
      write.writeContractAsync({
        chainId: 5042002,
        address: lendingPoolAddress,
        abi,
        functionName: "borrow",
        args: [asset, amount, onBehalfOf],
      }).then(resultHash),
  };
}

export function useRepayAction() {
  const { address } = useArcLendAccount();
  const write = useArcLendContractWrite();

  return {
    txHash: write.txHash,
    isPending: write.isPending,
    isSuccess: write.isSuccess,
    error: write.error,
    repay: (asset: Address, amount: bigint, onBehalfOf: Address = address as Address) =>
      write.writeContractAsync({
        chainId: 5042002,
        address: lendingPoolAddress,
        abi,
        functionName: "repay",
        args: [asset, amount, onBehalfOf],
      }).then(resultHash),
  };
}

export function useLiquidateAction() {
  const write = useArcLendContractWrite();

  return {
    txHash: write.txHash,
    isPending: write.isPending,
    isSuccess: write.isSuccess,
    error: write.error,
    liquidate: (
      collateralAsset: Address,
      debtAsset: Address,
      user: Address,
      debtToCover: bigint,
      receiveAToken = false,
    ) =>
      write.writeContractAsync({
        chainId: 5042002,
        address: lendingPoolAddress,
        abi,
        functionName: "liquidate",
        // 5-arg overload settles collateral as aTokens when pool cash is thin.
        args: [collateralAsset, debtAsset, user, debtToCover, receiveAToken],
      }).then(resultHash),
  };
}

export function useUserBalance(token: Address, enabled = true) {
  const { address } = useArcLendAccount();
  const result = useTokenBalance({
    address,
    token: token === ZERO_ADDRESS ? undefined : token,
    chainId: 5042002,
    enabled: enabled && Boolean(address) && token !== ZERO_ADDRESS,
    refetchInterval: 4_000,
  });

  const formatted = useMemo(() => {
    if (!result.data) {
      return "0.00";
    }

    return Number(formatUnits(result.data.value, result.data.decimals)).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });
  }, [result.data]);

  /** Full-precision string for MAX inputs (no locale grouping). */
  const exact = useMemo(() => {
    if (!result.data) {
      return "0";
    }
    return formatUnits(result.data.value, result.data.decimals);
  }, [result.data]);

  return {
    ...result,
    balance: result.data?.value ?? 0n,
    formatted,
    exact,
  };
}
