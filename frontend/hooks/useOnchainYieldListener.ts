"use client";

import { useEffect } from "react";
import { usePublicClient } from "wagmi";
import { formatUnits, type Log } from "viem";
import deployments from "@/constants/deployments.json";
import lendingPoolAbi from "@/constants/abis/LendingPool.json";

const KNOWN_ASSETS: Record<string, string> = {
  [(deployments.markets?.USDC?.asset as string)?.toLowerCase()]: "USDC",
  [(deployments.markets?.EURC?.asset as string)?.toLowerCase()]: "EURC",
};

export function useOnchainYieldListener() {
  const publicClient = usePublicClient({ chainId: 5042 });

  useEffect(() => {
    if (!publicClient || !deployments.lendingPool) return;

    try {
      const unwatch = publicClient.watchContractEvent({
        address: deployments.lendingPool as `0x${string}`,
        abi: lendingPoolAbi,
        eventName: "Withdraw",
        poll: true,
        pollingInterval: 12_000,
        onLogs: (logs: Log[]) => {
          for (const log of logs) {
            const args = (log as unknown as {
              args: {
                asset?: string;
                user?: string;
                to?: string;
                amount?: bigint;
              };
            }).args;
            const assetAddr = args.asset?.toLowerCase() ?? "";
            const symbol = KNOWN_ASSETS[assetAddr] ?? "Tokens";
            const amountStr = args.amount
              ? formatUnits(args.amount, 6)
              : "Unknown";
            const txHash = log.transactionHash;
            const explorerUrl = txHash
              ? `https://explorer.arc.io/tx/${txHash}`
              : "";

            console.info(
              `[ArcLend Protocol] On-Chain Yield Claim / Withdrawal Event Detected:\n` +
                `  • Asset: ${amountStr} ${symbol}\n` +
                `  • User: ${args.user}\n` +
                `  • Recipient: ${args.to}\n` +
                `  • Transaction Hash: ${txHash}\n` +
                `  • Explorer: ${explorerUrl}`,
            );
          }
        },
        onError: (err) => {
          console.debug("[ArcLend Yield Watcher] Polling check:", err);
        },
      });

      return () => {
        unwatch();
      };
    } catch {
      // Ignore if transport doesn't support event listening
    }
  }, [publicClient]);
}
