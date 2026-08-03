"use client";

import type { Address } from "viem";
import { useAccount } from "wagmi";
import { useCircleEmailWallet } from "@/components/wallet/CircleEmailWalletProvider";

export function useArcLendAccount() {
  const wagmi = useAccount();
  const emailWallet = useCircleEmailWallet();
  const emailAddress = emailWallet.wallet?.address as Address | undefined;
  const address = wagmi.isConnected ? wagmi.address : emailAddress;

  return {
    address,
    isConnected: Boolean(wagmi.isConnected || emailWallet.isConnected),
    source: wagmi.isConnected ? "wallet" : emailWallet.isConnected ? "email" : null,
    wagmi,
    emailWallet,
  };
}
