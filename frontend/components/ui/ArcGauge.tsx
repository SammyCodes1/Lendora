"use client";

import { motion } from "framer-motion";

type ArcGaugeProps = {
  value: number;
  max?: number;
  className?: string;
  full?: boolean;
};

export function ArcGauge({ value, max = 100, className, full = false }: ArcGaugeProps) {
  const progress = Math.max(0, Math.min(1, value / max));
  const path = full ? "M 50 10 A 40 40 0 1 1 49.9 10" : "M 10 58 A 40 40 0 0 1 90 58";
  const length = full ? 251 : 126;

  return (
    <svg viewBox={full ? "0 0 100 100" : "0 0 100 70"} className={className} aria-hidden="true">
      <path d={path} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" strokeLinecap="round" />
      <motion.path
        d={path}
        fill="none"
        stroke="rgba(255,255,255,0.9)"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={length}
        initial={{ strokeDashoffset: length }}
        animate={{ strokeDashoffset: length * (1 - progress) }}
        transition={{ duration: 1, ease: "easeOut" }}
        style={{ filter: "drop-shadow(0 0 14px rgba(255,255,255,0.28))" }}
      />
    </svg>
  );
}
