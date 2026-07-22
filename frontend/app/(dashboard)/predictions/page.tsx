"use client";

import { BarChart3, Bot, ShieldCheck } from "lucide-react";
import { PredictionMarkets } from "@/components/features/PredictionMarkets";
import { PageTransition } from "@/components/layout/PageTransition";
import { PageHeader } from "@/components/layout/PageHeader";

export default function PredictionsPage() {
  return (
    <PageTransition>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={<BarChart3 />}
          title="Predictions"
          description="Explore live binary markets and take YES or NO positions with Arc Testnet USDC."
          stats={[
            { label: "Market type", value: "Binary" },
            { label: "Collateral", value: "USDC", tone: "positive" },
          ]}
          actions={
            <>
              <div className="flex items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-xs text-white/45">
                <Bot className="h-4 w-4 text-cyan-200" />
                Ask the agent: “Predict 5 USDC YES on market 1”
              </div>
              <div className="flex items-center gap-2 rounded-md border border-amber-200/10 bg-amber-200/[0.04] px-3 py-2 text-xs text-amber-100/55">
                <ShieldCheck className="h-4 w-4" />
                External testnet contract
              </div>
            </>
          }
        />
        <PredictionMarkets />
      </div>
    </PageTransition>
  );
}
