"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Camera,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Hexagon,
  HandCoins,
  ImagePlus,
  BadgeCheck,
  Landmark,
  Orbit,
  RefreshCw,
  Scale,
  ShieldCheck,
  Sparkles,
  Store,
  Trash2,
  UserRound,
  Vault,
  type LucideIcon,
} from "lucide-react";
import { PageTransition } from "@/components/layout/PageTransition";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import { usePrimaryDomain } from "@/hooks/usePrimaryDomain";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type PresetId = "classic" | "orbit" | "spark" | "vault";

type AvatarChoice =
  | { kind: "preset"; id: PresetId }
  | { kind: "upload"; dataUrl: string };

type AvatarPreset = {
  id: PresetId;
  label: string;
  Icon: LucideIcon;
  className: string;
};

type VolumeCategoryId =
  | "lending"
  | "borrowing"
  | "earn"
  | "liquidations"
  | "marketplace";

type ProfileVolume = {
  address: string;
  totalUsdMicro: string;
  actionCount: number;
  categories: Array<{
    id: VolumeCategoryId;
    label: string;
    usdMicro: string;
    actionCount: number;
    unpricedActions: number;
    attribution: "protocol-event";
  }>;
  assets: Array<{
    symbol: string;
    amountMicro: string;
    usdMicro: string;
    actionCount: number;
  }>;
  coverage: {
    complete: boolean;
    protocolEventsComplete: boolean;
    oracleHistoryComplete: boolean;
    valuationComplete: boolean;
    methodology: string;
    valuation: string;
    scope: string;
    exclusions: string[];
    warnings: string[];
  };
  updatedAt: string;
};

const volumeCategoryIcons: Record<VolumeCategoryId, LucideIcon> = {
  lending: Landmark,
  borrowing: HandCoins,
  earn: Vault,
  liquidations: Scale,
  marketplace: Store,
};

const defaultAvatar: AvatarChoice = { kind: "preset", id: "classic" };
const maximumUploadBytes = 8 * 1024 * 1024;

const avatarPresets: AvatarPreset[] = [
  {
    id: "classic",
    label: "Classic",
    Icon: UserRound,
    className: "bg-white text-black",
  },
  {
    id: "orbit",
    label: "Orbit",
    Icon: Orbit,
    className: "bg-[#090a0b] text-white",
  },
  {
    id: "spark",
    label: "Signal",
    Icon: Sparkles,
    className: "bg-white/[0.09] text-white",
  },
  {
    id: "vault",
    label: "Vault",
    Icon: Hexagon,
    className: "bg-[#17191b] text-white",
  },
];

function shorten(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function storageKey(address: string) {
  return `arclend:profile-avatar:${address.toLowerCase()}`;
}

function microToNumber(value: string) {
  try {
    return Number(BigInt(value)) / 1_000_000;
  } catch {
    return 0;
  }
}

function formatUsdMicro(value: string) {
  return microToNumber(value).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatTokenMicro(value: string) {
  return microToNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function isAvatarChoice(value: unknown): value is AvatarChoice {
  if (!value || typeof value !== "object" || !("kind" in value)) {
    return false;
  }
  if (value.kind === "upload") {
    return (
      "dataUrl" in value &&
      typeof value.dataUrl === "string" &&
      value.dataUrl.startsWith("data:image/")
    );
  }
  return (
    value.kind === "preset" &&
    "id" in value &&
    avatarPresets.some((preset) => preset.id === value.id)
  );
}

function readAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.readAsDataURL(blob);
  });
}

async function prepareAvatar(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose a PNG, JPG, or WebP image.");
  }
  if (file.size > maximumUploadBytes) {
    throw new Error("Choose an image smaller than 8 MB.");
  }

  const bitmap = await createImageBitmap(file);
  const longestSide = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, 640 / longestSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("The image could not be prepared.");
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) =>
        result
          ? resolve(result)
          : reject(new Error("The image could not be prepared.")),
      "image/webp",
      0.86,
    );
  });
  return readAsDataUrl(blob);
}

function AvatarVisual({
  avatar,
  className,
}: {
  avatar: AvatarChoice;
  className?: string;
}) {
  if (avatar.kind === "upload") {
    return (
      <Image
        src={avatar.dataUrl}
        alt="Your profile picture"
        width={320}
        height={320}
        unoptimized
        className={cn("h-full w-full object-cover", className)}
      />
    );
  }

  const preset =
    avatarPresets.find((item) => item.id === avatar.id) ?? avatarPresets[0];
  const Icon = preset.Icon;
  return (
    <span
      className={cn(
        "flex h-full w-full items-center justify-center",
        preset.className,
        className,
      )}
    >
      <Icon className="h-[42%] w-[42%]" strokeWidth={1.35} />
    </span>
  );
}

export default function ProfilePage() {
  const { address, isConnected } = useArcLendAccount();
  const { primaryDomain, isLoading: isDomainLoading } =
    usePrimaryDomain(address);
  const [avatar, setAvatar] = useState<AvatarChoice>(defaultAvatar);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isPreparingImage, setIsPreparingImage] = useState(false);
  const [volume, setVolume] = useState<ProfileVolume | null>(null);
  const [volumeError, setVolumeError] = useState<string | null>(null);
  const [isVolumeLoading, setIsVolumeLoading] = useState(false);
  const [volumeRefreshKey, setVolumeRefreshKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!address) {
      setAvatar(defaultAvatar);
      setPickerOpen(false);
      return;
    }
    try {
      const saved = window.localStorage.getItem(storageKey(address));
      const parsed: unknown = saved ? JSON.parse(saved) : null;
      setAvatar(isAvatarChoice(parsed) ? parsed : defaultAvatar);
    } catch {
      setAvatar(defaultAvatar);
    }
    setPickerOpen(false);
  }, [address]);

  useEffect(() => {
    if (!address) {
      setVolume(null);
      setVolumeError(null);
      setIsVolumeLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    setIsVolumeLoading(true);
    setVolumeError(null);

    void fetch(`/api/profile/${address}/volume`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as ProfileVolume & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Volume data is unavailable.");
        }
        if (active) setVolume(payload);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (controller.signal.aborted) {
          setVolumeError("The volume index timed out. Try again.");
          return;
        }
        setVolumeError(
          error instanceof Error ? error.message : "Volume data is unavailable.",
        );
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (active) setIsVolumeLoading(false);
      });

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [address, volumeRefreshKey]);

  const saveAvatar = (nextAvatar: AvatarChoice) => {
    if (!address) return;
    try {
      window.localStorage.setItem(
        storageKey(address),
        JSON.stringify(nextAvatar),
      );
      setAvatar(nextAvatar);
      showToast("success", "Profile picture updated");
    } catch {
      showToast("error", "The profile picture could not be saved");
    }
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setIsPreparingImage(true);
    try {
      const dataUrl = await prepareAvatar(file);
      saveAvatar({ kind: "upload", dataUrl });
      setPickerOpen(false);
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "The image could not be used",
      );
    } finally {
      setIsPreparingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (!isConnected || !address) {
    return (
      <PageTransition>
        <div className="mx-auto max-w-4xl px-4 pb-12 sm:px-6">
          <GlassCard className="p-8 text-center">
            <UserRound className="mx-auto h-10 w-10 text-white/45" />
            <h1 className="mt-4 text-2xl font-semibold">Connect your wallet</h1>
            <p className="mt-2 text-sm text-white/45">
              Connect to create and personalize your ArcLend profile.
            </p>
          </GlassCard>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
        <section className="border-b border-white/[0.07] pb-8 pt-2">
          <div className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => setPickerOpen((open) => !open)}
                className="group relative h-32 w-32 shrink-0 overflow-hidden rounded-full border border-white/20 bg-black shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_24px_70px_rgba(0,0,0,0.5)] transition duration-200 hover:-translate-y-1 hover:border-white/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:h-36 sm:w-36"
                aria-label="Choose profile picture"
                aria-expanded={pickerOpen}
              >
                <AvatarVisual avatar={avatar} />
                <span className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full border border-white/25 bg-black/80 text-white shadow-lg backdrop-blur-xl transition group-hover:scale-105">
                  <Camera className="h-4 w-4" />
                </span>
              </button>

              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium uppercase text-white/45 backdrop-blur-2xl">
                  <UserRound className="h-3.5 w-3.5 text-white/75" />
                  ArcLend profile
                </div>
                <h1 className="mt-4 font-display text-4xl font-medium leading-none text-white sm:text-6xl">
                  {primaryDomain ?? shorten(address)}
                </h1>
                <div className="mt-2 flex items-center gap-2 text-xs text-white/45">
                  {primaryDomain ? (
                    <>
                      <BadgeCheck className="h-4 w-4 text-[#86efac]" />
                      <span>Primary domain · on-chain username</span>
                    </>
                  ) : (
                    <span>
                      {isDomainLoading
                        ? "Loading primary domain…"
                        : "Set a primary domain to use it as your username."}
                    </span>
                  )}
                </div>
                <p className="mt-3 break-all font-mono text-sm text-white/45">
                  {address}
                </p>
                <button
                  type="button"
                  onClick={() => setPickerOpen((open) => !open)}
                  className="mt-3 text-xs font-medium text-white/55 underline decoration-white/20 underline-offset-4 transition hover:text-white"
                >
                  {pickerOpen ? "Close picture chooser" : "Change profile picture"}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(address);
                  showToast("success", "Wallet address copied");
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.04] px-3.5 py-2.5 text-xs text-white/55 transition hover:border-white/20 hover:text-white"
              >
                <Copy className="h-4 w-4" />
                Copy address
              </button>
              <a
                href={`https://testnet.arcscan.app/address/${address}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.04] px-3.5 py-2.5 text-xs text-white/55 transition hover:border-white/20 hover:text-white"
              >
                ArcScan
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </div>

          {pickerOpen ? (
            <GlassCard className="mt-6 max-w-2xl p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">
                    Choose a profile picture
                  </p>
                  <p className="mt-1 text-xs leading-5 text-white/40">
                    Upload your own image or select an ArcLend line-mark preset.
                  </p>
                </div>
                <GlassButton
                  type="button"
                  variant="ghost"
                  disabled={isPreparingImage}
                  onClick={() => fileInputRef.current?.click()}
                  className="shrink-0"
                >
                  <ImagePlus className="h-4 w-4" />
                  {isPreparingImage ? "Preparing…" : "Upload image"}
                </GlassButton>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(event) =>
                    void handleUpload(event.currentTarget.files?.[0])
                  }
                />
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {avatarPresets.map((preset) => {
                  const selected =
                    avatar.kind === "preset" && avatar.id === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => saveAvatar({ kind: "preset", id: preset.id })}
                      aria-pressed={selected}
                      className={cn(
                        "relative rounded-2xl border bg-white/[0.025] p-2 text-left transition hover:-translate-y-0.5 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
                        selected ? "border-white/45" : "border-white/[0.09]",
                      )}
                    >
                      <span className="block aspect-square overflow-hidden rounded-xl border border-white/10">
                        <AvatarVisual avatar={{ kind: "preset", id: preset.id }} />
                      </span>
                      <span className="mt-2 block text-center text-[11px] text-white/50">
                        {preset.label}
                      </span>
                      {selected ? (
                        <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-white text-black">
                          <Check className="h-3 w-3" strokeWidth={2.5} />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 flex flex-col gap-3 border-t border-white/[0.07] pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[11px] text-white/30">
                  Your picture is saved privately on this device for this wallet.
                </p>
                <button
                  type="button"
                  onClick={() => saveAvatar(defaultAvatar)}
                  className="inline-flex items-center gap-2 text-xs text-white/45 transition hover:text-white"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Restore default
                </button>
              </div>
            </GlassCard>
          ) : null}
        </section>

        <section className="grid gap-4 lg:grid-cols-12">
          <GlassCard className="relative overflow-hidden p-0 lg:col-span-8">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/30" />
            <div className="flex flex-col gap-4 border-b border-white/[0.07] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.04] text-white/70">
                  <Activity className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    ArcLend-only volume
                  </h2>
                  <p className="mt-0.5 text-[11px] text-white/35">
                    Verified ArcLend contract events only
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {volume ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em]",
                      volume.coverage.complete
                        ? "border-[#86efac]/20 bg-[#22c55e]/[0.07] text-[#86efac]"
                        : "border-white/[0.09] bg-white/[0.03] text-white/40",
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        volume.coverage.complete
                          ? "bg-[#22c55e] shadow-[0_0_10px_rgba(34,197,94,0.7)]"
                          : "bg-white/35",
                      )}
                    />
                    {volume.coverage.complete ? "Complete" : "Partial"}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setVolumeRefreshKey((key) => key + 1)}
                  disabled={isVolumeLoading}
                  aria-label="Refresh ArcLend volume"
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.09] bg-white/[0.03] text-white/45 transition hover:border-white/20 hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <RefreshCw
                    className={cn("h-3.5 w-3.5", isVolumeLoading && "animate-spin")}
                  />
                </button>
              </div>
            </div>

            <div className="px-5 py-7 sm:px-7 sm:py-9">
              {isVolumeLoading && !volume ? (
                <div aria-label="Loading ArcLend volume" className="animate-pulse">
                  <div className="h-3 w-28 rounded bg-white/[0.07]" />
                  <div className="mt-4 h-14 w-64 max-w-full rounded bg-white/[0.08]" />
                  <div className="mt-8 grid gap-2 sm:grid-cols-2">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <div
                        key={index}
                        className="h-16 rounded-xl border border-white/[0.05] bg-white/[0.025]"
                      />
                    ))}
                  </div>
                </div>
              ) : volumeError && !volume ? (
                <div className="flex min-h-52 flex-col items-start justify-center">
                  <p className="text-sm font-medium text-white">
                    Volume index unavailable
                  </p>
                  <p className="mt-2 max-w-md text-xs leading-5 text-white/40">
                    {volumeError}
                  </p>
                  <GlassButton
                    type="button"
                    variant="ghost"
                    onClick={() => setVolumeRefreshKey((key) => key + 1)}
                    className="mt-5"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Try again
                  </GlassButton>
                </div>
              ) : volume ? (
                <>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
                        Lifetime gross notional
                      </p>
                      <AnimatedNumber
                        value={microToNumber(volume.totalUsdMicro)}
                        prefix="$"
                        decimals={2}
                        className="mt-2 block font-mono text-5xl font-medium tracking-[-0.06em] text-white sm:text-7xl"
                      />
                    </div>
                    <div className="pb-1 sm:text-right">
                      <p className="font-mono text-lg text-white">
                        {volume.actionCount.toLocaleString()}
                      </p>
                      <p className="text-[10px] uppercase tracking-[0.14em] text-white/30">
                        canonical actions
                      </p>
                    </div>
                  </div>

                  <div className="mt-8 grid gap-2 sm:grid-cols-2">
                    {volume.categories.map((category) => {
                      const Icon = volumeCategoryIcons[category.id];
                      return (
                        <div
                          key={category.id}
                          className="group flex items-center justify-between gap-4 rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-3.5 transition duration-200 hover:-translate-y-0.5 hover:border-white/[0.14] hover:bg-white/[0.045]"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <Icon className="h-4 w-4 shrink-0 text-white/40 transition group-hover:text-white/70" />
                            <div className="min-w-0">
                              <p className="truncate text-xs text-white/65">
                                {category.label}
                              </p>
                              <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-white/25">
                                {category.actionCount} {category.actionCount === 1 ? "action" : "actions"}
                              </p>
                            </div>
                          </div>
                          <p className="shrink-0 font-mono text-sm text-white">
                            {formatUsdMicro(category.usdMicro)}
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  <p className="mt-5 font-mono text-[9px] uppercase tracking-[0.12em] text-white/25">
                    Updated {new Date(volume.updatedAt).toLocaleString()}
                  </p>
                </>
              ) : null}
            </div>
          </GlassCard>

          <GlassCard className="flex flex-col p-5 sm:p-6 lg:col-span-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">
                Counted notional by asset
              </p>
              <p className="mt-2 text-xs leading-5 text-white/35">
                Raw asset amounts remain visible beside the USD estimate.
              </p>
            </div>

            <div className="mt-5 space-y-2">
              {volume?.assets.length ? (
                volume.assets.map((asset) => (
                  <div
                    key={asset.symbol}
                    className="flex items-center justify-between gap-4 border-b border-white/[0.06] py-3 last:border-0"
                  >
                    <div>
                      <p className="font-mono text-sm text-white">
                        {formatTokenMicro(asset.amountMicro)} {asset.symbol}
                      </p>
                      <p className="mt-1 text-[10px] text-white/25">
                        {asset.actionCount} counted {asset.actionCount === 1 ? "action" : "actions"}
                      </p>
                    </div>
                    <p className="font-mono text-xs text-white/45">
                      {formatUsdMicro(asset.usdMicro)}
                    </p>
                  </div>
                ))
              ) : isVolumeLoading ? (
                <div className="space-y-3 animate-pulse">
                  <div className="h-12 rounded bg-white/[0.04]" />
                  <div className="h-12 rounded bg-white/[0.04]" />
                </div>
              ) : (
                <p className="py-6 text-xs text-white/30">
                  No verified ArcLend notional yet.
                </p>
              )}
            </div>

            {volume ? (
              <details className="group mt-auto border-t border-white/[0.07] pt-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-medium text-white/60 transition hover:text-white [&::-webkit-details-marker]:hidden">
                  Accounting methodology
                  <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
                </summary>
                <div className="mt-4 space-y-4 text-[11px] leading-5 text-white/35">
                  <p>{volume.coverage.methodology}</p>
                  <p>{volume.coverage.valuation}</p>
                  <p>{volume.coverage.scope}</p>

                  {volume.coverage.warnings.length ? (
                    <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3 text-white/50">
                      {volume.coverage.warnings.map((warning) => (
                        <p key={warning}>{warning}</p>
                      ))}
                    </div>
                  ) : null}

                  <div>
                    <p className="font-mono text-[9px] uppercase tracking-[0.13em] text-white/50">
                      Excluded from total
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {volume.coverage.exclusions.map((exclusion) => (
                        <li key={exclusion} className="flex gap-2">
                          <span className="mt-2 h-px w-2 shrink-0 bg-white/25" />
                          <span>{exclusion}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </details>
            ) : null}
          </GlassCard>
        </section>

        <div className="grid gap-4 md:grid-cols-3">
          <GlassCard className="p-5">
            <p className="text-[10px] font-semibold uppercase text-white/35">
              Username
            </p>
            <p className="mt-3 truncate font-mono text-lg text-white">
              {primaryDomain ?? shorten(address)}
            </p>
          </GlassCard>
          <GlassCard className="p-5">
            <p className="text-[10px] font-semibold uppercase text-white/35">
              Network
            </p>
            <p className="mt-3 text-lg text-white">Arc Testnet</p>
          </GlassCard>
          <GlassCard className="p-5">
            <div className="flex items-center gap-2 text-white/60">
              <ShieldCheck className="h-4 w-4" />
              <p className="text-[10px] font-semibold uppercase">
                Account control
              </p>
            </div>
            <p className="mt-3 text-lg text-white">Non-custodial</p>
          </GlassCard>
        </div>
      </div>
    </PageTransition>
  );
}
