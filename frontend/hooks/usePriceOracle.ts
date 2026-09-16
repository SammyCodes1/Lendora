"use client";

import type { Address } from "viem";
import { useReadContracts } from "wagmi";
import mockPriceOracleAbi from "@/constants/abis/MockPriceOracle.json";
import deployments from "@/constants/deployments.json";
import { useActiveDeployment } from "@/hooks/useActiveDeployment";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const oracleAbi = mockPriceOracleAbi;
const primaryOracle = deployments.priceOracle as Address;
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
 */
export function useAssetPrice(asset: Address) {
  const { deployment, chainId } = useActiveDeployment();
  const primaryOracleAddr = (deployment.priceOracle || primaryOracle) as Address;
  const fallbackOracleAddr = (deployment.fallbackPriceOracle ?? ZERO_ADDRESS) as Address;
  const hasFallback =
    fallbackOracleAddr !== ZERO_ADDRESS &&
    fallbackOracleAddr.toLowerCase() !== primaryOracleAddr.toLowerCase();

  const result = useReadContracts({
    contracts: [
      {
        chainId,
        address: primaryOracleAddr,
        abi: oracleAbi,
        functionName: "getPrice",
        args: [asset],
      },
      {
        chainId,
        address: hasFallback ? fallbackOracleAddr : primaryOracleAddr,
        abi: oracleAbi,
        functionName: "getPrice",
        args: [asset],
      },
    ],
    allowFailure: true,
    query: {
      enabled:
        primaryOracleAddr !== ZERO_ADDRESS &&
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
  };
}
