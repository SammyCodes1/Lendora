"use client";

import { useCallback, useEffect, useState } from "react";
import { parseAbi, parseAbiItem, type Address } from "viem";
import { usePublicClient } from "wagmi";
import deployments from "@/constants/deployments.json";
import {
  PRIMARY_DOMAIN_CHANGED_EVENT,
  type PrimaryDomainChangedDetail,
} from "@/lib/domainEvents";

const walletDomainAddress = deployments.WalletDomain as Address;
const displayDomainSuffix = ".arclend";
const deploymentBlock = BigInt(
  (
    deployments as {
      deploymentBlock: number;
      walletDomainDeploymentBlock?: number;
    }
  ).walletDomainDeploymentBlock ?? deployments.deploymentBlock,
);
const logBlocksPerRequest = 9_500n;
const domainMintedEvent = parseAbiItem(
  "event DomainMinted(address indexed owner, string domainName, uint256 indexed tokenId)",
);
const domainAbi = parseAbi([
  "function primaryDomainOf(address owner) view returns (string)",
  "event DomainMinted(address indexed owner, string domainName, uint256 indexed tokenId)",
]);

function primaryDomainStorageKey(address: string) {
  return `arclend:primary:${address.toLowerCase()}`;
}

export function displayDomainName(name: string) {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/\.(?:arclend|arc)$/, "");
  return normalized ? `${normalized}${displayDomainSuffix}` : "";
}

export function usePrimaryDomain(address?: Address) {
  const publicClient = usePublicClient({ chainId: 5042002 });
  const [primaryDomain, setPrimaryDomain] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!address || !publicClient) {
      setPrimaryDomain(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const primary = (await publicClient.readContract({
        address: walletDomainAddress,
        abi: domainAbi,
        functionName: "primaryDomainOf",
        args: [address],
      })) as string;
      const displayName = primary ? displayDomainName(primary) : null;
      setPrimaryDomain(displayName);
      if (displayName) {
        window.localStorage.setItem(
          primaryDomainStorageKey(address),
          displayName,
        );
      } else {
        window.localStorage.removeItem(primaryDomainStorageKey(address));
      }
      setIsLoading(false);
      return;
    } catch {
      // Continue to the legacy event-log lookup for older deployments.
    }

    try {
      const latestBlock = await publicClient.getBlockNumber();
      let toBlock = latestBlock;

      while (toBlock >= deploymentBlock) {
        const earliestBlockInChunk = toBlock - logBlocksPerRequest + 1n;
        const fromBlock =
          earliestBlockInChunk > deploymentBlock
            ? earliestBlockInChunk
            : deploymentBlock;
        const logs = await publicClient.getLogs({
          address: walletDomainAddress,
          event: domainMintedEvent,
          args: { owner: address },
          fromBlock,
          toBlock,
        });

        if (logs.length > 0) {
          const name = logs[logs.length - 1].args.domainName;
          const displayName = name ? displayDomainName(name) : null;
          setPrimaryDomain(displayName);
          return;
        }

        if (fromBlock === deploymentBlock) break;
        toBlock = fromBlock - 1n;
      }

      const cached = window.localStorage.getItem(
        primaryDomainStorageKey(address),
      );
      setPrimaryDomain(cached ? displayDomainName(cached) : null);
    } catch {
      const cached = window.localStorage.getItem(
        primaryDomainStorageKey(address),
      );
      setPrimaryDomain(cached ? displayDomainName(cached) : null);
    } finally {
      setIsLoading(false);
    }
  }, [address, publicClient]);

  useEffect(() => {
    if (address) {
      const cached = window.localStorage.getItem(
        primaryDomainStorageKey(address),
      );
      setPrimaryDomain(cached ? displayDomainName(cached) : null);
    } else {
      setPrimaryDomain(null);
    }
    void refetch();

    const handlePrimaryDomainChanged = (event: Event) => {
      const detail = (event as CustomEvent<PrimaryDomainChangedDetail>).detail;
      if (!address) return;
      if (detail.address.toLowerCase() !== address.toLowerCase()) return;
      setPrimaryDomain(detail.domain ? displayDomainName(detail.domain) : null);
      void refetch();
    };

    window.addEventListener(
      PRIMARY_DOMAIN_CHANGED_EVENT,
      handlePrimaryDomainChanged,
    );
    return () =>
      window.removeEventListener(
        PRIMARY_DOMAIN_CHANGED_EVENT,
        handlePrimaryDomainChanged,
      );
  }, [address, refetch]);

  return { primaryDomain, isLoading, refetch };
}
