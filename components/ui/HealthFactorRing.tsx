"use client";

import { motion } from "framer-motion";
import { HealthFactorValue } from "@/components/ui/HealthFactorValue";
import { cn } from "@/lib/utils";

type HealthFactorRingProps = {
  value: number;
  size?: number;
  className?: string;
  showValue?: boolean;
};

export function HealthFactorRing({
  value,
  size = 80,
  className,
  showValue = true,
}: HealthFactorRingProps) {
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const healthPct = Math.min(value / 2, 1);
  const offset = circumference * (1 - healthPct);
  const stroke = value > 1.5 ? "rgba(255,255,255,0.96)" : value >= 1 ? "rgba(255,255,255,0.58)" : "rgba(239,169,169,0.86)";

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          animate={{ strokeDashoffset: offset, stroke }}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          transition={{ duration: 1.05, ease: [0.22, 1, 0.36, 1] }}
          style={{ rotate: -90, transformOrigin: "center", filter: value < 1 ? "drop-shadow(0 0 10px rgba(248,113,113,0.25))" : "drop-shadow(0 0 12px rgba(255,255,255,0.18))" }}
        />
      </svg>
      {showValue ? (
        <HealthFactorValue
          value={value}
          className="absolute font-mono text-sm text-white"
        />
      ) : null}
    </div>
  );
}
