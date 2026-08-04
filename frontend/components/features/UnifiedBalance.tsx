"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Layers, RefreshCw } from "lucide-react";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { GlassCard } from "@/components/ui/GlassCard";
import { Skeleton } from "@/components/ui/Skeleton";
import { useUnifiedBalance } from "@/hooks/useAppKit";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import { useCloseOnResume } from "@/hooks/useCloseOnResume";

export function UnifiedBalance() {
  const balance = useUnifiedBalance();

  return (
    <GlassCard glowOnHover className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.06] p-2.5">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-semibold text-white">Unified USDC Balance</h2>
            <p className="mt-1 text-xs text-white/45">
              Wallet and Circle Gateway USDC across supported testnets
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label="Refresh unified balance"
          onClick={() => void balance.refresh()}
          className="rounded-lg border border-white/[0.08] bg-white/[0.04] p-2 text-white/45 transition hover:text-white"
        >
          <RefreshCw
            className={
              balance.status === "loading" ? "h-4 w-4 animate-spin" : "h-4 w-4"
            }
          />
        </button>
      </div>

      <div className="mt-5">
        <p className="text-xs uppercase text-white/40">Total USDC</p>
        {balance.status === "loading" ? (
          <Skeleton width={150} height={42} className="mt-2" />
        ) : (
          <p className="mt-1 font-mono text-3xl text-white">
            <AnimatedNumber value={balance.total} prefix="$" decimals={2} />
          </p>
        )}
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2 text-xs">
        {[
          ["Wallets", balance.walletTotal],
          ["Gateway", balance.gatewayTotal],
          ["Arc Wallet", balance.walletBreakdown.arc],
        ].map(([label, value]) => (
          <div
            key={label}
            className="min-w-0 rounded-xl border border-white/[0.08] bg-white/[0.035] p-3"
          >
            <p className="truncate text-white/40">{label}</p>
            <p className="mt-1 font-mono text-white">
              <AnimatedNumber value={Number(value)} prefix="$" decimals={2} />
            </p>
          </div>
        ))}
      </div>

      {balance.error ? (
        <p className="mt-3 text-xs text-red-300">{balance.error.message}</p>
      ) : null}
    </GlassCard>
  );
}

export function UnifiedBalanceChip() {
  const { isConnected } = useArcLendAccount();
  const balance = useUnifiedBalance();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const closeMenu = useCallback(() => setOpen(false), []);
  useCloseOnResume(closeMenu, open);

  useEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }

    const positionMenu = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const width = 256;
      setMenuPosition({
        top: rect.bottom + 8,
        left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
      });
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    positionMenu();
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open]);

  if (!isConnected) {
    return null;
  }

  const chains = [
    {
      name: "Arc Testnet",
      amount: balance.walletBreakdown.arc + balance.breakdown.arc,
    },
    {
      name: "Ethereum Sepolia",
      amount: balance.walletBreakdown.ethereum + balance.breakdown.ethereum,
    },
    {
      name: "Base Sepolia",
      amount: balance.walletBreakdown.base + balance.breakdown.base,
    },
    {
      name: "Polygon Amoy",
      amount: balance.walletBreakdown.polygon + balance.breakdown.polygon,
    },
  ];

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex touch-manipulation items-center gap-2 whitespace-nowrap rounded-full border border-white/[0.08] bg-white/[0.05] px-3 py-2 text-xs text-white/70 backdrop-blur-xl transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
        title={`Total USDC: ${balance.walletTotal.toFixed(2)} in wallets + ${balance.gatewayTotal.toFixed(2)} in Gateway`}
      >
        <Layers className="h-3.5 w-3.5" />
        <span className="hidden text-[10px] text-white/40 sm:inline">Total USDC</span>
        {balance.isLoading ? (
          <span className="inline-block h-3 w-12 animate-pulse rounded bg-white/10" />
        ) : (
          <span className="font-mono">
            <AnimatedNumber value={balance.total} prefix="$" decimals={2} />
          </span>
        )}
        <ChevronDown
          className={`h-3 w-3 text-white/35 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {typeof document !== "undefined" && open && menuPosition
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="fixed z-[1100] w-64 rounded-lg border border-white/10 bg-[#090b0d]/98 p-2 shadow-[0_24px_80px_rgba(0,0,0,0.8)] backdrop-blur-2xl"
              style={{ top: menuPosition.top, left: menuPosition.left }}
            >
              <div className="border-b border-white/[0.08] px-2 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35">
                  USDC by chain
                </p>
                <p className="mt-1 font-mono text-lg text-white">
                  {balance.total.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  USDC
                </p>
              </div>

              <div className="mt-1">
                {chains.map((chain) => (
                  <div
                    key={chain.name}
                    className="flex items-center justify-between gap-4 rounded-md px-2 py-2.5 text-xs hover:bg-white/[0.05]"
                  >
                    <span className="text-white/55">{chain.name}</span>
                    <span className="font-mono text-white">
                      {chain.amount.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      USDC
                    </span>
                  </div>
                ))}
              </div>
            </div>,
            document.body,
        )
        : null}
    </div>
  );
}
