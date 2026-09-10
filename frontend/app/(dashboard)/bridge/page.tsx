"use client";

import dynamic from "next/dynamic";
import {
  ArrowLeftRight,
  CheckCircle2,
  Route,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { PageTransition } from "@/components/layout/PageTransition";
import { PageHeader } from "@/components/layout/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";

const BridgeWidget = dynamic(
  () => import("@/components/features/BridgeWidget").then((module) => module.BridgeWidget),
  { ssr: false, loading: () => <Skeleton height={520} /> },
);

const UnifiedBalance = dynamic(
  () => import("@/components/features/UnifiedBalance").then((module) => module.UnifiedBalance),
  { ssr: false, loading: () => <Skeleton height={380} /> },
);

type RouteInfo = {
  name: string;
  chainKey: string;
  badge: string;
  speed: string;
  status: "live" | "fast";
};

const SUPPORTED_ROUTES: RouteInfo[] = [
  {
    name: "Arc Testnet",
    chainKey: "arc",
    badge: "Hub · Sub-second",
    speed: "< 1 sec",
    status: "fast",
  },
  {
    name: "Ethereum Sepolia",
    chainKey: "ethereum",
    badge: "Circle CCTP v2",
    speed: "~1–2 min",
    status: "live",
  },
  {
    name: "Base Sepolia",
    chainKey: "base",
    badge: "Circle CCTP v2",
    speed: "~1–2 min",
    status: "live",
  },
  {
    name: "Polygon Amoy",
    chainKey: "polygon",
    badge: "Circle CCTP v2",
    speed: "~1–2 min",
    status: "live",
  },
  {
    name: "Solana Devnet",
    chainKey: "solana",
    badge: "Circle CCTP v2",
    speed: "~1–2 min",
    status: "live",
  },
];

function RouteChainLogo({ chainKey }: { chainKey: string }) {
  if (chainKey === "arc") {
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#1a1d24] p-1 shrink-0 shadow-inner">
        <svg className="h-full w-full" viewBox="0 0 31 32" fill="none" aria-label="Arc">
          <path
            d="M0 32C.26 24.17 1.59 16.85 3.82 11.17 6.64 3.97 10.73 0 15.32 0s8.68 3.97 11.5 11.17c1.47 3.75 2.55 8.2 3.19 13.04.06.43.11.87.16 1.31.02.03.03.05.02.07 0 0 .38 2.34.46 6.41h-.04c-.56-.46-7.14-5.61-18.04-4.12.16-1.84.39-3.63.68-5.34l.05-.26c4.28-.13 8.02.37 10.89 1.02l-.03-.21c-.59-3.66-1.46-7.01-2.58-9.88-1.84-4.68-4.23-7.59-6.25-7.59s-4.41 2.91-6.25 7.59c-.44 1.13-.85 2.34-1.21 3.62-.51 1.79-.94 3.7-1.28 5.71-.51 2.97-.82 6.16-.94 9.46H0Z"
            fill="white"
          />
        </svg>
      </span>
    );
  }

  if (chainKey === "ethereum") {
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#627EEA]/20 p-1 shrink-0 shadow-inner">
        <svg className="h-full w-full" viewBox="0 0 24 24" fill="none" aria-label="Ethereum">
          <path d="M12 2 5.8 12.2 12 15.8l6.2-3.6L12 2Z" fill="#8C8CFF" />
          <path d="m12 17-6.2-3.6L12 22l6.2-8.6L12 17Z" fill="#6262D9" />
          <path d="M12 2v13.8l6.2-3.6L12 2Z" fill="#6F6FEA" />
        </svg>
      </span>
    );
  }

  if (chainKey === "base") {
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#0052FF]/20 p-1 shrink-0 shadow-inner">
        <svg className="h-full w-full" viewBox="0 0 24 24" fill="none" aria-label="Base">
          <circle cx="12" cy="12" r="10" fill="#0052FF" />
          <path d="M6.4 12A5.6 5.6 0 0 1 17.5 10.9h-3.1A2.8 2.8 0 1 0 14.4 13h3.1A5.6 5.6 0 0 1 6.4 12Z" fill="white" />
        </svg>
      </span>
    );
  }

  if (chainKey === "polygon") {
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#8247E5]/20 p-1 shrink-0 shadow-inner">
        <svg className="h-full w-full" viewBox="0 0 24 24" fill="none" aria-label="Polygon">
          <path
            d="m8.3 9.1 2.5-1.5a2.4 2.4 0 0 1 2.4 0l2.5 1.5a2.4 2.4 0 0 1 1.2 2.1v2.9l2.2-1.3v-2.9L16.6 8.4a2.4 2.4 0 0 0-2.4 0l-2.5 1.5a2.4 2.4 0 0 0-1.2 2.1v2.9l-2.2 1.3-2.2-1.3V12l2.2-1.3 1.3.8V8.9L9.5 8a2.4 2.4 0 0 0-2.4 0l-2.5 1.5a2.4 2.4 0 0 0-1.2 2.1v2.9a2.4 2.4 0 0 0 1.2 2.1l2.5 1.5a2.4 2.4 0 0 0 2.4 0l2.5-1.5a2.4 2.4 0 0 0 1.2-2.1v-2.9l2.2-1.3 2.2 1.3v2.9l-2.2 1.3-1.3-.8v2.6l.1.1a2.4 2.4 0 0 0 2.4 0l2.5-1.5a2.4 2.4 0 0 0 1.2-2.1v-2.9a2.4 2.4 0 0 0-1.2-2.1l-2.5-1.5a2.4 2.4 0 0 0-2.4 0l-2.5 1.5a2.4 2.4 0 0 0-1.2 2.1v2.9l-2.2 1.3-2.2-1.3v-2.9l2.2-1.3Z"
            fill="#8247E5"
          />
        </svg>
      </span>
    );
  }

  // Solana
  return (
    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#14F195]/20 p-1 shrink-0 shadow-inner">
      <svg className="h-full w-full" viewBox="0 0 397.7 311.7" fill="none" aria-label="Solana">
        <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" fill="#00FFA3" />
        <path d="M64.6 3.8C67 1.4 70.3 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" fill="#00FFA3" />
        <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" fill="#DC1FFF" />
      </svg>
    </span>
  );
}

export default function BridgePage() {
  return (
    <PageTransition>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3">
          <div className="inline-flex items-center gap-2 self-start rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 backdrop-blur-md">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span>Circle CCTP Protocol · Native Cross-Chain Liquidity</span>
          </div>

          <PageHeader
            icon={<ArrowLeftRight />}
            title="Bridge USDC"
            description="Move native testnet USDC between Arc and supported networks with 1:1 burn-and-mint settlement, zero slippage, and non-custodial browser wallet execution."
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.12fr_0.88fr] items-start">
          <BridgeWidget />

          <div className="space-y-6">
            <UnifiedBalance />

            {/* Supported Routes Board */}
            <section className="rounded-3xl border border-white/10 bg-[#0a0f12]/90 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl">
              <div className="flex items-center justify-between pb-4 border-b border-white/[0.08]">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-300">
                    <Route className="h-4 w-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-white tracking-wide">Supported CCTP Routes</h2>
                    <p className="text-[11px] text-white/45">Native burn & mint without wrapped risk</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  5 Chains Live
                </span>
              </div>

              <div className="mt-4 space-y-2.5">
                {SUPPORTED_ROUTES.map((route) => (
                  <div
                    key={route.chainKey}
                    className="group flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3 transition-colors hover:border-white/15 hover:bg-white/[0.05]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <RouteChainLogo chainKey={route.chainKey} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-white group-hover:text-emerald-300 transition-colors">
                            {route.name}
                          </span>
                          <span className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-white/50">
                            {route.badge}
                          </span>
                        </div>
                        <p className="text-[11px] text-white/40">USDC ↔ Arc Testnet</p>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="inline-block font-mono text-xs text-white/80">
                        {route.speed}
                      </span>
                      <p className="text-[10px] text-emerald-400/90 font-medium">1:1 Native</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.04] p-3.5 space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-emerald-200">
                  <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>CCTP Security & Execution Standard</span>
                </div>
                <p className="text-[11px] leading-relaxed text-white/50">
                  Native cross-chain USDC protocol by Circle. Tokens are cryptographically burned on the source network and minted on the destination network—eliminating pool slippage, wrapped liquidity, and third-party bridge custodial risk.
                </p>
                <div className="pt-1 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/60">
                    <Zap className="h-3 w-3 text-amber-300" /> Sub-second Arc Gas
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/60">
                    <Sparkles className="h-3 w-3 text-emerald-300" /> Zero Bridge Fee
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/60">
                    <CheckCircle2 className="h-3 w-3 text-emerald-300" /> Canonical USDC
                  </span>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
