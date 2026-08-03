"use client";

import { useMemo, useState } from "react";
import { DollarSign, Euro, Sparkles } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { TokenInput } from "@/components/ui/TokenInput";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { AssetMark } from "@/components/ui/MarketVisuals";
import {
  simpleEarnings,
  compoundedEarnings,
  endingBalanceSimple,
  periodToDays,
  PROJECTED_EARN_VAULT_APY,
  EARN_VAULT_NOT_LIVE,
  type TimePeriod,
} from "@/lib/calculatorMath";

type Asset = "USDC" | "EURC";

const TIME_OPTIONS: { label: TimePeriod; days: number }[] = [
  { label: "1 week", days: 7 },
  { label: "1 month", days: 30 },
  { label: "1 year", days: 365 },
];

function TokenIcon({ symbol }: { symbol: Asset }) {
  const Icon = symbol === "USDC" ? DollarSign : Euro;
  return <Icon className="h-4 w-4" />;
}

function tokenIconComponent(symbol: Asset) {
  return symbol === "USDC" ? DollarSign : Euro;
}

export function EarnCalculator() {
  const [asset, setAsset] = useState<Asset>("USDC");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<TimePeriod>("1 month");
  const [customDays, setCustomDays] = useState("30");

  const amountNum = useMemo(() => {
    const parsed = Number.parseFloat(amount);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [amount]);

  const days = period === "custom"
    ? (() => {
        const d = Number.parseInt(customDays, 10);
        return Number.isFinite(d) && d > 0 ? d : 30;
      })()
    : periodToDays(period);

  const apy = PROJECTED_EARN_VAULT_APY;
  const simpleProj = simpleEarnings(amountNum, apy, days);
  const compoundedProj = compoundedEarnings(amountNum, apy, days);

  return (
    <div className="space-y-5">
      {/* Projected rate badge */}
      {EARN_VAULT_NOT_LIVE ? (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 text-sm text-amber-100/80">
          <Sparkles className="h-4 w-4 shrink-0" />
          <span>
            <strong>Projected rate</strong> — Earn Vault launches soon.
            Displaying {apy}% estimated APY. Actual rates may differ.
          </span>
        </div>
      ) : null}

      {/* Asset selector */}
      <div className="flex gap-2">
        {(["USDC", "EURC"] as Asset[]).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAsset(a)}
            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
              asset === a
                ? "border-white/40 bg-white/[0.09] text-white"
                : "border-white/[0.08] bg-transparent text-white/45 hover:border-white/15 hover:text-white/70"
            }`}
          >
            <TokenIcon symbol={a} />
            {a}
          </button>
        ))}
      </div>

      {/* Amount input */}
      <TokenInput
        value={amount}
        onChange={setAmount}
        tokenName={asset === "USDC" ? "USD Coin" : "Euro Coin"}
        tokenSymbol={asset}
        balance="—"
        icon={tokenIconComponent(asset)}
        onMax={() => {}}
      />

      {/* Time period pills */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase text-white/35">Time period</p>
        <div className="flex flex-wrap gap-2">
          {TIME_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => setPeriod(opt.label)}
              className={`rounded-lg border px-3.5 py-2 text-sm transition ${
                period === opt.label
                  ? "border-white/35 bg-white/[0.09] text-white"
                  : "border-white/[0.07] bg-transparent text-white/45 hover:border-white/15 hover:text-white/65"
              }`}
            >
              {opt.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPeriod("custom")}
            className={`rounded-lg border px-3.5 py-2 text-sm transition ${
              period === "custom"
                ? "border-white/35 bg-white/[0.09] text-white"
                : "border-white/[0.07] bg-transparent text-white/45 hover:border-white/15 hover:text-white/65"
            }`}
          >
            Custom
          </button>
        </div>
        {period === "custom" ? (
          <input
            type="number"
            min={1}
            max={3650}
            value={customDays}
            onChange={(e) => setCustomDays(e.target.value)}
            placeholder="Days"
            className="mt-2 w-full rounded-lg border border-white/[0.09] bg-black/25 px-4 py-2.5 font-mono text-sm text-white outline-none placeholder:text-white/25 focus:border-white/20"
          />
        ) : null}
      </div>

      {/* Results */}
      <GlassCard depth="background" className="p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-3">
          <AssetMark symbol={asset} size="sm" />
          <div>
            <p className="text-xs font-medium text-white/45">Projected yield (estimated)</p>
            <p className="mt-1 font-mono text-3xl font-medium text-white">
              <AnimatedNumber value={simpleProj} decimals={2} suffix={` ${asset}`} />
            </p>
          </div>
        </div>

        {compoundedProj > simpleProj && amountNum > 0 ? (
          <div className="mb-4 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-sm">
            <span className="text-white/45">With compounding: </span>
            <span className="font-mono text-white/80">
              <AnimatedNumber value={compoundedProj} decimals={2} suffix={` ${asset}`} />
            </span>
          </div>
        ) : null}

        <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-sm">
          <span className="text-white/45">Ending balance: </span>
          <span className="font-mono text-white/80">
            <AnimatedNumber
              value={endingBalanceSimple(amountNum, apy, days)}
              decimals={2}
              suffix={` ${asset}`}
            />
          </span>
        </div>

        <p className="mt-4 text-[10px] leading-4 text-white/28">
          {EARN_VAULT_NOT_LIVE
            ? `Based on projected ${apy}% APY. The Earn Vault is not yet live — this is a forward estimate, not a guaranteed return.`
            : `Based on the current ${apy.toFixed(2)}% APY. Earn Vault returns are variable — this is an estimate, not a guarantee.`}
        </p>
      </GlassCard>
    </div>
  );
}
