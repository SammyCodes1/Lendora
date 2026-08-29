"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "framer-motion";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  CircleDot,
  Copy,
  ExternalLink,
  Loader2,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { GlassButton } from "@/components/ui/GlassButton";
import type {
  AgentTransactionReceipt,
  AgentTransactionReview,
} from "@/lib/agentTypes";

type AgentTransactionFlowProps = {
  open: boolean;
  review: AgentTransactionReview | null;
  receipt: AgentTransactionReceipt | null;
  isExecuting: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
  onDone: () => void;
};

type RouteFlowProps = {
  route: string[];
  isExecuting: boolean;
  isComplete: boolean;
};

function RouteFlow({
  route,
  isExecuting,
  isComplete,
}: RouteFlowProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className="relative mt-5 overflow-hidden rounded-2xl border border-emerald-200/[0.12] bg-[linear-gradient(135deg,rgba(16,185,129,0.055),rgba(0,0,0,0.24)_48%,rgba(34,211,238,0.045))] p-4"
      animate={
        reduceMotion
          ? undefined
          : {
              boxShadow: isExecuting
                ? [
                    "0 0 0 rgba(52,211,153,0)",
                    "0 0 34px rgba(52,211,153,0.13)",
                    "0 0 0 rgba(52,211,153,0)",
                  ]
                : "0 0 0 rgba(52,211,153,0)",
            }
      }
      transition={{ duration: 2.2, repeat: isExecuting ? Infinity : 0 }}
    >
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute -left-20 top-1/2 h-32 w-32 -translate-y-1/2 rounded-full bg-emerald-300/10 blur-3xl"
        animate={
          reduceMotion
            ? undefined
            : { x: [0, 520, 0], opacity: [0.15, 0.45, 0.15] }
        }
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <motion.span
            animate={
              reduceMotion ? undefined : { rotate: [0, 8, -8, 0] }
            }
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Zap className="h-3.5 w-3.5 text-emerald-300" />
          </motion.span>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
            Onchain route
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.14em] text-emerald-200/45">
          <motion.span
            className="h-1.5 w-1.5 rounded-full bg-emerald-300"
            animate={
              reduceMotion
                ? undefined
                : { scale: [0.75, 1.45, 0.75], opacity: [0.4, 1, 0.4] }
            }
            transition={{ duration: 1.4, repeat: Infinity }}
          />
          {isComplete ? "Finalized" : isExecuting ? "Live" : "Ready"}
        </span>
      </div>

      <div className="relative mt-5 flex items-center gap-2 overflow-x-auto px-1 pb-2 pt-1">
        {route.map((step, index) => (
          <div key={`${step}-${index}`} className="contents">
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.92 }}
              animate={{
                opacity: 1,
                y: 0,
                scale:
                  !reduceMotion && isExecuting
                    ? [1, 1.035, 1]
                    : 1,
                borderColor: isComplete
                  ? "rgba(110,231,183,0.38)"
                  : "rgba(167,243,208,0.16)",
              }}
              transition={{
                opacity: { delay: index * 0.1 },
                y: { delay: index * 0.1, type: "spring", stiffness: 260 },
                scale: {
                  delay: index * 0.32,
                  duration: 1.8,
                  repeat: isExecuting ? Infinity : 0,
                },
              }}
              className="relative shrink-0 overflow-hidden rounded-xl border bg-[#101a17]/90 px-3.5 py-2.5 text-center shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
            >
              {isExecuting && !reduceMotion ? (
                <motion.span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 -top-4 h-7 bg-emerald-200/15 blur-md"
                  animate={{ y: [-12, 54] }}
                  transition={{
                    duration: 1.5,
                    delay: index * 0.3,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                />
              ) : null}
              <span className="relative mx-auto mb-1 flex h-5 w-5 items-center justify-center rounded-full border border-emerald-200/20 bg-emerald-200/[0.08]">
                {isComplete ? (
                  <motion.span
                    initial={{ scale: 0, rotate: -35 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{
                      delay: index * 0.11,
                      type: "spring",
                      stiffness: 330,
                    }}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                  </motion.span>
                ) : isExecuting ? (
                  <motion.span
                    animate={
                      reduceMotion
                        ? undefined
                        : { rotate: 360, scale: [0.85, 1.1, 0.85] }
                    }
                    transition={{
                      rotate: {
                        duration: 2,
                        repeat: Infinity,
                        ease: "linear",
                      },
                      scale: {
                        duration: 1.2,
                        delay: index * 0.2,
                        repeat: Infinity,
                      },
                    }}
                  >
                    <CircleDot className="h-3.5 w-3.5 text-cyan-200" />
                  </motion.span>
                ) : (
                  <span className="font-mono text-[9px] text-emerald-100/65">
                    {index + 1}
                  </span>
                )}
              </span>
              <span className="block text-[9px] uppercase tracking-wider text-emerald-100/40">
                Step {index + 1}
              </span>
              <span className="relative mt-0.5 block whitespace-nowrap text-xs font-medium text-white">
                {step}
              </span>
            </motion.div>
            {index < route.length - 1 ? (
              <span className="relative flex h-10 w-9 shrink-0 items-center justify-center text-emerald-200/55">
                <motion.span
                  className="absolute h-px w-full origin-left bg-gradient-to-r from-emerald-300/20 via-emerald-200/70 to-cyan-200/20"
                  animate={
                    reduceMotion
                      ? undefined
                      : {
                          scaleX: [0.2, 1, 0.2],
                          opacity: [0.25, 0.9, 0.25],
                        }
                  }
                  transition={{
                    duration: 1.6,
                    delay: index * 0.18,
                    repeat: Infinity,
                  }}
                />
                {!reduceMotion
                  ? [0, 1, 2].map((particle) => (
                      <motion.span
                        key={particle}
                        aria-hidden="true"
                        className="absolute left-0 h-1.5 w-1.5 rounded-full bg-emerald-200 shadow-[0_0_9px_rgba(110,231,183,0.95)]"
                        animate={{ x: [0, 30], opacity: [0, 1, 0] }}
                        transition={{
                          duration: isExecuting ? 0.9 : 1.5,
                          delay: particle * 0.42 + index * 0.2,
                          repeat: Infinity,
                          ease: "linear",
                        }}
                      />
                    ))
                  : null}
                <motion.span
                  className="relative translate-x-3"
                  animate={
                    reduceMotion ? undefined : { x: [0, 3, 0] }
                  }
                  transition={{ duration: 1, repeat: Infinity }}
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                </motion.span>
              </span>
            ) : null}
          </div>
        ))}
      </div>

      {isComplete && !reduceMotion ? (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0] }}
          transition={{ duration: 1.4 }}
        >
          {[12, 29, 48, 68, 86].map((left, index) => (
            <motion.span
              key={left}
              className="absolute bottom-3 text-emerald-200/70"
              style={{ left: `${left}%` }}
              initial={{ y: 8, scale: 0, opacity: 0 }}
              animate={{ y: -54, scale: [0, 1, 0.4], opacity: [0, 1, 0] }}
              transition={{ duration: 1.1, delay: index * 0.09 }}
            >
              <Sparkles className="h-3 w-3" />
            </motion.span>
          ))}
        </motion.div>
      ) : null}
    </motion.div>
  );
}

function ShareLinkBox({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="mt-5 rounded-2xl border border-emerald-200/15 bg-emerald-200/[0.05] p-4">
      <p className="text-xs text-white/40">Shareable Lendrop link</p>
      <p className="mt-2 break-all font-mono text-xs leading-5 text-white/80">
        {url}
      </p>
      <button
        type="button"
        onClick={() => void copy()}
        className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.055] px-3 text-sm font-medium text-white transition hover:bg-white/[0.1]"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}

export function AgentTransactionFlow({
  open,
  review,
  receipt,
  isExecuting,
  error,
  onConfirm,
  onClose,
  onDone,
}: AgentTransactionFlowProps) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && review ? (
        <motion.div
          data-agent-transaction-portal
          role="dialog"
          aria-modal="true"
          aria-labelledby="agent-transaction-title"
          className="fixed inset-0 z-[220] flex items-center justify-center bg-[#050807]/92 p-4 backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 18 }}
            className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-emerald-200/15 bg-[#0a0f0d] p-5 shadow-[0_35px_120px_rgba(0,0,0,0.75)] sm:p-7"
          >
            <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-emerald-300/10 blur-3xl" />
            <div className="relative flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-full border border-emerald-300/20 bg-emerald-300/10">
                  {receipt ? (
                    <CheckCircle2 className="h-6 w-6 text-emerald-300" />
                  ) : isExecuting ? (
                    <Loader2 className="h-6 w-6 animate-spin text-emerald-200" />
                  ) : (
                    <ShieldCheck className="h-6 w-6 text-emerald-200" />
                  )}
                </span>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200/55">
                    {receipt
                      ? "Transaction complete"
                      : isExecuting
                        ? "Confirming onchain"
                        : review.eyebrow}
                  </p>
                  <h2
                    id="agent-transaction-title"
                    className="mt-1 text-xl font-semibold text-white sm:text-2xl"
                  >
                    {receipt ? receipt.title : review.title}
                  </h2>
                </div>
              </div>
              {!isExecuting ? (
                <button
                  type="button"
                  aria-label="Close transaction page"
                  onClick={receipt ? onDone : onClose}
                  className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-white/45 transition hover:bg-white/[0.08] hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>

            <div
              className={`relative mt-6 grid gap-3 ${
                receipt ? "sm:grid-cols-3" : "sm:grid-cols-2"
              }`}
            >
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
                <p className="text-xs text-white/40">{review.amountLabel}</p>
                <p className="mt-2 break-words font-mono text-lg text-white">
                  {review.amount}
                </p>
              </div>
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
                <p className="text-xs text-white/40">
                  {review.receiveLabel ?? "Network"}
                </p>
                <p className="mt-2 break-words font-mono text-lg text-white">
                  {review.receiveAmount ?? "Arc Testnet"}
                </p>
              </div>
              {receipt ? (
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
                  <p className="text-xs text-white/40">Finality time</p>
                  <p className="mt-2 break-words font-mono text-lg text-white">
                    {receipt.finalityMs.toLocaleString()} ms
                  </p>
                </div>
              ) : null}
            </div>

            <RouteFlow
              route={review.route}
              isExecuting={isExecuting}
              isComplete={Boolean(receipt)}
            />

            <p className="mt-4 text-xs leading-5 text-white/45">
              {isExecuting
                ? "Keep this page open while the wallet transaction reaches finality."
                : review.detail}
            </p>

            {receipt ? (
              <div className="mt-5 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
                <p className="text-xs text-white/40">
                  {receipt.transactionHash ? "Transaction hash" : "Circle status"}
                </p>
                <p className="mt-2 break-all font-mono text-xs leading-5 text-white/75">
                  {receipt.transactionHash ?? "Circle challenge completed"}
                </p>
              </div>
            ) : null}

            {receipt?.shareUrl ? <ShareLinkBox url={receipt.shareUrl} /> : null}

            {error ? (
              <p
                role="alert"
                className="mt-4 rounded-xl border border-red-300/15 bg-red-300/[0.06] px-3 py-2.5 text-xs leading-5 text-red-200"
              >
                {error}
              </p>
            ) : null}

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row">
              {receipt ? (
                <>
                  <a
                    href={receipt.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.055] px-4 text-sm font-medium text-white transition hover:bg-white/[0.1]"
                  >
                    View transaction
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  <GlassButton
                    type="button"
                    variant="primary"
                    className="flex-1"
                    onClick={onDone}
                  >
                    Done
                  </GlassButton>
                </>
              ) : (
                <>
                  <GlassButton
                    type="button"
                    variant="ghost"
                    className="flex-1"
                    disabled={isExecuting}
                    onClick={onClose}
                  >
                    Back
                  </GlassButton>
                  <GlassButton
                    type="button"
                    variant="primary"
                    className="flex-1"
                    disabled={isExecuting}
                    onClick={onConfirm}
                  >
                    {isExecuting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Confirm in wallet
                  </GlassButton>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
