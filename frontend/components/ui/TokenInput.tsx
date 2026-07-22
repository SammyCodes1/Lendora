"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type TokenInputProps = {
  value: string;
  onChange: (value: string) => void;
  tokenName: string;
  tokenSymbol: string;
  balance: string;
  icon: LucideIcon;
  error?: boolean;
  onMax: () => void;
};

export function TokenInput({ value, onChange, tokenName, tokenSymbol, balance, icon: Icon, error, onMax }: TokenInputProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-white/10 bg-black/25 px-4 py-3 transition focus-within:border-emerald-200/40 focus-within:ring-1 focus-within:ring-emerald-200/15",
        error && "border-red-500/30",
      )}
    >
      <div className="mb-2 flex items-center justify-between text-xs text-white/45">
        <span>{tokenName}</span>
        <span>Balance {balance}</span>
      </div>
      <div className="flex items-center gap-3">
        <input
          aria-label={`${tokenSymbol} amount`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode="decimal"
          placeholder="0.00"
          className="min-w-0 flex-1 bg-transparent font-mono text-xl text-white outline-none placeholder:text-white/25"
        />
        <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.055] px-2 py-1 text-sm text-white">
          <Icon className="h-4 w-4" />
          {tokenSymbol}
        </div>
        <button type="button" onClick={onMax} className="rounded-md bg-emerald-200 px-3 py-1.5 text-xs font-semibold text-[#07100c] transition hover:bg-emerald-100">
          MAX
        </button>
      </div>
    </div>
  );
}
