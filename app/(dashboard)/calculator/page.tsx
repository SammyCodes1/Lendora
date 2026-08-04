"use client";

import { useState } from "react";
import { Calculator, PiggyBank, Sparkles, Heart } from "lucide-react";
import { PageTransition } from "@/components/layout/PageTransition";
import { PageHeader } from "@/components/layout/PageHeader";
import { ClientErrorBoundary } from "@/components/layout/ClientErrorBoundary";
import { LendingCalculator } from "@/components/calculator/LendingCalculator";
import { EarnCalculator } from "@/components/calculator/EarnCalculator";
import { HealthFactorCalculator } from "@/components/calculator/HealthFactorCalculator";
import { cn } from "@/lib/utils";

type Tab = "lending" | "earn" | "health";

const TABS: { id: Tab; label: string; icon: typeof Calculator }[] = [
  { id: "lending", label: "Lending", icon: PiggyBank },
  { id: "earn", label: "Earn Vault", icon: Sparkles },
  { id: "health", label: "Borrow Health Factor", icon: Heart },
];

const TAB_ICON_SIZE = "h-4 w-4";

export default function CalculatorPage() {
  const [activeTab, setActiveTab] = useState<Tab>("lending");

  return (
    <PageTransition>
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={<Calculator className={TAB_ICON_SIZE} />}
          title="Calculator"
          description="Project your returns and risk before you commit"
        />

        <div className="relative flex rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "relative flex-1 rounded-xl px-2 py-3 text-sm font-medium transition sm:px-4",
                activeTab === tab.id
                  ? "bg-white/[0.08] text-white"
                  : "text-white/40 hover:text-white/65",
              )}
            >
              <span className="flex items-center justify-center gap-1.5">
                <tab.icon className={TAB_ICON_SIZE} />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.label.split(" ")[0]}</span>
              </span>
            </button>
          ))}
        </div>

        <ClientErrorBoundary
          label="calculator panel"
          fallback={
            <div className="rounded-2xl border border-red-300/20 bg-red-400/[0.07] px-4 py-6 text-center text-sm text-red-100">
              Calculator panel failed to render. Refresh the page or try another
              tab.
            </div>
          }
        >
          {activeTab === "lending" ? (
            <LendingCalculator />
          ) : activeTab === "earn" ? (
            <EarnCalculator />
          ) : (
            <HealthFactorCalculator />
          )}
        </ClientErrorBoundary>
      </div>
    </PageTransition>
  );
}
