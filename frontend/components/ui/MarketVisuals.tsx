"use client";

import { ExternalLink } from "lucide-react";
import { motion } from "framer-motion";
import type { Address } from "viem";
import { cn } from "@/lib/utils";
import { TokenMark } from "@/components/ui/TokenMark";
import {
  LENDORA_A_TOKEN_SYMBOL,
  LENDORA_DEBT_TOKEN_SYMBOL,
  aTokenShareLabel,
  arcscanTokenUrl,
  debtTokenShareLabel,
} from "@/lib/markets";

export function AssetMark({ symbol, size = "md" }: { symbol: string; size?: "sm" | "md" | "lg" }) {
  const sizes = {
    sm: "h-9 w-9 [&>svg]:h-4 [&>svg]:w-4",
    md: "h-11 w-11 [&>svg]:h-5 [&>svg]:w-5",
    lg: "h-14 w-14 [&>svg]:h-6 [&>svg]:w-6",
  };

  return <TokenMark symbol={symbol} className={sizes[size]} strokeWidth={1.5} />;
}

export function UtilizationBar({ value, delay = 0, className }: { value: number; delay?: number; className?: string }) {
  const progress = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
        <motion.div
          className="h-full rounded-full bg-white/85 shadow-[0_0_16px_rgba(255,255,255,0.32)]"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.9, delay, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <span className="w-12 text-right font-mono text-xs text-white/55">{progress.toFixed(1)}%</span>
    </div>
  );
}

export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("text-[10px] font-semibold uppercase text-white/35", className)}>
      {children}
    </p>
  );
}

export function ReceiptTokenLinks({
  aToken,
  debtToken,
  symbol,
  className,
}: {
  aToken: Address;
  debtToken: Address;
  symbol: "USDC" | "EURC";
  className?: string;
}) {
  return (
    <p className={cn("mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-white/35", className)}>
      <a
        href={arcscanTokenUrl(aToken)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 font-mono text-white/50 transition hover:text-white"
      >
        {aTokenShareLabel(symbol)} · {LENDORA_A_TOKEN_SYMBOL}
        <ExternalLink className="h-2.5 w-2.5" />
      </a>
      <span className="text-white/20">·</span>
      <a
        href={arcscanTokenUrl(debtToken)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 font-mono text-white/50 transition hover:text-white"
      >
        {debtTokenShareLabel(symbol)} · {LENDORA_DEBT_TOKEN_SYMBOL}
        <ExternalLink className="h-2.5 w-2.5" />
      </a>
    </p>
  );
}
