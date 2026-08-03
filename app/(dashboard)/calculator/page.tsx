"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Calculator, PiggyBank, Sparkles, Heart } from "lucide-react";
import { PageTransition } from "@/components/layout/PageTransition";
import { PageHeader } from "@/components/layout/PageHeader";
import { LendingCalculator } from "@/components/calculator/LendingCalculator";
import { EarnCalculator } from "@/components/calculator/EarnCalculator";
import { HealthFactorCalculator } from "@/components/calculator/HealthFactorCalculator";

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

        {/* Tab bar with sliding underline */}
        <div className="relative flex rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex-1 rounded-xl px-2 py-3 text-sm font-medium transition sm:px-4 ${
                activeTab === tab.id
                  ? "text-white"
                  : "text-white/40 hover:text-white/65"
              }`}
            >
              <span className="flex items-center justify-center gap-1.5">
                <tab.icon className={TAB_ICON_SIZE} />
                <span className="hidden sm:inline">{tab.label}</span>
              </span>
              {activeTab === tab.id ? (
                <motion.div
                  layoutId="calculator-tab-underline"
                  className="absolute inset-x-1.5 bottom-1 h-0.5 rounded-full bg-white/85 shadow-[0_0_14px_rgba(255,255,255,0.45)]"
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
              ) : null}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {activeTab === "lending" ? (
              <LendingCalculator />
            ) : activeTab === "earn" ? (
              <EarnCalculator />
            ) : (
              <HealthFactorCalculator />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </PageTransition>
  );
}
