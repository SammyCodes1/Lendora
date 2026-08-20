"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type HeaderStat = {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "warning";
};

type PageHeaderProps = {
  icon: React.ReactNode;
  title: string;
  description: string;
  stats?: HeaderStat[];
  actions?: React.ReactNode;
  className?: string;
};

const toneStyles: Record<NonNullable<HeaderStat["tone"]>, string> = {
  neutral: "text-white",
  positive: "text-[#86efac]",
  warning: "text-red-200/75",
};

export function PageHeader({
  icon,
  title,
  description,
  stats = [],
  actions,
  className,
}: PageHeaderProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className={cn(
        "flex flex-col gap-6 border-b border-white/[0.07] pb-7 pt-2 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium uppercase text-white/45 backdrop-blur-2xl">
          <span className="text-white/75 [&>svg]:h-3.5 [&>svg]:w-3.5">
            {icon}
          </span>
          <span>Lendora protocol</span>
        </div>
        <h1 className="font-display text-3xl font-medium leading-[1.02] text-white sm:text-6xl sm:leading-[0.98]">
          {title}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/52 sm:text-base">
          {description}
        </p>
      </div>

      <div className="flex shrink-0 flex-col gap-3 sm:items-end">
        {stats.length > 0 ? (
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl border border-white/[0.09] bg-white/[0.045] px-3.5 py-2.5 text-xs shadow-[0_16px_40px_rgba(0,0,0,0.28)] backdrop-blur-2xl"
              >
                <span className="text-white/38">{stat.label}</span>
                <span
                  className={cn(
                    "ml-2 font-mono font-semibold",
                    toneStyles[stat.tone ?? "neutral"],
                  )}
                >
                  {stat.value}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </motion.section>
  );
}
