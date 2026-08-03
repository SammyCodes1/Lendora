"use client";

import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { cn } from "@/lib/utils";

type StatBadgeTone = "neutral" | "positive" | "negative";

type StatBadgeProps = {
  label: string;
  value: string;
  tone?: StatBadgeTone;
  className?: string;
};

const toneStyles: Record<StatBadgeTone, string> = {
  neutral: "text-white",
  positive: "text-emerald-200",
  negative: "text-red-300",
};

export function StatBadge({ label, value, tone = "neutral", className }: StatBadgeProps) {
  const numericMatch = value.match(/^([^0-9-]*)(-?[\d,.]+)(.*)$/);
  const numericValue = numericMatch ? Number(numericMatch[2].replace(/,/g, "")) : Number.NaN;
  const decimals = numericMatch?.[2].includes(".") ? numericMatch[2].split(".")[1].length : 0;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-md border border-white/[0.09] bg-black/20 px-2.5 py-1.5 text-xs text-white/50",
        className,
      )}
    >
      <span>{label}</span>
      <span className={cn("font-mono", toneStyles[tone])}>
        {numericMatch && Number.isFinite(numericValue) ? (
          <AnimatedNumber
            value={numericValue}
            prefix={numericMatch[1]}
            suffix={numericMatch[3]}
            decimals={decimals}
          />
        ) : (
          value
        )}
      </span>
    </div>
  );
}
