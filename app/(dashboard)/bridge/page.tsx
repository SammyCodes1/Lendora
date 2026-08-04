"use client";

import dynamic from "next/dynamic";
import { ArrowLeftRight, Layers3 } from "lucide-react";
import { PageTransition } from "@/components/layout/PageTransition";
import { PageHeader } from "@/components/layout/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";

const BridgeWidget = dynamic(
  () => import("@/components/features/BridgeWidget").then((module) => module.BridgeWidget),
  { ssr: false, loading: () => <Skeleton height={470} /> },
);

const UnifiedBalance = dynamic(
  () => import("@/components/features/UnifiedBalance").then((module) => module.UnifiedBalance),
  { ssr: false, loading: () => <Skeleton height={380} /> },
);

export default function BridgePage() {
  return (
    <PageTransition>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={<ArrowLeftRight />}
          title="Bridge USDC"
          description="Move testnet USDC between Arc and supported networks, then inspect unified balances before returning to lending."
        />

        <div className="grid gap-5 lg:grid-cols-[1.08fr_0.92fr]">
          <BridgeWidget />
          <div className="space-y-5">
            <UnifiedBalance />
            <section className="rounded-lg border border-white/10 bg-[#0d1012]/85 p-5 backdrop-blur-2xl">
              <div className="flex items-center gap-3">
                <Layers3 className="h-5 w-5 text-cyan-200" />
                <h2 className="font-display text-lg font-semibold text-white">Supported routes</h2>
              </div>
              <div className="mt-4 grid gap-3 text-sm text-white/55">
                {["Ethereum Sepolia", "Base Sepolia", "Polygon Amoy", "Solana Devnet"].map((network) => (
                  <div key={network} className="flex items-center justify-between border-b border-white/[0.07] pb-3 last:border-0 last:pb-0">
                    <span>{network}</span>
                    <span className="font-mono text-white">USDC ↔ Arc</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
