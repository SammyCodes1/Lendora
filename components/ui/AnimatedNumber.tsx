"use client";

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { useEffect } from "react";

type AnimatedNumberProps = {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
};

export function AnimatedNumber({ value, prefix = "", suffix = "", decimals = 0, className }: AnimatedNumberProps) {
  const motionValue = useMotionValue(0);
  const reduceMotion = useReducedMotion();
  const display = useTransform(motionValue, (latest) => {
    const formatted = latest.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

    return `${prefix}${formatted}${suffix}`;
  });

  useEffect(() => {
    const controls = animate(motionValue, value, { duration: reduceMotion ? 0 : 1, ease: [0.22, 1, 0.36, 1] });
    return controls.stop;
  }, [motionValue, reduceMotion, value]);

  return <motion.span className={className} aria-live="polite">{display}</motion.span>;
}
