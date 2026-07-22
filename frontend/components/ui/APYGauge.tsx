"use client";

import { motion } from "framer-motion";

type APYGaugeProps = {
  value: number;
  className?: string;
};

export function APYGauge({ value, className }: APYGaugeProps) {
  const progress = Math.max(0, Math.min(100, value));
  const length = 126;

  return (
    <div className={className}>
      <svg viewBox="0 0 100 64" className="h-24 w-32" aria-hidden="true">
        <path d="M 10 54 A 40 40 0 0 1 90 54" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" strokeLinecap="round" />
        <motion.path
          d="M 10 54 A 40 40 0 0 1 90 54"
          fill="none"
          stroke="rgba(255,255,255,0.92)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={length}
          initial={{ strokeDashoffset: length }}
          animate={{ strokeDashoffset: length * (1 - progress / 100) }}
          transition={{ duration: 1.05, ease: [0.22, 1, 0.36, 1] }}
          style={{ filter: "drop-shadow(0 0 14px rgba(255,255,255,0.24))" }}
        />
      </svg>
      <p className="-mt-2 text-center font-mono text-xs text-white/55">{progress.toFixed(1)}% Utilized</p>
    </div>
  );
}
