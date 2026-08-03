"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  ArrowDownCircle,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpCircle,
  ArrowUpRight,
  Award,
  Bot,
  Circle,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Volume2,
  VolumeX,
} from "lucide-react";
import { formatUnits } from "viem";
import { useLiveMarkets } from "@/hooks/useLiveMarkets";
import { cn } from "@/lib/utils";

const features = [
  { index: "01", title: "Lend", copy: "Supply stablecoins, earn real-time yield.", icon: ArrowUpCircle },
  { index: "02", title: "Borrow", copy: "Borrow against your collateral, instantly.", icon: ArrowDownCircle },
  { index: "03", title: "Swap", copy: "Trade USDC, EURC, and more, natively on Arc.", icon: RefreshCw },
  { index: "04", title: "Bridge", copy: "Move liquidity onto Arc from any chain.", icon: ArrowLeftRight },
  { index: "05", title: "Positions", copy: "Every position, a receipt in your wallet.", icon: Award },
  { index: "06", title: "Assistant", copy: "Just tell it what you want to do.", icon: Bot },
];

const steps = [
  { index: "01", title: "Connect", copy: "Bring the wallet you already use." },
  { index: "02", title: "Supply or borrow", copy: "Choose an isolated stablecoin market." },
  { index: "03", title: "Track your position", copy: "Rates, health, and receipts stay visible." },
];

function emitSound(type: "whoosh" | "rise") {
  window.dispatchEvent(new CustomEvent("arclend:landing-sound", { detail: type }));
}

function BrandReveal({ className, label = "ArcLend" }: { className?: string; label?: string }) {
  const lendStart = label.lastIndexOf("Lend");

  return (
    <span className={cn("cinematic-display inline-flex overflow-hidden", className)} aria-label={label}>
      {label.split("").map((letter, index) => (
        <span
          className={cn(
            "brand-letter",
            lendStart >= 0 && index >= lendStart && "text-[#86efac]",
          )}
          aria-hidden="true"
          key={`${letter}-${index}`}
        >
          {letter}
        </span>
      ))}
    </span>
  );
}

function CustomCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const cursor = cursorRef.current;
    if (!cursor) return;
    const moveX = gsap.quickTo(cursor, "x", { duration: 0.18, ease: "power3.out" });
    const moveY = gsap.quickTo(cursor, "y", { duration: 0.18, ease: "power3.out" });

    const onMove = (event: PointerEvent) => {
      moveX(event.clientX);
      moveY(event.clientY);
      cursor.dataset.active = String(Boolean((event.target as Element | null)?.closest("a,button,[data-cursor]")));
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return <div ref={cursorRef} className="cinematic-cursor" data-active="false" aria-hidden="true" />;
}

function SoundToggle() {
  const [enabled, setEnabled] = useState(false);
  const contextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    setEnabled(window.localStorage.getItem("arclend-landing-sound") === "on");
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const getContext = () => {
      contextRef.current ??= new AudioContext();
      void contextRef.current.resume();
      return contextRef.current;
    };
    const play = (type: "tick" | "whoosh" | "rise") => {
      const context = getContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.connect(gain).connect(context.destination);
      const now = context.currentTime;
      const duration = type === "tick" ? 0.035 : type === "rise" ? 0.34 : 0.24;
      oscillator.type = type === "tick" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(type === "tick" ? 720 : type === "rise" ? 120 : 92, now);
      oscillator.frequency.exponentialRampToValueAtTime(type === "tick" ? 540 : type === "rise" ? 220 : 54, now + duration);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(type === "tick" ? 0.018 : 0.028, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.start(now);
      oscillator.stop(now + duration);
    };
    const onSound = (event: Event) => play((event as CustomEvent<"whoosh" | "rise">).detail);
    const onPointerOver = (event: PointerEvent) => {
      const interactive = (event.target as Element | null)?.closest("a,button");
      const previous = (event.relatedTarget as Element | null)?.closest?.("a,button");
      if (interactive && interactive !== previous) play("tick");
    };
    window.addEventListener("arclend:landing-sound", onSound);
    window.addEventListener("pointerover", onPointerOver, { passive: true });
    return () => {
      window.removeEventListener("arclend:landing-sound", onSound);
      window.removeEventListener("pointerover", onPointerOver);
    };
  }, [enabled]);

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    window.localStorage.setItem("arclend-landing-sound", next ? "on" : "off");
    if (!next) void contextRef.current?.suspend();
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      aria-label={enabled ? "Mute landing page sounds" : "Enable landing page sounds"}
      className="fixed bottom-5 right-5 z-[120] flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/55 text-white/55 backdrop-blur-2xl transition hover:scale-105 hover:border-white/20 hover:text-white active:scale-95"
    >
      {enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
    </button>
  );
}

function FeaturePanel({ feature }: { feature: (typeof features)[number] }) {
  const Icon = feature.icon;
  return (
    <article className="feature-panel relative flex min-h-[68vh] shrink-0 flex-col justify-between overflow-hidden rounded-[2rem] border border-white/[0.09] bg-white/[0.055] p-7 shadow-[0_40px_140px_rgba(0,0,0,0.68),inset_0_1px_0_rgba(255,255,255,0.09)] backdrop-blur-3xl sm:p-10 lg:p-14">
      <span className="absolute right-8 top-7 font-mono text-xs text-white/25">{feature.index}</span>
      <div data-draw-icon className="flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-black/20 text-white/80 sm:h-24 sm:w-24">
        <Icon className="h-9 w-9 sm:h-11 sm:w-11" strokeWidth={1.15} />
      </div>
      <div>
        <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.22em] text-white/30">ArcLend / {feature.index}</p>
        <h2 className="cinematic-display text-5xl font-medium tracking-[-0.06em] text-white sm:text-7xl lg:text-8xl">{feature.title}</h2>
        <p className="mt-5 max-w-xl text-lg font-light leading-relaxed text-white/50 sm:text-2xl">{feature.copy}</p>
      </div>
    </article>
  );
}

type StatTrend = {
  direction: "up" | "down" | "flat";
  percentage: number | null;
  comparison: string;
};

type ProtocolStatsResponse = {
  stats: {
    tvl: { valueUsdMicro: string; trend: StatTrend };
    totalVolume: { valueUsdMicro: string; trend: StatTrend };
    totalBorrowed: { valueUsdMicro: string; trend: StatTrend };
    activePositions: { value: string; trend: StatTrend };
  };
  coverage: {
    complete: boolean;
    methodology: string;
    routeAttribution: string;
  };
  updatedAt: string;
};

type StatValueProps = {
  label: string;
  value: number;
  prefix?: string;
  primary?: boolean;
  className?: string;
  trend?: StatTrend;
};

function StatValue({
  label,
  value,
  prefix = "",
  primary = false,
  className,
  trend,
}: StatValueProps) {
  const TrendIcon =
    trend?.direction === "up"
      ? ArrowUpRight
      : trend?.direction === "down"
        ? ArrowDownRight
        : null;
  const trendValue =
    trend?.percentage === null
      ? "New"
      : `${trend?.direction === "up" ? "+" : trend?.direction === "down" ? "−" : ""}${(trend?.percentage ?? 0).toFixed(1)}%`;

  return (
    <div className={className}>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/50">{label}</p>
      <div className="mt-4 flex items-center gap-2 sm:gap-3">
        {TrendIcon ? (
          <TrendIcon
            aria-hidden="true"
            className={cn(
              "shrink-0",
              primary
                ? "h-10 w-10 sm:h-16 sm:w-16"
                : "h-6 w-6 sm:h-8 sm:w-8",
              trend?.direction === "up"
                ? "text-[#86efac]"
                : "text-[#fca5a5]",
            )}
            strokeWidth={1.45}
          />
        ) : null}
        <p
          data-count
          data-target={Number.isFinite(value) ? value : 0}
          data-prefix={prefix}
          className={cn(
            "font-mono tabular-nums tracking-[-0.06em] text-white",
            primary
              ? "text-[clamp(4.5rem,12vw,11rem)] leading-[0.78]"
              : "text-4xl sm:text-6xl",
          )}
        >
          {prefix}0
        </p>
      </div>
      {trend ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.1em]">
          <span
            className={cn(
              "inline-flex items-center",
              trend.direction === "up"
                ? "text-[#86efac]"
                : trend.direction === "down"
                  ? "text-[#fca5a5]"
                  : "text-white/40",
            )}
          >
            {trendValue}
          </span>
          <span className="text-white/25">{trend.comparison}</span>
        </div>
      ) : null}
    </div>
  );
}

function animateCounters(counters: NodeListOf<HTMLElement>) {
  counters.forEach((counter, index) => {
    const target = Number(counter.dataset.target ?? 0);
    const prefix = counter.dataset.prefix ?? "";
    const state = { value: 0 };
    gsap.to(state, {
      value: target,
      duration: 1.15,
      delay: index * 0.08,
      ease: "power3.out",
      onUpdate: () => {
        counter.textContent = `${prefix}${Math.round(state.value).toLocaleString()}`;
      },
    });
  });
}

export function CinematicHome() {
  const rootRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const heroBrandRef = useRef<HTMLHeadingElement>(null);
  const miniHeaderRef = useRef<HTMLElement>(null);
  const featureSectionRef = useRef<HTMLElement>(null);
  const featureTrackRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLElement>(null);
  const finalRef = useRef<HTMLElement>(null);
  const hasAnimated = useRef(false);
  const { markets } = useLiveMarkets();
  const [protocolStats, setProtocolStats] =
    useState<ProtocolStatsResponse | null>(null);

  const totalSupply = markets.reduce((sum, market) => sum + market.totalSupplyUsd, 0n);
  const totalBorrow = markets.reduce((sum, market) => sum + market.totalBorrowUsd, 0n);
  const tvl = protocolStats
    ? Number(BigInt(protocolStats.stats.tvl.valueUsdMicro)) / 1_000_000
    : Number(formatUnits(totalSupply, 8));
  const borrowed = protocolStats
    ? Number(BigInt(protocolStats.stats.totalBorrowed.valueUsdMicro)) / 1_000_000
    : Number(formatUnits(totalBorrow, 8));
  const volume = protocolStats
    ? Number(BigInt(protocolStats.stats.totalVolume.valueUsdMicro)) / 1_000_000
    : 0;
  const activePositions = protocolStats
    ? Number(BigInt(protocolStats.stats.activePositions.value))
    : 0;

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await fetch("/api/protocol/stats", {
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as ProtocolStatsResponse;
        if (active) setProtocolStats(payload);
      } catch {
        // Keep the live reserve fallback visible when the public index is unavailable.
      }
    };

    void load();
    const interval = window.setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useLayoutEffect(() => {
    if (!rootRef.current) return;
    gsap.registerPlugin(ScrollTrigger);
    const root = rootRef.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const context = gsap.context(() => {
      document.documentElement.style.setProperty("--scene-opacity", "0.18");

      if (!reduced) {
        gsap.set(".hero-brand .brand-letter", { yPercent: 115, opacity: 0, filter: "blur(18px)" });
        gsap.to(".hero-brand .brand-letter", {
          yPercent: 0,
          opacity: 1,
          filter: "blur(0px)",
          duration: 0.82,
          stagger: 0.04,
          ease: "power4.out",
        });
        gsap.fromTo(
          ".hero-support",
          { y: 24, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.7, delay: 0.52, stagger: 0.09, ease: "power3.out" },
        );
        // Scroll-shrink the wordmark only. The logo mark stays outside this
        // ref so GSAP can never leave it stuck at opacity 0.
        gsap.to(heroBrandRef.current, {
          scale: 0.22,
          xPercent: -12,
          yPercent: -48,
          opacity: 0.16,
          transformOrigin: "left top",
          ease: "none",
          scrollTrigger: {
            trigger: heroRef.current,
            start: "top top",
            end: "bottom top",
            scrub: 1,
          },
        });
        gsap.to(miniHeaderRef.current, {
          autoAlpha: 1,
          y: 0,
          ease: "none",
          scrollTrigger: { trigger: heroRef.current, start: "45% top", end: "bottom top", scrub: true },
        });

        const track = featureTrackRef.current;
        const section = featureSectionRef.current;
        if (track && section && window.matchMedia("(min-width: 768px)").matches) {
          const panels = gsap.utils.toArray<HTMLElement>(".feature-panel", track);
          const distance = () => Math.max(0, track.scrollWidth - window.innerWidth);
          const horizontal = gsap.to(track, {
            x: () => -distance(),
            ease: "none",
            scrollTrigger: {
              trigger: section,
              start: "top top",
              end: () => `+=${distance() + window.innerHeight * 1.4}`,
              pin: true,
              scrub: 1,
              anticipatePin: 1,
              invalidateOnRefresh: true,
              onEnter: () => emitSound("whoosh"),
              onUpdate: () => {
                panels.forEach((panel) => {
                  const rect = panel.getBoundingClientRect();
                  const delta = Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2);
                  const focus = Math.min(1, delta / (window.innerWidth * 0.68));
                  gsap.set(panel, { opacity: 1 - focus * 0.64, scale: 1 - focus * 0.1 });
                });
              },
            },
          });

          panels.forEach((panel) => {
            const strokes = panel.querySelectorAll("[data-draw-icon] svg path, [data-draw-icon] svg circle, [data-draw-icon] svg line, [data-draw-icon] svg polyline");
            gsap.set(strokes, { strokeDasharray: 90, strokeDashoffset: 90 });
            gsap.to(strokes, {
              strokeDashoffset: 0,
              duration: 1,
              ease: "power2.out",
              scrollTrigger: { trigger: panel, containerAnimation: horizontal, start: "left 68%", once: true },
            });
          });
        }

        gsap.from(".editorial-reveal", {
          y: 50,
          opacity: 0,
          filter: "blur(12px)",
          duration: 1,
          ease: "power3.out",
          scrollTrigger: { trigger: ".about-section", start: "top 68%", onEnter: () => emitSound("whoosh") },
        });
        gsap.from(".how-step", {
          y: 30,
          opacity: 0,
          stagger: 0.14,
          duration: 0.7,
          ease: "power3.out",
          scrollTrigger: { trigger: ".how-flow", start: "top 76%" },
        });
      }

      gsap.to(document.documentElement, {
        "--scene-opacity": 0.07,
        ease: "none",
        scrollTrigger: { trigger: statsRef.current, start: "top bottom", end: "center center", scrub: true },
      });
      gsap.to(document.documentElement, {
        "--scene-opacity": 0.19,
        ease: "none",
        scrollTrigger: { trigger: finalRef.current, start: "top bottom", end: "center center", scrub: true },
      });
    }, root);

    return () => {
      context.revert();
      document.documentElement.style.removeProperty("--scene-opacity");
    };
  }, []);

  // Fire counter animations when data updates after the initial scroll has already happened.
  useEffect(() => {
    const section = statsRef.current;
    if (!section || !hasAnimated.current) return;
    const counters = section.querySelectorAll<HTMLElement>("[data-count]");
    animateCounters(counters);
  }, [activePositions, borrowed, tvl, volume]);

  useLayoutEffect(() => {
    const section = statsRef.current;
    if (!section) return;
    gsap.registerPlugin(ScrollTrigger);
    const counters = section.querySelectorAll<HTMLElement>("[data-count]");
    const path = section.querySelector<SVGPathElement>("[data-volume-path]");
    const length = path?.getTotalLength() ?? 0;
    if (path) gsap.set(path, { strokeDasharray: length, strokeDashoffset: length });

    // If already animated (e.g. data arrived after first scroll), skip re-creating trigger.
    if (hasAnimated.current) return;

    const trigger = ScrollTrigger.create({
      trigger: section,
      start: "top 62%",
      once: true,
      onEnter: () => {
        hasAnimated.current = true;
        emitSound("rise");
        animateCounters(counters);
        if (path) gsap.to(path, { strokeDashoffset: 0, duration: 1.6, ease: "power2.out" });
      },
    });
    return () => trigger.kill();
  }, [activePositions, borrowed, tvl, volume]);

  return (
    <div ref={rootRef} className="cinematic-home text-white">
      <CustomCursor />
      <SoundToggle />

      <header ref={miniHeaderRef} className="pointer-events-none fixed inset-x-0 top-0 z-[110] flex translate-y-[-14px] items-center justify-between border-b border-white/[0.07] bg-black/55 px-5 py-4 opacity-0 backdrop-blur-2xl sm:px-8">
        <Link href="/" className="pointer-events-auto cinematic-display flex items-center gap-2.5 text-lg font-medium tracking-[-0.05em]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/arclend-mark.png"
            alt=""
            width={28}
            height={28}
            className="h-7 w-7 object-contain"
            style={{ opacity: 1, visibility: "visible" }}
          />
          Arc<span className="text-[#86efac]">Lend</span>
        </Link>
        <Link href="/dashboard" className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-white/15 bg-white px-4 py-2 text-xs font-semibold text-black transition hover:scale-105 active:scale-95">Launch app <ArrowRight className="h-3.5 w-3.5" /></Link>
      </header>

      <section ref={heroRef} className="relative flex min-h-screen items-end overflow-x-clip px-4 pb-12 pt-28 sm:px-8 sm:pb-16 lg:px-12">
        <div className="relative z-10 w-full">
          <p className="hero-support mb-5 font-mono text-[10px] uppercase tracking-[0.24em] text-white/35">Credit layer / Arc Network</p>
          <div className="flex w-full flex-col items-start gap-4 sm:flex-row sm:items-end sm:gap-5 md:gap-7">
            {/*
              Logo is outside heroBrandRef and never GSAP-targeted.
              Transparent mark + fixed heights so it cannot collapse or stay opacity:0.
            */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/arclend-mark.png"
              alt="ArcLend logo"
              width={381}
              height={259}
              decoding="sync"
              fetchPriority="high"
              className="relative z-30 block h-[88px] w-auto max-w-[min(42vw,220px)] shrink-0 object-contain object-left sm:h-[120px] md:h-[160px] lg:h-[200px]"
              style={{
                opacity: 1,
                visibility: "visible",
                display: "block",
                pointerEvents: "none",
              }}
            />
            <div ref={heroBrandRef} className="min-w-0">
              <h1 className="hero-brand min-w-0 max-w-full overflow-hidden leading-[0.82] tracking-[-0.07em] sm:leading-[0.74] sm:tracking-[-0.085em]">
                <BrandReveal className="break-words text-[clamp(2.75rem,14vw,19rem)] font-medium sm:text-[clamp(4.2rem,18vw,19rem)]" />
              </h1>
            </div>
          </div>
          <div className="mt-8 flex flex-col justify-between gap-8 sm:flex-row sm:items-end">
            <div>
              <p className="hero-support font-mono text-sm text-white/55 sm:text-base">Lending and Borrowing built for Arc.</p>
              <div className="hero-support mt-6 flex flex-wrap gap-3">
                <Link href="/dashboard" className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-white bg-white px-6 py-3 text-sm font-semibold text-black transition duration-200 hover:scale-[1.02] hover:shadow-[0_0_34px_rgba(255,255,255,0.14)] active:scale-[0.96]">Launch App <ArrowRight className="h-4 w-4" /></Link>
              </div>
            </div>
            <div className="hero-support flex h-32 items-end gap-3 pr-3 text-white/30">
              <span className="origin-bottom-right -rotate-90 font-mono text-[9px] uppercase tracking-[0.24em]">Scroll</span>
              <span className="relative h-28 w-px overflow-hidden bg-white/10"><span className="absolute inset-x-0 top-0 h-1/2 animate-[scrollLine_2.2s_ease-in-out_infinite] bg-white/70" /></span>
            </div>
          </div>
        </div>
      </section>

      <section ref={featureSectionRef} className="relative flex min-h-screen items-center overflow-hidden border-y border-white/[0.05] bg-black/30 py-20 md:py-0">
        <div ref={featureTrackRef} className="feature-track gap-5 px-[12vw] md:gap-8 md:pr-[24vw]">
          {features.map((feature) => <FeaturePanel feature={feature} key={feature.index} />)}
        </div>
      </section>

      <section ref={statsRef} className="relative min-h-screen border-b border-white/[0.06] bg-black/[0.82] px-4 py-28 backdrop-blur-sm sm:px-8 lg:px-12 lg:py-36">
        <div className="mx-auto max-w-[1500px]">
          <div className="flex items-end justify-between gap-6 border-b border-white/[0.08] pb-6">
            <div><p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/50">Protocol volume</p><h2 className="mt-3 text-2xl font-medium tracking-[-0.04em] text-white sm:text-4xl">Capital, moving through Arc.</h2></div>
            <span className="hidden items-center gap-2 font-mono text-xs text-white/50 sm:flex">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#22c55e] shadow-[0_0_12px_rgba(34,197,94,0.55)]" aria-hidden="true" />
              LIVE / ARC TESTNET
            </span>
          </div>
          <div className="relative mt-16 grid grid-cols-1 gap-16 md:grid-cols-12 md:gap-8">
            <div className="relative md:col-span-9 md:row-span-2">
              <StatValue
                label="Total Value Locked"
                value={tvl}
                prefix="$"
                primary
                trend={protocolStats?.stats.tvl.trend}
              />
              <svg className="mt-10 h-28 w-full text-white/[0.18] sm:h-40" viewBox="0 0 900 180" fill="none" aria-hidden="true">
                <path data-volume-path d="M2 154 C120 148 138 118 228 125 C331 134 326 63 430 82 C516 98 570 34 650 51 C752 72 776 22 898 12" stroke="currentColor" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
              </svg>
            </div>
            <StatValue
              className="md:col-span-3 md:pt-4"
              label="Total Volume"
              value={volume}
              prefix="$"
              trend={protocolStats?.stats.totalVolume.trend}
            />
            <StatValue
              className="md:col-span-5 md:col-start-8 md:mt-10"
              label="Total Borrowed"
              value={borrowed}
              prefix="$"
              trend={protocolStats?.stats.totalBorrowed.trend}
            />
            <StatValue
              className="md:col-span-3 md:col-start-10 md:mt-8"
              label="Active Positions"
              value={activePositions}
              trend={protocolStats?.stats.activePositions.trend}
            />
          </div>
        </div>
      </section>

      <section className="about-section relative bg-black px-4 py-28 sm:px-8 lg:px-12 lg:py-40">
        <div className="mx-auto max-w-[1500px]">
          <p className="editorial-reveal cinematic-editorial max-w-6xl text-[clamp(1.85rem,7.2vw,7.6rem)] leading-[1.05] tracking-[-0.03em] text-white sm:leading-[0.98] sm:tracking-[-0.035em]">
            Instant, non-custodial credit built around the speed and USDC-native architecture of Arc.
          </p>

          <div className="how-flow relative mt-24 grid gap-10 border-t border-white/[0.08] pt-12 md:grid-cols-3 md:gap-0">
            <div className="absolute left-0 right-0 top-[6.35rem] hidden h-px bg-white/[0.08] md:block" />
            {steps.map((step) => (
              <div key={step.index} className="how-step relative md:px-8 first:pl-0 last:pr-0">
                <span className="relative z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-black font-mono text-[10px] text-white/50">{step.index}</span>
                <h3 className="mt-8 text-2xl font-medium tracking-[-0.04em]">{step.title}</h3>
                <p className="mt-3 max-w-xs text-sm leading-6 text-white/42">{step.copy}</p>
              </div>
            ))}
          </div>

          <div className="mt-20 flex flex-wrap gap-x-9 gap-y-4 border-y border-white/[0.07] py-5 text-xs text-white/38">
            <span className="flex items-center gap-2"><Circle className="h-3.5 w-3.5" /> Built on Arc Network</span>
            <span className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5" /> Non-custodial</span>
            <span className="flex items-center gap-2"><ScanLine className="h-3.5 w-3.5" /> Audited architecture</span>
          </div>
        </div>
      </section>

      <section ref={finalRef} className="relative flex min-h-screen items-center border-t border-white/[0.05] bg-black/30 px-4 py-28 sm:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-[1500px]">
          <p className="mb-6 font-mono text-[10px] uppercase tracking-[0.24em] text-white/30">The credit layer is open on</p>
          <div className="flex flex-col items-start gap-4 overflow-visible sm:flex-row sm:items-end sm:gap-5 md:gap-7">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/arclend-mark.png"
              alt="ArcLend"
              width={381}
              height={259}
              className="relative z-20 mb-1 block h-16 w-auto shrink-0 object-contain sm:mb-2 sm:h-24 md:h-32 lg:h-40"
              style={{ opacity: 1, visibility: "visible" }}
            />
            <h2 className="final-brand mt-0 min-w-0 max-w-full overflow-hidden leading-[0.86] tracking-[-0.06em] sm:mt-2 sm:leading-[0.8] sm:tracking-[-0.08em]">
              <BrandReveal className="break-words text-[clamp(2.5rem,13vw,15rem)] font-medium sm:text-[clamp(4rem,16vw,15rem)]" />
            </h2>
          </div>
          <Link href="/dashboard" className="mt-12 inline-flex items-center gap-3 border-b border-white pb-2 text-xl font-medium tracking-[-0.03em] transition hover:gap-5 hover:text-white/75 sm:text-3xl">Launch App <ArrowRight className="h-5 w-5 sm:h-7 sm:w-7" /></Link>

          <footer className="mt-28 flex flex-col gap-8 border-t border-white/[0.08] pt-6 text-xs text-white/35 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-6">
              <a href="https://testnet.arcscan.app" target="_blank" rel="noreferrer" className="transition hover:text-white">ArcScan</a>
              <a href="https://www.circle.com" target="_blank" rel="noreferrer" className="transition hover:text-white">Circle</a>
            </div>
            <div className="flex flex-wrap items-center gap-5"><span>Arc Network × Circle</span><span className="font-mono">© {new Date().getFullYear()} Arc<span className="text-[#86efac]">Lend</span></span></div>
          </footer>
        </div>
      </section>
    </div>
  );
}
