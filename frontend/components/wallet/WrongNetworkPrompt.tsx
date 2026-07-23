"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowRightLeft, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";

const ARC_TESTNET_CHAIN_ID = 5042002;

/**
 * Full-screen prompt shown when a browser-wallet user is connected to a chain
 * other than Arc Testnet. Offers a single button that calls
 * `switchChainAsync` — the wallet will automatically ask the user to add the
 * network first if it isn't configured yet (standard EIP-3085 behaviour).
 *
 * Not rendered for email-wallet users since they don't control network
 * selection.
 */
export function WrongNetworkPrompt() {
  const { isConnected, connector } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only show for injected / browser-extension wallets that are on the wrong
  // chain.  Email wallets route through Circle and don't expose chain
  // switching.
  const isWrongNetwork =
    isConnected &&
    connector?.type !== "circle-email" &&
    chainId !== ARC_TESTNET_CHAIN_ID;

  const handleSwitch = useCallback(async () => {
    setSwitching(true);
    setError(null);
    try {
      await switchChainAsync({ chainId: ARC_TESTNET_CHAIN_ID });
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
  }, [switchChainAsync]);

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
                  Wrong Network
                </h2>
                <p className="text-sm leading-relaxed text-white/55">
                  ArcLend runs on{" "}
                  <span className="font-medium text-white/80">
                    Arc Testnet
                  </span>
                  . Switch your wallet to the correct network to continue. If
                  Arc Testnet isn&apos;t added to your wallet yet, your browser
                  will prompt you to add it automatically.
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
