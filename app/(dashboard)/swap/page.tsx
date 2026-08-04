"use client";

import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import {
  ArrowDown,
  BadgeCheck,
  Coins,
  FileSignature,
  Route,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { PageTransition } from "@/components/layout/PageTransition";
import { PageHeader } from "@/components/layout/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";

const SwapWidget = dynamic(
  () =>
    import("@/components/features/SwapWidget").then(
      (module) => module.SwapWidget,
    ),
  { ssr: false, loading: () => <Skeleton height={620} /> },
);

const swapSteps = [
  {
    icon: FileSignature,
    label: "Approve",
    detail: "Your wallet authorizes the selected router to spend only the entered amount.",
    color: "text-white/55",
  },
  {
    icon: Route,
    label: "Submit",
    detail: "The swap transaction includes your token pair, minimum output, and slippage limit.",
    color: "text-white/55",
  },
  {
    icon: Coins,
    label: "Exchange",
    detail: "The pool receives the input token and calculates the output atomically on Arc.",
    color: "text-white/55",
  },
  {
    icon: BadgeCheck,
    label: "Settle",
    detail: "Output tokens arrive in your wallet when the transaction is confirmed.",
    color: "text-white/55",
  },
];

function OnchainSwapFlow() {
  return (
    <section className="glass-panel relative h-fit overflow-hidden rounded-2xl border-white/10 bg-white/[0.04] p-5 backdrop-blur-3xl">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
      <div className="relative">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-white/70" />
          <h2 className="font-display text-lg font-semibold text-white">
            How swaps work onchain
          </h2>
        </div>
        <p className="mt-2 text-sm leading-6 text-white/45">
          Quotes are compared across peer venues (including ArcLend&apos;s own
          USDC/EURC pool). You pick a route; one signed transaction settles
          output directly back to your wallet.
        </p>

        <div className="mt-6 flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 py-3">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-white/55" />
            <span className="text-xs text-white/60">Your wallet</span>
          </div>
          <motion.div
            className="h-2 w-2 rounded-full bg-white/80 shadow-[0_0_18px_rgba(255,255,255,0.55)]"
            animate={{ scale: [1, 1.65, 1], opacity: [0.45, 1, 0.45] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
          <span className="font-mono text-xs text-white/40">Arc Testnet</span>
        </div>

        <div className="relative mt-4">
          <div className="absolute bottom-8 left-[23px] top-8 w-px bg-white/15" />
          <motion.div
            aria-hidden="true"
            className="absolute left-[20px] top-8 z-20 h-2 w-2 rounded-full bg-white shadow-[0_0_16px_rgba(255,255,255,0.9)]"
            animate={{ y: [0, 249], opacity: [0, 1, 1, 0] }}
            transition={{
              duration: 4.8,
              repeat: Infinity,
              ease: "easeInOut",
              times: [0, 0.12, 0.88, 1],
            }}
          />

          <div className="space-y-3">
            {swapSteps.map((step, index) => {
              const Icon = step.icon;

              return (
                <motion.div
                  key={step.label}
                  className="relative z-10 flex gap-3 rounded-xl border border-white/[0.08] bg-black/40 backdrop-blur-xl p-3"
                  animate={{
                    borderColor: [
                      "rgba(255,255,255,0.08)",
                      "rgba(255,255,255,0.20)",
                      "rgba(255,255,255,0.08)",
                    ],
                  }}
                  transition={{
                    duration: 2.4,
                    repeat: Infinity,
                    delay: index * 1.15,
                  }}
                >
                  <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/40 ${step.color}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold text-white/30">
                        0{index + 1}
                      </span>
                      <p className="text-sm font-medium text-white">{step.label}</p>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-white/40">
                      {step.detail}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-4 py-3 text-xs text-white/65">
          <ArrowDown className="h-4 w-4" />
          Atomic settlement — either every step succeeds or none do
        </div>
      </div>
    </section>
  );
}

export default function SwapPage() {
  return (
    <PageTransition>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={<Route />}
          title="Swap"
          description="Exchange Arc stablecoins through a precise, transparent route with slippage and settlement visible before signing."
        />

        <div className="grid gap-5 lg:grid-cols-[1.08fr_0.92fr]">
          <SwapWidget />
          <OnchainSwapFlow />
        </div>
      </div>
    </PageTransition>
  );
}
