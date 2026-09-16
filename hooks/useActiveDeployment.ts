"use client";

import { useMemo, useCallback } from "react";
import { useSwitchChain } from "wagmi";
import mainnetDeployments from "@/constants/deployments-mainnet.json";

export const ARC_MAINNET_CHAIN_ID = 5042;
export const ARC_TESTNET_CHAIN_ID = 5042; // Aliased to mainnet for strict single-network stability

export function getActiveChainId(): number {
  return ARC_MAINNET_CHAIN_ID;
}

export function setActiveChainId(_chainId: number) {
  // Mainnet is canonical
}

export function useActiveDeployment() {
  const { switchChain } = useSwitchChain();

  const switchToNetwork = useCallback(
    (targetChainId: number = ARC_MAINNET_CHAIN_ID) => {
      try {
        switchChain({ chainId: targetChainId });
      } catch {
        // user rejected or wallet not connected
      }
    },
    [switchChain],
  );

  const toggleNetwork = useCallback(() => {
    switchToNetwork(ARC_MAINNET_CHAIN_ID);
    return ARC_MAINNET_CHAIN_ID;
  }, [switchToNetwork]);

  return {
    chainId: ARC_MAINNET_CHAIN_ID,
    isMainnet: true,
    deployment: mainnetDeployments,
    switchToNetwork,
    toggleNetwork,
  };
}
