"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import testnetDeployments from "@/constants/deployments-testnet.json";
import mainnetDeployments from "@/constants/deployments-mainnet.json";

export const ARC_TESTNET_CHAIN_ID = 5042002;
export const ARC_MAINNET_CHAIN_ID = 5042;

export function getActiveChainId(): number {
  if (typeof window === "undefined") return ARC_TESTNET_CHAIN_ID;
  const stored = window.localStorage.getItem("arclend:active-network-mode");
  if (stored === "5042") return ARC_MAINNET_CHAIN_ID;
  return ARC_TESTNET_CHAIN_ID;
}

export function setActiveChainId(chainId: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("arclend:active-network-mode", chainId.toString());
  window.dispatchEvent(new Event("arclend:network-mode-change"));
}

export function useActiveDeployment() {
  const { isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChain } = useSwitchChain();
  const [preferredChainId, setPreferredChainId] = useState<number>(() => getActiveChainId());

  useEffect(() => {
    setPreferredChainId(getActiveChainId());
    const handleUpdate = () => {
      setPreferredChainId(getActiveChainId());
    };
    window.addEventListener("arclend:network-mode-change", handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener("arclend:network-mode-change", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, []);

  const activeChainId = useMemo(() => {
    if (isConnected && (walletChainId === ARC_MAINNET_CHAIN_ID || walletChainId === ARC_TESTNET_CHAIN_ID)) {
      return walletChainId;
    }
    return preferredChainId;
  }, [isConnected, walletChainId, preferredChainId]);

  const isMainnet = activeChainId === ARC_MAINNET_CHAIN_ID;
  const deployment = isMainnet ? mainnetDeployments : testnetDeployments;

  const switchToNetwork = useCallback(
    (targetChainId: number) => {
      setActiveChainId(targetChainId);
      setPreferredChainId(targetChainId);
      try {
        switchChain({ chainId: targetChainId });
      } catch {
        // user rejected or wallet not connected
      }
    },
    [switchChain],
  );

  const toggleNetwork = useCallback(() => {
    const next = isMainnet ? ARC_TESTNET_CHAIN_ID : ARC_MAINNET_CHAIN_ID;
    switchToNetwork(next);
    return next;
  }, [isMainnet, switchToNetwork]);

  return {
    chainId: activeChainId,
    isMainnet,
    deployment,
    switchToNetwork,
    toggleNetwork,
  };
}
