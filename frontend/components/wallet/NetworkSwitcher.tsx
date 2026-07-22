"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { useChainId, useSwitchChain } from "wagmi";
import { useDismissibleDropdown } from "@/hooks/useDismissibleDropdown";
import { cn } from "@/lib/utils";

const networkNames: Record<number, string> = {
  5042002: "Arc Testnet",
  11155111: "Ethereum Sepolia",
  84532: "Base Sepolia",
  80002: "Polygon Amoy",
};

function NetworkLogo({
  chainId,
  className = "h-4 w-4",
}: {
  chainId: number;
  className?: string;
}) {
  if (chainId === 5042002) {
    return (
      <span className={cn("inline-flex items-center justify-center rounded-full bg-[#1a1d24] p-0.5", className)}>
        <svg className="h-full w-full" viewBox="0 0 31 32" fill="none" aria-label="Arc">
          <path
            d="M0 32C.26 24.17 1.59 16.85 3.82 11.17 6.64 3.97 10.73 0 15.32 0s8.68 3.97 11.5 11.17c1.47 3.75 2.55 8.2 3.19 13.04.06.43.11.87.16 1.31.02.03.03.05.02.07 0 0 .38 2.34.46 6.41h-.04c-.56-.46-7.14-5.61-18.04-4.12.16-1.84.39-3.63.68-5.34l.05-.26c4.28-.13 8.02.37 10.89 1.02l-.03-.21c-.59-3.66-1.46-7.01-2.58-9.88-1.84-4.68-4.23-7.59-6.25-7.59s-4.41 2.91-6.25 7.59c-.44 1.13-.85 2.34-1.21 3.62-.51 1.79-.94 3.7-1.28 5.71-.51 2.97-.82 6.16-.94 9.46H0Z"
            fill="white"
          />
        </svg>
      </span>
    );
  }

  if (chainId === 11155111) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-label="Ethereum">
        <path d="M12 2 5.8 12.2 12 15.8l6.2-3.6L12 2Z" fill="#8C8CFF" />
        <path d="m12 17-6.2-3.6L12 22l6.2-8.6L12 17Z" fill="#6262D9" />
        <path d="M12 2v13.8l6.2-3.6L12 2Z" fill="#6F6FEA" />
      </svg>
    );
  }

  if (chainId === 84532) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-label="Base">
        <circle cx="12" cy="12" r="10" fill="#0052FF" />
        <path d="M6.4 12A5.6 5.6 0 0 1 17.5 10.9h-3.1A2.8 2.8 0 1 0 14.4 13h3.1A5.6 5.6 0 0 1 6.4 12Z" fill="white" />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-label="Polygon">
      <path
        d="m8.3 9.1 2.5-1.5a2.4 2.4 0 0 1 2.4 0l2.5 1.5a2.4 2.4 0 0 1 1.2 2.1v2.9l2.2-1.3v-2.9L16.6 8.4a2.4 2.4 0 0 0-2.4 0l-2.5 1.5a2.4 2.4 0 0 0-1.2 2.1v2.9l-2.2 1.3-2.2-1.3V12l2.2-1.3 1.3.8V8.9L9.5 8a2.4 2.4 0 0 0-2.4 0l-2.5 1.5a2.4 2.4 0 0 0-1.2 2.1v2.9a2.4 2.4 0 0 0 1.2 2.1l2.5 1.5a2.4 2.4 0 0 0 2.4 0l2.5-1.5a2.4 2.4 0 0 0 1.2-2.1v-2.9l2.2-1.3 2.2 1.3v2.9l-2.2 1.3-1.3-.8v2.6l.1.1a2.4 2.4 0 0 0 2.4 0l2.5-1.5a2.4 2.4 0 0 0 1.2-2.1v-2.9a2.4 2.4 0 0 0-1.2-2.1l-2.5-1.5a2.4 2.4 0 0 0-2.4 0l-2.5 1.5a2.4 2.4 0 0 0-1.2 2.1v2.9l-2.2 1.3-2.2-1.3v-2.9l2.2-1.3Z"
        fill="#8247E5"
      />
    </svg>
  );
}

export function NetworkSwitcher({ mobile = false }: { mobile?: boolean }) {
  const [open, setOpen] = useState(false);
  const closeDropdown = useCallback(() => setOpen(false), []);
  const containerRef = useDismissibleDropdown(open, closeDropdown);
  const chainId = useChainId();
  const { chains, switchChain, isPending } = useSwitchChain();
  const currentName = networkNames[chainId] ?? `Chain ${chainId}`;

  return (
    <div ref={containerRef} className={cn("relative", mobile && "w-full")}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 px-2 py-2 text-xs text-white/65 transition hover:text-white",
          mobile && "min-h-10 w-full justify-between rounded-lg border border-white/10 bg-white/[0.045] px-3 hover:bg-white/[0.075]",
        )}
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <NetworkLogo chainId={chainId} className="h-5 w-5" />}
        <span>{currentName}</span>
        <ChevronDown className="h-3.5 w-3.5 text-white/40" />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            role="menu"
            initial={{ y: 7, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 7, scale: 0.98 }}
            className={cn(
              "absolute z-50 mt-2 min-w-56 rounded-lg border border-white/15 bg-[#090b0d] p-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.75)]",
              mobile ? "left-0 right-0" : "right-0",
            )}
          >
            {chains.map((chain) => {
              const active = chain.id === chainId;

              return (
                <button
                  key={chain.id}
                  type="button"
                  onClick={() => {
                    switchChain({ chainId: chain.id });
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm text-white/65 transition hover:bg-white/[0.07] hover:text-white"
                >
                  <span className="flex items-center gap-3">
                    <NetworkLogo chainId={chain.id} className="h-5 w-5" />
                    {networkNames[chain.id] ?? chain.name}
                  </span>
                  {active ? <Check className="h-4 w-4 text-emerald-200" /> : null}
                </button>
              );
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
