"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import type { AgentTransactionReceipt } from "@/lib/agentTypes";

export function AgentTransactionReceiptCard({
  receipt,
}: {
  receipt: AgentTransactionReceipt;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
      className="relative mt-2 overflow-hidden rounded-2xl border border-emerald-200/20 bg-[linear-gradient(145deg,rgba(16,185,129,0.12),rgba(8,14,12,0.96)_52%,rgba(34,211,238,0.08))] p-3.5 shadow-[0_14px_42px_rgba(0,0,0,0.35)]"
    >
      {!reduceMotion ? (
        <>
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute -left-16 top-0 h-28 w-28 rounded-full bg-emerald-300/15 blur-3xl"
            animate={{ x: [0, 310, 0], opacity: [0.2, 0.55, 0.2] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          />
          {[18, 52, 84].map((left, index) => (
            <motion.span
              key={left}
              aria-hidden="true"
              className="pointer-events-none absolute bottom-2 text-emerald-200/45"
              style={{ left: `${left}%` }}
              animate={{ y: [4, -48], opacity: [0, 0.8, 0], scale: [0.6, 1, 0.6] }}
              transition={{
                duration: 2.8,
                delay: index * 0.8,
                repeat: Infinity,
              }}
            >
              <Sparkles className="h-3 w-3" />
            </motion.span>
          ))}
        </>
      ) : null}

      <div className="relative flex items-start gap-3">
        <motion.span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-200/25 bg-emerald-200/10"
          animate={
            reduceMotion
              ? undefined
              : {
                  boxShadow: [
                    "0 0 0 rgba(110,231,183,0)",
                    "0 0 20px rgba(110,231,183,0.28)",
                    "0 0 0 rgba(110,231,183,0)",
                  ],
                }
          }
          transition={{ duration: 2.2, repeat: Infinity }}
        >
          <CheckCircle2 className="h-5 w-5 text-emerald-300" />
        </motion.span>
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-emerald-200/55">
            Confirmed onchain
          </p>
          <p className="mt-1 text-sm font-semibold text-white">
            {receipt.title}
          </p>
        </div>
        <span className="flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.045] px-2 py-1 font-mono text-[9px] text-white/55">
          <Clock3 className="h-3 w-3 text-cyan-200" />
          {receipt.finalityMs.toLocaleString()} ms
        </span>
      </div>

      <div className="relative mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/[0.07] bg-black/20 p-2.5">
          <p className="text-[9px] uppercase tracking-wider text-white/30">
            {receipt.amountLabel}
          </p>
          <p className="mt-1 truncate font-mono text-xs text-white">
            {receipt.amount}
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-black/20 p-2.5">
          <p className="text-[9px] uppercase tracking-wider text-white/30">
            {receipt.receiveLabel ?? "Result"}
          </p>
          <p className="mt-1 truncate font-mono text-xs text-white">
            {receipt.receiveAmount ?? "Completed"}
          </p>
        </div>
      </div>

      <div className="relative mt-3 flex items-center gap-1 overflow-x-auto rounded-xl border border-white/[0.07] bg-black/15 px-2.5 py-2">
        {receipt.route.map((step, index) => (
          <div key={`${step}-${index}`} className="contents">
            <motion.span
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.1 }}
              className="shrink-0 rounded-lg border border-emerald-200/10 bg-emerald-200/[0.055] px-2 py-1 text-[9px] text-white/60"
            >
              {step}
            </motion.span>
            {index < receipt.route.length - 1 ? (
              <motion.span
                animate={reduceMotion ? undefined : { x: [0, 2, 0] }}
                transition={{ duration: 1, repeat: Infinity }}
              >
                <ArrowRight className="h-3 w-3 shrink-0 text-emerald-200/40" />
              </motion.span>
            ) : null}
          </div>
        ))}
      </div>

      <div className="relative mt-3 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-white/35">
          {receipt.transactionHash ?? "Circle challenge completed"}
        </span>
        {receipt.explorerUrl ? (
          <a
            href={receipt.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.055] px-2.5 py-1.5 text-[10px] font-medium text-white/75 transition hover:bg-white/[0.1] hover:text-white"
          >
            ArcScan
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>
    </motion.div>
  );
}
