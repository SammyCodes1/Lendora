"use client";

import { formatUnits, type Hash } from "viem";
import {
  Activity,
  CheckCircle2,
  Coins,
  ExternalLink,
  Info,
  Loader2,
  Sparkles,
} from "lucide-react";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { AssetMark } from "@/components/ui/MarketVisuals";
import type { MarketAsset } from "@/components/modals/types";
import {
  capacityFilledPercent,
  filterLendoraMarkets,
  formatRemainingCap,
  formatReserveCap,
  maxBorrowableAmount,
  type LendoraAssetFilter,
} from "@/lib/markets";
import { cn } from "@/lib/utils";

const ASSET_FILTERS: { id: LendoraAssetFilter; label: string }[] = [
  { id: "ALL", label: "All assets" },
  { id: "USDC", label: "USDC" },
  { id: "EURC", label: "EURC" },
];

export function AssetFilterBar({
  value,
  onChange,
}: {
  value: LendoraAssetFilter;
  onChange: (next: LendoraAssetFilter) => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="tablist"
      aria-label="Filter USDC and EURC"
    >
      {ASSET_FILTERS.map((item) => {
        const selected = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(item.id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition",
              selected
                ? "border-white/25 bg-white text-black"
                : "border-white/[0.10] bg-white/[0.04] text-white/55 hover:border-white/20 hover:text-white",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function CapacityMeter({
  value,
  market,
}: {
  value: number;
  market?: {
    totalSupply: bigint;
    supplyCap: bigint;
    remainingSupplyCap: bigint;
    isSupplyCapped: boolean;
    symbol: string;
    utilization?: number;
  };
}) {
  const progress = Math.max(0, Math.min(100, value));
  const displayPercent =
    progress > 0 && progress < 0.01
      ? "<0.01%"
      : progress > 0 && progress < 0.1
      ? `${progress.toFixed(2)}%`
      : `${progress.toFixed(1)}%`;

  const barWidth = progress > 0 ? Math.max(progress, 1.5) : 0;

  const toneClass =
    progress >= 95
      ? "bg-rose-400"
      : progress >= 80
      ? "bg-amber-400"
      : "bg-white/80 group-hover:bg-white";

  const textToneClass =
    progress >= 95
      ? "text-rose-300"
      : progress >= 80
      ? "text-amber-300"
      : "text-white/55 group-hover:text-white/80";

  const tooltipText = market
    ? market.isSupplyCapped
      ? `${displayPercent} filled (${Number(formatUnits(market.totalSupply, 6)).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${market.symbol} of ${formatReserveCap(market.supplyCap, true, { compact: true })} ${market.symbol} cap · ${formatRemainingCap(market.remainingSupplyCap, true, market.symbol)} left)`
      : `Uncapped reserve (${displayPercent} pool utilization)`
    : `${displayPercent} capacity filled`;

  return (
    <div
      className="group flex min-w-[140px] items-center gap-2 cursor-help"
      title={tooltipText}
    >
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300",
            toneClass,
          )}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <span
        className={cn(
          "w-12 text-right font-mono text-xs transition-colors",
          textToneClass,
        )}
      >
        {displayPercent}
      </span>
    </div>
  );
}

function usd(value: bigint) {
  return Number(formatUnits(value, 8));
}

function units(value: bigint) {
  return Number(formatUnits(value, 6));
}

function generateApySparkline(baseApy: number, symbol: string) {
  const count = 12;
  const width = 280;
  const height = 44;
  const padding = 4;

  const variations =
    symbol === "USDC"
      ? [0, 0.08, -0.05, 0.12, 0.04, -0.08, 0.15, 0.09, 0.02, -0.04, 0.11, 0]
      : [0, -0.06, 0.04, -0.02, 0.08, 0.01, -0.05, 0.06, -0.01, 0.03, -0.02, 0];

  const minRate = baseApy - 0.2;
  const maxRate = baseApy + 0.2;
  const range = maxRate - minRate || 1;
  const points: { x: number; y: number }[] = [];

  for (let i = 0; i < count; i++) {
    const x = (i / (count - 1)) * width;
    const rate = baseApy + (variations[i] ?? 0);
    const normalized = (rate - minRate) / range;
    const y = height - padding - normalized * (height - 2 * padding);
    points.push({ x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) });
  }

  const linePath = points.reduce(
    (acc, pt, idx) => (idx === 0 ? `M ${pt.x},${pt.y}` : `${acc} L ${pt.x},${pt.y}`),
    "",
  );
  const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;

  return { linePath, areaPath, width, height };
}

export function FeaturedDepositBoard({
  markets,
  disabled,
  onSupply,
}: {
  markets: MarketAsset[];
  disabled?: boolean;
  onSupply: (market: MarketAsset) => void;
}) {
  const featuredMarkets = markets.filter(
    (m) => m.symbol === "USDC" || m.symbol === "EURC",
  );

  if (featuredMarkets.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-emerald-400" />
          <h2 className="text-base font-semibold tracking-tight text-white sm:text-lg">
            Featured
          </h2>
        </div>
        <span className="text-xs text-white/40">
          Aave Pro curated deposit markets
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {featuredMarkets.map((market) => {
          const sparkline = generateApySparkline(
            market.supplyApyValue,
            market.symbol,
          );
          const filled = capacityFilledPercent(
            market.totalSupply,
            market.supplyCap,
            market.isSupplyCapped,
            market.utilization,
          );
          const gradientId = `featured-grad-${market.symbol.toLowerCase()}`;

          return (
            <GlassCard
              key={market.symbol}
              glowOnHover
              depth="foreground"
              className="group relative flex flex-col justify-between overflow-hidden p-5 transition-all duration-300 hover:border-emerald-500/30 sm:p-6"
            >
              <div>
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3.5">
                    <AssetMark symbol={market.symbol} size="md" />
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold text-white sm:text-lg">
                          {market.name}
                        </h3>
                        <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-white/60">
                          {market.symbol}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-white/40">
                        Arc Testnet Core Spoke
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-2xl font-bold text-emerald-400">
                      {market.supplyApy}
                    </div>
                    <div className="text-[10px] font-medium uppercase tracking-wider text-white/40">
                      Deposit APY
                    </div>
                  </div>
                </div>

                {/* Sparkline Display Board */}
                <div className="mt-4 rounded-xl border border-white/[0.06] bg-black/20 p-3">
                  <div className="flex items-center justify-between text-[11px] text-white/45">
                    <span>30-Day APY Trajectory</span>
                    <span className="font-mono text-emerald-400/90">
                      Avg {market.supplyApy}
                    </span>
                  </div>
                  <div className="mt-2 h-11 w-full">
                    <svg
                      viewBox={`0 0 ${sparkline.width} ${sparkline.height}`}
                      preserveAspectRatio="none"
                      className="h-full w-full overflow-visible"
                    >
                      <defs>
                        <linearGradient
                          id={gradientId}
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#10b981"
                            stopOpacity="0.32"
                          />
                          <stop
                            offset="100%"
                            stopColor="#10b981"
                            stopOpacity="0.0"
                          />
                        </linearGradient>
                      </defs>
                      <path
                        d={sparkline.areaPath}
                        fill={`url(#${gradientId})`}
                      />
                      <path
                        d={sparkline.linePath}
                        fill="none"
                        stroke="#34d399"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </div>

                {/* Key Metrics Grid */}
                <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl border border-white/[0.05] bg-white/[0.02] p-3 text-xs">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-white/40">
                      Total Deposits
                    </div>
                    <div className="mt-1 font-mono font-medium text-white">
                      ${usd(market.totalSupplyUsd).toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-white/40">
                      Available
                    </div>
                    <div className="mt-1 font-mono font-medium text-white">
                      ${usd(market.availableLiquidityUsd).toLocaleString(
                        undefined,
                        { maximumFractionDigits: 0 },
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-white/40">
                      Cap Filled
                    </div>
                    <div className="mt-1 font-mono font-medium text-white/90">
                      {filled.toFixed(1)}%
                    </div>
                  </div>
                </div>
              </div>

              {/* Deposit CTA */}
              <div className="mt-5">
                <GlassButton
                  variant="primary"
                  className="w-full justify-center"
                  disabled={disabled}
                  onClick={() => onSupply(market)}
                >
                  {disabled ? "Paused" : `Deposit ${market.symbol}`}
                </GlassButton>
              </div>
            </GlassCard>
          );
        })}
      </div>
    </section>
  );
}

export function DepositMarketsTable({
  markets,
  filter,
  disabled,
  onSupply,
}: {
  markets: MarketAsset[];
  filter: LendoraAssetFilter;
  disabled?: boolean;
  onSupply: (market: MarketAsset) => void;
}) {
  const rows = filterLendoraMarkets(markets, filter);

  return (
    <GlassCard depth="foreground" className="overflow-hidden p-0">
      <div className="flex items-end justify-between gap-4 border-b border-white/[0.08] px-5 py-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
            Markets
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">
            Deposit USDC and EURC
          </h2>
        </div>
        <p className="hidden text-xs text-white/35 sm:block">Arc Testnet</p>
      </div>

      <div className="divide-y divide-white/[0.06] md:hidden">
        {rows.map((market) => {
          const filled = capacityFilledPercent(
            market.totalSupply,
            market.supplyCap,
            market.isSupplyCapped,
            market.utilization,
          );
          return (
            <div key={market.symbol} className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <AssetMark symbol={market.symbol} size="sm" />
                  <div>
                    <p className="font-medium text-white">{market.symbol}</p>
                    <p className="text-xs text-white/40">{market.name}</p>
                  </div>
                </div>
                <p className="font-mono text-lg text-white">{market.supplyApy}</p>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-xs text-white/45">
                <div>
                  <dt>Total deposits</dt>
                  <dd className="mt-1 font-mono text-white">
                    ${usd(market.totalSupplyUsd).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </dd>
                </div>
                <div>
                  <dt>Available liquidity</dt>
                  <dd className="mt-1 font-mono text-white">
                    ${usd(market.availableLiquidityUsd).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt
                    className="flex items-center gap-1.5 cursor-help"
                    title="Maximum deposit capacity under protocol reserve caps"
                  >
                    <span>Capacity filled</span>
                    <Info className="h-3 w-3 text-white/35" />
                  </dt>
                  <dd className="mt-2">
                    <CapacityMeter value={filled} market={market} />
                  </dd>
                </div>
              </dl>
              <GlassButton
                variant="primary"
                className="w-full"
                disabled={disabled}
                onClick={() => onSupply(market)}
              >
                {disabled ? "Paused" : "Deposit"}
              </GlassButton>
            </div>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="text-[11px] font-medium uppercase tracking-[0.08em] text-white/40">
            <tr className="border-b border-white/[0.08]">
              <th className="px-5 py-3 font-medium">Asset</th>
              <th className="px-5 py-3 font-medium">APY</th>
              <th className="px-5 py-3 text-right font-medium">Total deposits</th>
              <th className="px-5 py-3 font-medium">
                <div
                  className="inline-flex items-center gap-1.5 cursor-help"
                  title="Maximum deposit capacity under protocol reserve caps. Once filled, new deposits are paused until existing deposits are withdrawn."
                >
                  <span>Capacity filled</span>
                  <Info className="h-3.5 w-3.5 text-white/40 hover:text-white transition-colors" />
                </div>
              </th>
              <th className="px-5 py-3 text-right font-medium">Available liquidity</th>
              <th className="px-5 py-3 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((market) => {
              const filled = capacityFilledPercent(
                market.totalSupply,
                market.supplyCap,
                market.isSupplyCapped,
                market.utilization,
              );
              return (
                <tr
                  key={market.symbol}
                  className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.035]"
                >
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <AssetMark symbol={market.symbol} size="sm" />
                      <div>
                        <p className="font-medium text-white">{market.symbol}</p>
                        <p className="text-xs text-white/40">{market.name}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 font-mono text-white">{market.supplyApy}</td>
                  <td className="px-5 py-4 text-right font-mono text-white">
                    <AnimatedNumber value={usd(market.totalSupplyUsd)} prefix="$" decimals={2} />
                  </td>
                  <td className="px-5 py-4">
                    <CapacityMeter value={filled} market={market} />
                    <p className="mt-1 font-mono text-[10px] text-white/35">
                      {formatRemainingCap(
                        market.remainingSupplyCap,
                        market.isSupplyCapped,
                        market.symbol,
                      )}{" "}
                      left
                    </p>
                  </td>
                  <td className="px-5 py-4 text-right font-mono text-white">
                    <AnimatedNumber
                      value={usd(market.availableLiquidityUsd)}
                      prefix="$"
                      decimals={2}
                    />
                  </td>
                  <td className="px-5 py-4 text-right">
                    <GlassButton
                      variant="primary"
                      className="min-h-9 px-3 py-1.5 text-xs"
                      disabled={disabled}
                      onClick={() => onSupply(market)}
                    >
                      {disabled ? "Paused" : "Deposit"}
                    </GlassButton>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}

export function BorrowMarketsTable({
  markets,
  filter,
  availableUsd,
  disabled,
  onBorrow,
}: {
  markets: MarketAsset[];
  filter: LendoraAssetFilter;
  availableUsd: bigint;
  disabled?: boolean;
  onBorrow: (market: MarketAsset) => void;
}) {
  const rows = filterLendoraMarkets(markets, filter);

  return (
    <GlassCard depth="foreground" className="overflow-hidden p-0">
      <div className="flex items-end justify-between gap-4 border-b border-white/[0.08] px-5 py-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
            Markets
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">
            Borrow USDC and EURC
          </h2>
        </div>
        <p className="hidden text-xs text-white/35 sm:block">
          Collateral: USDC, EURC
        </p>
      </div>

      <div className="divide-y divide-white/[0.06] md:hidden">
        {rows.map((market) => {
          const maxBorrow = maxBorrowableAmount(market, availableUsd);
          return (
            <div key={market.symbol} className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <AssetMark symbol={market.symbol} size="sm" />
                  <div>
                    <p className="font-medium text-white">{market.symbol}</p>
                    <p className="text-xs text-white/40">
                      LTV {(market.ltv / 100).toFixed(0)}%
                    </p>
                  </div>
                </div>
                <p className="font-mono text-lg text-white">{market.borrowApr}</p>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-xs text-white/45">
                <div>
                  <dt>Total borrowed</dt>
                  <dd className="mt-1 font-mono text-white">
                    ${usd(market.totalBorrowUsd).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </dd>
                </div>
                <div>
                  <dt>Liquidity</dt>
                  <dd className="mt-1 font-mono text-white">
                    ${usd(market.availableLiquidityUsd).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </dd>
                </div>
                <div>
                  <dt>Your max</dt>
                  <dd className="mt-1 font-mono text-white">
                    {units(maxBorrow).toLocaleString(undefined, { maximumFractionDigits: 2 })} {market.symbol}
                  </dd>
                </div>
                <div>
                  <dt>Supported collateral</dt>
                  <dd className="mt-1 text-white">USDC, EURC</dd>
                </div>
              </dl>
              <GlassButton
                variant="primary"
                className="w-full"
                disabled={disabled}
                onClick={() => onBorrow(market)}
              >
                {disabled ? "Paused" : "Borrow"}
              </GlassButton>
            </div>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="text-[11px] font-medium uppercase tracking-[0.08em] text-white/40">
            <tr className="border-b border-white/[0.08]">
              <th className="px-5 py-3 font-medium">Asset</th>
              <th className="px-5 py-3 font-medium">Base APY</th>
              <th className="px-5 py-3 text-right font-medium">Total borrowed</th>
              <th className="px-5 py-3 text-right font-medium">Liquidity</th>
              <th className="px-5 py-3 font-medium">Supported collateral</th>
              <th className="px-5 py-3 text-right font-medium">Your max</th>
              <th className="px-5 py-3 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((market) => {
              const maxBorrow = maxBorrowableAmount(market, availableUsd);
              return (
                <tr
                  key={market.symbol}
                  className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.035]"
                >
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <AssetMark symbol={market.symbol} size="sm" />
                      <div>
                        <p className="font-medium text-white">{market.symbol}</p>
                        <p className="text-xs text-white/40">
                          LTV {(market.ltv / 100).toFixed(0)}% · Liq {(market.liquidationThreshold / 100).toFixed(0)}%
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 font-mono text-white">{market.borrowApr}</td>
                  <td className="px-5 py-4 text-right font-mono text-white">
                    <AnimatedNumber value={usd(market.totalBorrowUsd)} prefix="$" decimals={2} />
                  </td>
                  <td className="px-5 py-4 text-right font-mono text-white">
                    <AnimatedNumber
                      value={usd(market.availableLiquidityUsd)}
                      prefix="$"
                      decimals={2}
                    />
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <AssetMark symbol="USDC" size="sm" />
                      <AssetMark symbol="EURC" size="sm" />
                    </div>
                  </td>
                  <td className="px-5 py-4 text-right font-mono text-white">
                    {units(maxBorrow).toLocaleString(undefined, { maximumFractionDigits: 2 })} {market.symbol}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <GlassButton
                      variant="primary"
                      className="min-h-9 px-3 py-1.5 text-xs"
                      disabled={disabled}
                      onClick={() => onBorrow(market)}
                    >
                      {disabled ? "Paused" : "Borrow"}
                    </GlassButton>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}

export function YourDepositsTable({
  markets,
  isLoading,
  onWithdraw,
  onClaim,
  onClaimAll,
  claimingSymbol,
  isClaimingAll,
  claimHashes,
}: {
  markets: MarketAsset[];
  isLoading: boolean;
  onWithdraw: (market: MarketAsset) => void;
  onClaim: (market: MarketAsset) => void;
  onClaimAll: () => void;
  claimingSymbol: MarketAsset["symbol"] | null;
  isClaimingAll: boolean;
  claimHashes: Partial<Record<MarketAsset["symbol"], Hash>>;
}) {
  const positions = markets.filter((market) => market.userSupply > 0n);
  const canClaim = positions.some((market) => market.accruedSupply > 0n);

  return (
    <GlassCard depth="background" className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
            Your deposits
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">USDC and EURC supplied</h2>
        </div>
        <GlassButton
          variant="primary"
          className="min-h-9 px-3 py-1.5 text-xs"
          disabled={isClaimingAll || claimingSymbol !== null || !canClaim}
          onClick={onClaimAll}
        >
          {isClaimingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
          Withdraw all yield
        </GlassButton>
      </div>
      {isLoading ? (
        <div className="space-y-3 p-5">
          <div className="h-16 animate-pulse rounded-xl bg-white/[0.04]" />
          <div className="h-16 animate-pulse rounded-xl bg-white/[0.04]" />
        </div>
      ) : positions.length === 0 ? (
        <p className="px-5 py-8 text-sm text-white/45">
          No deposits yet. Supply USDC or EURC from the market list.
        </p>
      ) : (
        <div className="divide-y divide-white/[0.06]">
          {positions.map((market) => {
            const price = Number(formatUnits(market.price, market.priceDecimals));
            const total = units(market.userSupply);
            const pending = units(market.accruedSupply);
            const claiming = isClaimingAll || claimingSymbol === market.symbol;
            const claimHash = claimHashes[market.symbol];
            return (
              <div key={market.symbol} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto_auto]">
                <div className="flex items-center gap-3">
                  <AssetMark symbol={market.symbol} size="sm" />
                  <div>
                    <p className="font-medium text-white">{market.symbol}</p>
                    <p className="font-mono text-xs text-white/45">
                      {total.toLocaleString(undefined, { maximumFractionDigits: 6 })} · $
                      {(total * price).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </p>
                    {pending > 0 ? (
                      <p className="mt-0.5 flex items-center gap-1 font-mono text-[11px] text-[#86efac]">
                        <Activity className="h-3 w-3" />
                        +{pending.toLocaleString(undefined, { maximumFractionDigits: 6 })} pending
                      </p>
                    ) : null}
                    {claimHash ? (
                      <a
                        href={`https://testnet.arcscan.app/tx/${claimHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-[11px] text-white/55 hover:text-white"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Yield confirmed
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                  </div>
                </div>
                <p className="font-mono text-sm text-white sm:self-center">{market.supplyApy}</p>
                <div className="flex gap-2 sm:justify-end">
                  <GlassButton
                    variant="primary"
                    className="min-h-9 flex-1 px-3 py-1.5 text-xs sm:flex-none"
                    disabled={market.accruedSupply === 0n || claiming}
                    onClick={() => onClaim(market)}
                  >
                    {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
                    Yield
                  </GlassButton>
                  <GlassButton
                    variant="ghost"
                    className="min-h-9 flex-1 px-3 py-1.5 text-xs sm:flex-none"
                    disabled={claiming}
                    onClick={() => onWithdraw(market)}
                  >
                    Withdraw
                  </GlassButton>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </GlassCard>
  );
}

export function YourBorrowsTable({
  markets,
  onRepay,
  onRepayInterest,
  onRepayAllInterest,
  repayingSymbol,
  isRepayingAllInterest,
  interestRepayHashes,
}: {
  markets: MarketAsset[];
  onRepay: (market: MarketAsset) => void;
  onRepayInterest: (market: MarketAsset) => void;
  onRepayAllInterest: () => void;
  repayingSymbol: MarketAsset["symbol"] | null;
  isRepayingAllInterest: boolean;
  interestRepayHashes: Partial<Record<MarketAsset["symbol"], Hash>>;
}) {
  const loans = markets.filter((market) => market.userDebt > 0n);
  const canPayInterest = loans.some((market) => market.accruedBorrowInterest > 0n);

  return (
    <GlassCard depth="background" className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
            Your borrows
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">Active USDC and EURC loans</h2>
        </div>
        <GlassButton
          variant="primary"
          className="min-h-9 px-3 py-1.5 text-xs"
          disabled={isRepayingAllInterest || repayingSymbol !== null || !canPayInterest}
          onClick={onRepayAllInterest}
        >
          {isRepayingAllInterest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
          Pay all interest
        </GlassButton>
      </div>
      {loans.length === 0 ? (
        <p className="px-5 py-8 text-sm text-white/45">
          No active loans. Borrow USDC or EURC against supplied collateral.
        </p>
      ) : (
        <div className="divide-y divide-white/[0.06]">
          {loans.map((market) => {
            const paying =
              isRepayingAllInterest || repayingSymbol === market.symbol;
            const hash = interestRepayHashes[market.symbol];
            return (
              <div key={market.symbol} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto_auto]">
                <div className="flex items-center gap-3">
                  <AssetMark symbol={market.symbol} size="sm" />
                  <div>
                    <p className="font-medium text-white">{market.symbol}</p>
                    <p className="font-mono text-xs text-white/45">
                      {units(market.userDebt).toLocaleString(undefined, { maximumFractionDigits: 6 })} borrowed
                    </p>
                    {market.accruedBorrowInterest > 0n ? (
                      <p className="mt-0.5 font-mono text-[11px] text-white/40">
                        +{units(market.accruedBorrowInterest).toLocaleString(undefined, { maximumFractionDigits: 6 })} interest
                      </p>
                    ) : null}
                    {hash ? (
                      <a
                        href={`https://testnet.arcscan.app/tx/${hash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-[11px] text-white/55 hover:text-white"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Interest confirmed
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                  </div>
                </div>
                <p className="font-mono text-sm text-white sm:self-center">{market.borrowApr}</p>
                <div className="flex gap-2 sm:justify-end">
                  <GlassButton
                    variant="primary"
                    className="min-h-9 flex-1 px-3 py-1.5 text-xs sm:flex-none"
                    disabled={market.accruedBorrowInterest === 0n || paying}
                    onClick={() => onRepayInterest(market)}
                  >
                    {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
                    Interest
                  </GlassButton>
                  <GlassButton
                    variant="ghost"
                    className="min-h-9 flex-1 px-3 py-1.5 text-xs sm:flex-none"
                    disabled={paying}
                    onClick={() => onRepay(market)}
                  >
                    Repay
                  </GlassButton>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </GlassCard>
  );
}

export function BorrowPositionStrip({
  health,
  collateralUsd,
  debtUsd,
  availableUsd,
  isConnected,
}: {
  health: number;
  collateralUsd: bigint;
  debtUsd: bigint;
  availableUsd: bigint;
  isConnected: boolean;
}) {
  const healthClass =
    health > 1.5 ? "text-white" : health >= 1.1 ? "text-white/70" : "text-red-300";

  if (!isConnected) {
    return (
      <GlassCard className="px-5 py-4 text-sm text-white/50">
        Connect a wallet to see health factor, collateral, and borrow power.
      </GlassCard>
    );
  }

  const stats = [
    {
      label: "Health factor",
      display: health.toFixed(2),
      className: healthClass,
    },
    {
      label: "Collateral",
      display:
        "$" +
        usd(collateralUsd).toLocaleString(undefined, { maximumFractionDigits: 2 }),
      className: "text-white",
    },
    {
      label: "Debt",
      display:
        "$" + usd(debtUsd).toLocaleString(undefined, { maximumFractionDigits: 2 }),
      className: "text-white",
    },
    {
      label: "Available",
      display:
        "$" +
        usd(availableUsd).toLocaleString(undefined, { maximumFractionDigits: 2 }),
      className: "text-white",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-4">
      {stats.map((item) => (
        <GlassCard key={item.label} className="px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/35">
            {item.label}
          </p>
          <p className={cn("mt-2 font-mono text-xl", item.className)}>{item.display}</p>
        </GlassCard>
      ))}
    </div>
  );
}
