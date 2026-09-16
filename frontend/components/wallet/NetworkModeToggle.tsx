"use client";

import { useCallback } from "react";
import { useActiveDeployment, ARC_TESTNET_CHAIN_ID, ARC_MAINNET_CHAIN_ID } from "@/hooks/useActiveDeployment";
import { cn } from "@/lib/utils";

export function NetworkModeToggle({ className, mobile = false }: { className?: string; mobile?: boolean }) {
  const { isMainnet, switchToNetwork } = useActiveDeployment();

  const handleToggle = useCallback(
    (target: "testnet" | "mainnet") => {
      const targetId = target === "mainnet" ? ARC_MAINNET_CHAIN_ID : ARC_TESTNET_CHAIN_ID;
      switchToNetwork(targetId);
    },
    [switchToNetwork],
  );

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-lg border border-white/10 bg-black/50 p-0.5 text-xs shadow-inner backdrop-blur-md",
        mobile ? "w-full justify-between" : "shrink-0",
        className,
      )}
      role="group"
      aria-label="Arc Network Environment Switcher"
    >
      <button
        type="button"
        onClick={() => handleToggle("testnet")}
        className={cn(
          "relative flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition-all duration-200",
          mobile && "flex-1",
          !isMainnet
            ? "bg-white/15 text-white shadow-sm"
            : "text-white/40 hover:text-white/70",
        )}
        title="Arc Testnet (Contracts Chain 5042002)"
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            !isMainnet ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]" : "bg-white/20",
          )}
        />
        <span>Testnet</span>
      </button>

      <button
        type="button"
        onClick={() => handleToggle("mainnet")}
        className={cn(
          "relative flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition-all duration-200",
          mobile && "flex-1",
          isMainnet
            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.2)]"
            : "text-white/40 hover:text-white/70",
        )}
        title="Arc Mainnet (Contracts Chain 5042)"
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            isMainnet ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse" : "bg-white/20",
          )}
        />
        <span>Mainnet</span>
      </button>
    </div>
  );
}
