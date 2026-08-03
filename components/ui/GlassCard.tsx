"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type GlassCardProps = {
  children: React.ReactNode;
  className?: string;
  glowOnHover?: boolean;
  depth?: "background" | "base" | "foreground";
  delay?: number;
};

const depthStyles = {
  background: "bg-white/[0.032] shadow-[0_18px_50px_rgba(0,0,0,0.30)] backdrop-blur-xl",
  base: "bg-white/[0.05] shadow-[0_28px_80px_rgba(0,0,0,0.46)] backdrop-blur-2xl",
  foreground: "bg-white/[0.07] shadow-[0_40px_120px_rgba(0,0,0,0.62)] backdrop-blur-3xl",
};

export function GlassCard({ children, className, glowOnHover = false, depth = "base", delay = 0 }: GlassCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.985, y: 18 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.34, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={
        glowOnHover
          ? {
              boxShadow: "0 38px 110px rgba(0,0,0,0.58), inset 0 1px 0 rgba(255,255,255,0.12)",
              borderColor: "rgba(255,255,255,0.18)",
              y: -3,
            }
          : undefined
      }
      whileTap={glowOnHover ? { scale: 0.995 } : undefined}
      className={cn(
        "glass-panel overflow-hidden rounded-2xl border-white/[0.09]",
        depthStyles[depth],
        className,
      )}
    >
      {children}
    </motion.div>
  );
}
