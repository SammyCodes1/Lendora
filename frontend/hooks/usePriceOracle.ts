"use client";

import type { Address } from "viem";
import { useReadContracts } from "wagmi";
import pythPriceOracleAbi from "@/constants/abis/PythPriceOracle.json";
import mockPriceOracleAbi from "@/constants/abis/MockPriceOracle.json";
import deployments from "@/constants/deployments.json";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Use PythPriceOracle when available, fall back to MockPriceOracle
const hasPythOracle = Boolean((deployments as any).PythPriceOracle);
const oracleAbi = hasPythOracle ? pythPriceOracleAbi : mockPriceOracleAbi;
const primaryOracle = (hasPythOracle
  ? (deployments as any).PythPriceOracle
  : deployments.priceOracle) as Address;
const fallbackOracle = (
  deployments.fallbackPriceOracle ?? ZERO_ADDRESS
) as Address;

function isValidPrice(
  value: unknown,
): value is readonly [bigint, number] {
  return (
    Array.isArray(value) &&
    typeof value[0] === "bigint" &&
    value[0] > 0n &&
    Number(value[1]) === 8
  );
}

/**
 * Resolves USD price the same way LendingPool._getPrice does:
 * primary oracle first, then fallback when primary is stale/zero/invalid.
 *
 * After Pyth integration, the primary oracle is PythPriceOracle (live prices)
 * and fallback is MockPriceOracle (deprecated, emergency use only).
 * The getPrice() interface is identical for both — (uint256, uint8).
 */
export function useAssetPrice(asset: Address) {
  const hasFallback =
    fallbackOracle !== ZERO_ADDRESS &&
    fallbackOracle.toLowerCase() !== primaryOracle.toLowerCase();

  // Both oracles implement the same getPrice(address) → (uint256, uint8)
  // interface, so we use the same ABI for the fallback call
  const fallbackAbi = hasPythOracle ? mockPriceOracleAbi : oracleAbi;

  const result = useReadContracts({
    contracts: [
      {
        chainId: 5042002,
        address: primaryOracle,
        abi: oracleAbi,
        functionName: "getPrice",
        args: [asset],
      },
      {
        chainId: 5042002,
        address: hasFallback ? fallbackOracle : primaryOracle,
        abi: hasFallback ? fallbackAbi : oracleAbi,
        functionName: "getPrice",
        args: [asset],
      },
    ],
    allowFailure: true,
    query: {
      enabled:
        primaryOracle !== ZERO_ADDRESS &&
        Boolean(asset) &&
        asset !== ZERO_ADDRESS,
      refetchInterval: 4_000,
    },
  });

  const primary = result.data?.[0];
  const fallback = result.data?.[1];
  const primaryResult =
    primary?.status === "success" ? primary.result : undefined;
  const fallbackResult =
    fallback?.status === "success" ? fallback.result : undefined;

  let price: bigint | undefined;
  let decimals: number | undefined;
  if (isValidPrice(primaryResult)) {
    price = primaryResult[0];
    decimals = 8;
  } else if (isValidPrice(fallbackResult)) {
    price = fallbackResult[0];
    decimals = 8;
  }

  const bothFailed =
    Boolean(result.data) &&
    primary?.status === "failure" &&
    fallback?.status === "failure";

  return {
    ...result,
    isError: result.isError || bothFailed,
    price,
    decimals,
    /** True when prices are sourced from Pyth Network live feeds */
    isPythOracle: hasPythOracle && primary?.status === "success" && isValidPrice(primaryResult),
  };
}
