"use client";

import { Gift } from "lucide-react";
import { PageTransition } from "@/components/layout/PageTransition";
import { PageHeader } from "@/components/layout/PageHeader";
import { ReferralPanel } from "@/components/features/ReferralPanel";
import { GlassCard } from "@/components/ui/GlassCard";
import { useEarnVaultMarkets } from "@/hooks/useEarnVaults";

export default function ReferralsPage() {
  const earnVaults = useEarnVaultMarkets();
  const claimableRewards = earnVaults.markets.reduce(
    (sum, market) => sum + Number(market.pendingReferralRewards) / 1_000_000,
    0,
  );

  return (
    <PageTransition>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={<Gift />}
          title="Referrals"
          description="Share Lendora Earn Vaults and track wallet-level points, USDC rewards, and EURC rewards in one incentives surface."
          stats={[
            {
              label: "Pending points",
              value: earnVaults.referral.pendingPoints.toLocaleString(),
              tone: "positive",
            },
            {
              label: "Claimable rewards",
              value: `$${claimableRewards.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}`,
              tone: "positive",
            },
          ]}
        />

        <div className="grid gap-6 lg:grid-cols-[0.72fr_1.28fr]">
          <GlassCard className="p-5">
            <div>
              <div>
                <h2 className="text-lg font-semibold text-white">Rewards Flow</h2>
                <div className="mt-4 grid gap-2 text-sm text-white/58">
                  {[
                    "Share your referral link or .arclend identity.",
                    "Vault deposits record volume, level, and points on-chain.",
                    "USDC and EURC deposits accrue matching token rewards.",
                  ].map((item, index) => (
                    <div
                      key={item}
                      className="flex gap-3 rounded-md border border-white/[0.08] bg-black/15 p-3"
                    >
                      <span className="font-mono text-white/34">0{index + 1}</span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-5 grid gap-3">
              {earnVaults.markets.map((market) => (
                <div
                  key={market.symbol}
                  className="rounded-md border border-white/[0.08] bg-black/15 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-white">{market.symbol}</span>
                    <span className="font-mono text-sm text-white/60">
                      {market.deployed ? "Live" : "Pending"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>

          <ReferralPanel
            referral={earnVaults.referral}
            markets={earnVaults.markets}
            onRefresh={earnVaults.refetch}
          />
        </div>
      </div>
    </PageTransition>
  );
}
