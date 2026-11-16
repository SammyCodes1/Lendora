"use client";

import { Activity } from "lucide-react";
import {
  RATE_MODEL,
  formatAccruedUnits,
  formatUtilization,
  poolHasBorrowers,
  supplyApyCaption,
} from "@/lib/markets";
import { cn } from "@/lib/utils";

export function UtilizationTrack({
  utilization,
  className,
}: {
  utilization: number;
  className?: string;
}) {
  const percent = Math.max(0, Math.min(100, utilization));
  const kink = RATE_MODEL.OPTIMAL_UTILIZATION;
  const tone =
    percent >= kink ? "scarce" : percent > 0 ? "healthy" : "idle";

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between text-[11px] text-white/45">
        <span>Pool utilization</span>
        <span
          className={cn(
            "font-mono",
            tone === "scarce"
              ? "text-amber-300"
              : tone === "healthy"
                ? "text-emerald-300"
                : "text-white/55",
          )}
        >
          {formatUtilization(percent)}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-white/[0.08]">
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-[width] duration-500",
            tone === "scarce"
              ? "bg-amber-400"
              : tone === "healthy"
                ? "bg-emerald-400"
                : "bg-white/25",
          )}
          style={{ width: `${percent}%` }}
        />
        <div
          className="absolute top-1/2 h-3.5 w-px -translate-y-1/2 bg-white/70"
          style={{ left: `${kink}%` }}
          aria-hidden="true"
        />
      </div>
      <div className="flex justify-between font-mono text-[10px] text-white/35">
        <span>0%</span>
        <span>{kink}% kink</span>
        <span>100%</span>
      </div>
    </div>
  );
}

export function SupplyApyCaption({
  market,
  className,
}: {
  market: { totalBorrow: bigint; utilization: number };
  className?: string;
}) {
  return (
    <p className={cn("text-[11px] leading-5 text-white/45", className)}>
      {supplyApyCaption(market)}
    </p>
  );
}

export function AccruedYieldLine({
  accrued,
  symbol,
  apy,
  market,
}: {
  accrued: bigint;
  symbol: string;
  apy: string;
  market: { totalBorrow: bigint; utilization: number };
}) {
  if (accrued > 0n) {
    return (
      <p className="mt-0.5 flex items-center gap-1 font-mono text-[11px] tabular-nums text-[#86efac]">
        <Activity className="h-3 w-3" />
        +{formatAccruedUnits(accrued)} {symbol} earned
      </p>
    );
  }

  if (!poolHasBorrowers(market)) {
    return (
      <p className="mt-0.5 text-[11px] leading-5 text-white/40">
        APY 0% — no borrowers yet
      </p>
    );
  }

  return (
    <p className="mt-0.5 font-mono text-[11px] text-emerald-300/80">
      Earning at {apy}
    </p>
  );
}
