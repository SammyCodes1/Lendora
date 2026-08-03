"use client";

import { useMemo, useState } from "react";
import { DollarSign, Euro } from "lucide-react";
import { formatUnits } from "viem";
import { GlassCard } from "@/components/ui/GlassCard";
import { TokenInput } from "@/components/ui/TokenInput";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { Skeleton } from "@/components/ui/Skeleton";
import { useLiveMarkets } from "@/hooks/useLiveMarkets";
import { AssetMark } from "@/components/ui/MarketVisuals";
import {
  simpleEarnings,
  compoundedEarnings,
  endingBalanceSimple,
  periodToDays,
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

export function LendingCalculator() {
  const [asset, setAsset] = useState<Asset>("USDC");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<TimePeriod>("1 month");
  const [customDays, setCustomDays] = useState("30");

  const { markets, isLoading } = useLiveMarkets();

  const selectedMarket = useMemo(
    () => markets.find((m) => m.symbol === asset) ?? null,
    [markets, asset],
  );

  const supplyApy = selectedMarket?.supplyApyValue ?? 0;
  const userSupply = selectedMarket?.userSupply ?? 0n;
  const userSupplyFormatted = useMemo(() => {
    if (!userSupply) return "0";
    return Number(formatUnits(userSupply, 6)).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });
  }, [userSupply]);

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

  const simpleProj = simpleEarnings(amountNum, supplyApy, days);
  const compoundedProj = compoundedEarnings(amountNum, supplyApy, days);

  const priceNum = useMemo(() => {
    if (!selectedMarket?.price) return 0;
    return Number(formatUnits(selectedMarket.price, selectedMarket.priceDecimals));
  }, [selectedMarket]);

  return (
    <div className="space-y-5">
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

      {/* Existing position context */}
      {userSupply > 0n ? (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-white/55">
          <span>You currently have </span>
          <span className="font-mono text-white/80">{userSupplyFormatted} {asset}</span>
          <span> supplied</span>
        </div>
      ) : null}

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
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton height={48} />
            <Skeleton height={24} />
            <Skeleton height={16} />
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3">
              <AssetMark symbol={asset} size="sm" />
              <div>
                <p className="text-xs font-medium text-white/45">Projected earnings</p>
                <p className="mt-1 font-mono text-3xl font-medium text-white">
                  <AnimatedNumber value={simpleProj} decimals={2} suffix={` ${asset}`} />
                </p>
                {priceNum > 0 ? (
                  <p className="mt-0.5 font-mono text-sm text-white/45">
                    ≈ $<AnimatedNumber value={simpleProj * priceNum} decimals={2} />
                  </p>
                ) : null}
              </div>
            </div>

            {/* Compounded figure */}
            {compoundedProj > simpleProj && amountNum > 0 ? (
              <div className="mb-4 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-sm">
                <span className="text-white/45">With compounding: </span>
                <span className="font-mono text-white/80">
                  <AnimatedNumber value={compoundedProj} decimals={2} suffix={` ${asset}`} />
                </span>
                {priceNum > 0 ? (
                  <span className="ml-1 font-mono text-xs text-white/40">
                    (≈ $<AnimatedNumber value={compoundedProj * priceNum} decimals={2} />)
                  </span>
                ) : null}
              </div>
            ) : null}

            {/* Ending balance */}
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-sm">
              <span className="text-white/45">Ending balance: </span>
              <span className="font-mono text-white/80">
                <AnimatedNumber
                  value={endingBalanceSimple(amountNum, supplyApy, days)}
                  decimals={2}
                  suffix={` ${asset}`}
                />
              </span>
            </div>

            {/* Disclaimer */}
            <p className="mt-4 text-[10px] leading-4 text-white/28">
              Based on the current {supplyApy.toFixed(2)}% APY — rates change with
              pool utilization. This is an estimate, not a guarantee.
            </p>
          </>
        )}
      </GlassCard>
    </div>
  );
}
