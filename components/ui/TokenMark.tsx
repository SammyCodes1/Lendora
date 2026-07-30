import {
  BadgeEuro,
  Bitcoin,
  CircleDollarSign,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type TokenVisual = {
  Icon: LucideIcon;
  colorClassName: string;
};

// Outer colored drop-shadows bleed under token chips on mobile (especially
// inside translucent glass + overflow-visible swap panels). Keep only an
// inset highlight so badges stay crisp without colored halos underneath.
const tokenVisuals: Record<string, TokenVisual> = {
  USDC: {
    Icon: CircleDollarSign,
    colorClassName:
      "border-[rgba(61,117,204,0.45)] bg-[#0b53bf] shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]",
  },
  EURC: {
    Icon: BadgeEuro,
    colorClassName:
      "border-[rgba(61,117,204,0.45)] bg-[#0b53bf] shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]",
  },
  USDT: {
    Icon: CircleDollarSign,
    colorClassName:
      "border-[rgba(51,170,167,0.45)] bg-[#009393] shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]",
  },
  CIRBTC: {
    Icon: Bitcoin,
    colorClassName:
      "border-[rgba(249,170,77,0.45)] bg-[#f7931a] shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]",
  },
};

const fallbackVisual: TokenVisual = {
  Icon: CircleDollarSign,
  colorClassName:
    "border-white/15 bg-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]",
};

export function TokenMark({
  symbol,
  className,
  iconClassName,
  strokeWidth = 1.75,
}: {
  symbol: string;
  className?: string;
  iconClassName?: string;
  strokeWidth?: number;
}) {
  const visual = tokenVisuals[symbol.toUpperCase()] ?? fallbackVisual;
  const Icon = visual.Icon;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-white",
        visual.colorClassName,
        className,
      )}
    >
      <Icon
        className={cn("h-5 w-5", iconClassName)}
        strokeWidth={strokeWidth}
      />
    </span>
  );
}
