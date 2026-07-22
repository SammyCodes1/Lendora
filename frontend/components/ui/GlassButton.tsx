"use client";

import { motion } from "framer-motion";
import type { HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

type GlassButtonVariant = "primary" | "ghost" | "danger";

type GlassButtonProps = HTMLMotionProps<"button"> & {
  variant?: GlassButtonVariant;
};

const variants: Record<GlassButtonVariant, string> = {
  primary: "border border-white/80 bg-white text-black font-semibold shadow-[0_10px_30px_rgba(255,255,255,0.08)] hover:border-white hover:bg-white/95",
  ghost: "border border-white/[0.10] bg-white/[0.045] text-white/75 hover:border-white/20 hover:bg-white/[0.075] hover:text-white",
  danger: "border border-red-300/25 bg-red-300/[0.07] text-red-200/85 hover:border-red-200/35 hover:bg-red-300/[0.11]",
};

export function GlassButton({ variant = "ghost", className, children, ...props }: GlassButtonProps) {
  return (
    <motion.button
      whileHover={{ scale: 1.02, boxShadow: "0 0 30px rgba(255,255,255,0.10)" }}
      whileTap={{ scale: 0.96, boxShadow: "0 0 0 rgba(255,255,255,0)" }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm transition disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-30",
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </motion.button>
  );
}
