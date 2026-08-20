"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowRightLeft, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";

const ARC_TESTNET_CHAIN_ID = 5042002;

function arcConfiguredStorageKey(address: string) {
  return `arclend:arc-network-configured:${address.toLowerCase()}`;
}

/**
 * Full-screen prompt shown only when a browser-wallet user has not yet
 * configured Arc Testnet in their wallet. Once Arc has been added / used
 * with this address, the prompt stays hidden — including when the user
 * intentionally switches away (e.g. bridging from Sepolia / Base / Amoy).
 *
 * Not rendered for email-wallet users since they don't control network
 * selection.
 */
export function WrongNetworkPrompt() {
  const { address, isConnected, connector } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Default true so we never flash the modal before reading storage / chain.
  const [arcConfigured, setArcConfigured] = useState(true);

  // Persist "Arc is in this wallet" once we've observed Arc Testnet for the
  // connected address. Multi-chain flows (bridge) can then leave Arc without
  // re-triggering the full-screen blocker.
  useEffect(() => {
    if (!address || typeof window === "undefined") {
      setArcConfigured(true);
      return;
    }

    const key = arcConfiguredStorageKey(address);

    if (chainId === ARC_TESTNET_CHAIN_ID) {
      window.localStorage.setItem(key, "1");
      setArcConfigured(true);
      return;
    }

    setArcConfigured(window.localStorage.getItem(key) === "1");
  }, [address, chainId]);

  const isWrongNetwork =
    isConnected &&
    Boolean(address) &&
    connector?.type !== "circle-email" &&
    chainId !== ARC_TESTNET_CHAIN_ID &&
    !arcConfigured;

  const handleSwitch = useCallback(async () => {
    if (!address) return;
    setSwitching(true);
    setError(null);
    try {
      await switchChainAsync({ chainId: ARC_TESTNET_CHAIN_ID });
      // Successful switch (or add-then-switch via EIP-3085) means Arc is
      // configured for this wallet — never block on multi-chain use again.
      window.localStorage.setItem(arcConfiguredStorageKey(address), "1");
      setArcConfigured(true);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Could not switch network";
      // "User rejected" is intentional, don't flag as an error.
      if (!/reject/i.test(message)) {
        setError(message);
      }
    } finally {
      setSwitching(false);
    }
  }, [address, switchChainAsync]);

  return (
    <AnimatePresence>
      {isWrongNetwork ? (
        <motion.div
          key="wrong-network"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/80 px-4 backdrop-blur-xl"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 24 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-md overflow-hidden rounded-2xl border border-white/[0.09] bg-white/[0.05] shadow-[0_40px_120px_rgba(0,0,0,0.62)] backdrop-blur-3xl"
          >
            {/* Accent bar */}
            <div className="h-1 w-full bg-gradient-to-r from-amber-500/80 via-orange-500/80 to-red-500/60" />

            <div className="flex flex-col items-center gap-5 px-6 py-8 text-center sm:px-8 sm:py-10">
              {/* Icon */}
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10">
                <AlertTriangle className="h-8 w-8 text-amber-400" />
              </div>

              {/* Copy */}
              <div className="space-y-2">
                <h2 className="text-xl font-semibold text-white">
                  Add Arc Testnet
                </h2>
                <p className="text-sm leading-relaxed text-white/55">
                  Lendora needs{" "}
                  <span className="font-medium text-white/80">
                    Arc Testnet
                  </span>{" "}
                  in your wallet. Switch once to add it — after that you can
                  freely change networks to bridge without seeing this again.
                  If Arc Testnet isn&apos;t added yet, your browser will prompt
                  you to add it automatically.
                </p>
              </div>

              {/* CTA */}
              <button
                type="button"
                disabled={switching}
                onClick={handleSwitch}
                className="inline-flex w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-3.5 text-sm font-semibold text-black shadow-[0_4px_24px_rgba(245,158,11,0.25)] transition hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
              >
                {switching ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Switching…
                  </>
                ) : (
                  <>
                    <ArrowRightLeft className="h-4 w-4" />
                    Switch to Arc Testnet
                  </>
                )}
              </button>

              {/* Error feedback */}
              {error ? (
                <p className="max-w-full truncate text-xs text-red-400/80">
                  {error}
                </p>
              ) : null}

              {/* Subtle hint */}
              <p className="text-[11px] text-white/30">
                Chain ID: {ARC_TESTNET_CHAIN_ID}
              </p>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
