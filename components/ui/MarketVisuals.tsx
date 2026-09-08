"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { TokenMark } from "@/components/ui/TokenMark";

export function AssetMark({ symbol, size = "md" }: { symbol: string; size?: "sm" | "md" | "lg" }) {
  const sizes = {
    sm: "h-8 w-8",
    md: "h-10 w-10",
    lg: "h-12 w-12",
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
