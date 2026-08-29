"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Gift,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Users,
  X,
  Zap,
} from "lucide-react";
import type { Abi } from "viem";
import { getAddress, isAddress, parseUnits } from "viem";
import { useAccount } from "wagmi";
import { useArcLendContractWrite, resultHash } from "@/hooks/useArcLendContractWrite";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageTransition } from "@/components/layout/PageTransition";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { AssetMark, SectionLabel } from "@/components/ui/MarketVisuals";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { ARCSCAN_TX_BASE, DROP_EXPIRY_OPTIONS, DROP_MODE_CLAIM_ALL, DROP_MODE_EQUAL_SPLIT, allDropShareUrls, clientDropUrl, effectiveDropStatus, formatDropAmount, parseDropAmount, type ApiDrop, type DropAsset, type DropMode } from "@/lib/arcDrop";
import { ARC_TESTNET_CONTRACTS } from "@/constants/contracts";
import deployments from "@/constants/deployments.json";
import erc20Json from "@/constants/abis/ERC20.json";
import arcDropJson from "@/constants/abis/ArcDrop.json";

// ─── ABIs ────────────────────────────────────────────────────────────────────

const ERC20_ABI: Abi = erc20Json as Abi;
const ARCDROP_ABI: Abi = arcDropJson as Abi;

// ─── Constants ────────────────────────────────────────────────────────────────

const ARCDROP_ADDRESS = (deployments as Record<string, unknown>).ArcDrop as
  | `0x${string}`
  | undefined;

const ASSET_ADDRESSES: Record<DropAsset, `0x${string}`> = {
  USDC: ARC_TESTNET_CONTRACTS.USDC as `0x${string}`,
  EURC: ARC_TESTNET_CONTRACTS.EURC as `0x${string}`,
};

const STORAGE_KEY = "lendora:arcdrop:my-drops";

// ─── Local storage shape ─────────────────────────────────────────────────────

type SavedDrop = {
  dropId: number;
  slug: string;
  url: string;
  asset: DropAsset;
  totalAmount: string; // bigint string
  mode: DropMode;
  maxClaimants: number;
  expiresAt: number; // unix seconds (0 = never)
  createdAt: number; // unix seconds
  // Fetched live from chain
  remainingAmount?: string;
  claimantsCount?: number;
  active?: boolean;
};

function readSaved(): SavedDrop[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedDrop[];
    return Array.isArray(parsed) ? parsed.slice(0, 50) : [];
  } catch {
    return [];
  }
}

function writeSaved(rows: SavedDrop[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(0, 50)));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseBigAmount(raw: string): string {
  return parseUnits(raw, 6).toString();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ModeCard({
  selected,
  mode,
  onClick,
}: {
  selected: boolean;
  mode: DropMode;
  onClick: () => void;
}) {
  const isEqual = mode === DROP_MODE_EQUAL_SPLIT;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 flex-col items-start gap-2 rounded-2xl border p-4 text-left transition",
        selected
          ? "border-white/60 bg-white/[0.07]"
          : "border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/[0.035]",
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full border",
          selected ? "border-white/60 text-white" : "border-white/15 text-white/40",
        )}
      >
        {isEqual ? (
          <Users className="h-4 w-4" />
        ) : (
          <Zap className="h-4 w-4" />
        )}
      </span>
      <p
        className={cn(
          "text-sm font-semibold leading-tight",
          selected ? "text-white" : "text-white/55",
        )}
      >
        {isEqual ? "Equal Split" : "Claim All"}
      </p>
      <p
        className={cn(
          "text-xs leading-relaxed",
          selected ? "text-white/65" : "text-white/35",
        )}
      >
        {isEqual
          ? "Everyone who claims gets an equal share"
          : "The first person to claim gets everything"}
      </p>
    </button>
  );
}

function StatusBadge({ drop }: { drop: SavedDrop }) {
  const status = drop.active === false
    ? (Number(drop.claimantsCount ?? 0) >= drop.maxClaimants || drop.remainingAmount === "0"
      ? "fully_claimed"
      : "cancelled")
    : drop.expiresAt > 0 && Date.now() / 1000 >= drop.expiresAt
      ? "expired"
      : "active";

  return (
    <span
      className={cn(
        "text-[10px] uppercase tracking-wide font-medium",
        status === "active" && "text-emerald-200/80",
        status === "fully_claimed" && "text-white/45",
        status === "cancelled" && "text-red-200/70",
        status === "expired" && "text-amber-200/70",
      )}
    >
      {status === "fully_claimed" ? "Fully Claimed" : status === "active" ? "Active" : status === "cancelled" ? "Cancelled" : "Expired"}
    </span>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ArcDropPage() {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useArcLendContractWrite();

  // ── Form state ──────────────────────────────────────────────────────────
  const [asset, setAsset] = useState<DropAsset>("USDC");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<DropMode>(DROP_MODE_EQUAL_SPLIT);
  const [claimants, setClaimants] = useState("5");
  const [expirySeconds, setExpirySeconds] = useState(DROP_EXPIRY_OPTIONS[1].seconds);

  // ── Execution state ─────────────────────────────────────────────────────
  type ExecStep = "idle" | "approving" | "creating" | "linking" | "done" | "error";
  const [step, setStep] = useState<ExecStep>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [txHash, setTxHash] = useState("");
  const [created, setCreated] = useState<{ slug: string; url: string; dropId: number } | null>(null);
  const [copied, setCopied] = useState(false);

  // ── My Drops state ──────────────────────────────────────────────────────
  const [myDrops, setMyDrops] = useState<SavedDrop[]>([]);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [reclaimingId, setReclaimingId] = useState<number | null>(null);

  useEffect(() => {
    setMyDrops(readSaved());
  }, []);

  // ── Derived: per-claim amount preview ──────────────────────────────────
  const parsedAmount = parseDropAmount(amount);
  const parsedClaimants = parseInt(claimants, 10);
  const isEqualSplit = mode === DROP_MODE_EQUAL_SPLIT;

  const perClaimPreview = useMemo(() => {
    if (!isEqualSplit || !parsedAmount || !parsedClaimants || parsedClaimants < 1) return null;
    if (parsedAmount % BigInt(parsedClaimants) !== 0n) return null;
    return parsedAmount / BigInt(parsedClaimants);
  }, [isEqualSplit, parsedAmount, parsedClaimants]);

  const unevenSplit = useMemo(() => {
    if (!isEqualSplit || !parsedAmount || !parsedClaimants || parsedClaimants < 1) return false;
    return parsedAmount % BigInt(parsedClaimants) !== 0n;
  }, [isEqualSplit, parsedAmount, parsedClaimants]);

  const canCreate =
    isConnected &&
    Boolean(parsedAmount) &&
    !unevenSplit &&
    (!isEqualSplit || (parsedClaimants >= 1 && parsedClaimants <= 10_000)) &&
    Boolean(ARCDROP_ADDRESS) &&
    step === "idle";

  // ── Create drop flow ─────────────────────────────────────────────────────
  async function handleCreate() {
    if (!address || !parsedAmount || !ARCDROP_ADDRESS) return;
    setStep("approving");
    setErrorMsg("");
    setCreated(null);

    try {
      const assetAddress = ASSET_ADDRESSES[asset];
      const effectiveClaimants = isEqualSplit ? Math.max(1, parsedClaimants) : 1;

      // Step 1: ERC-20 approve for exactly totalAmount
      await writeContractAsync({
        chainId: 5042002,
        address: assetAddress,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [ARCDROP_ADDRESS, parsedAmount],
      });
      await new Promise((r) => setTimeout(r, 1500));

      // Step 2: createDrop()
      setStep("creating");
      const result = await writeContractAsync({
        chainId: 5042002,
        address: ARCDROP_ADDRESS,
        abi: ARCDROP_ABI,
        functionName: "createDrop",
        args: [
          assetAddress,
          parsedAmount,
          mode,
          BigInt(effectiveClaimants),
          BigInt(expirySeconds),
        ],
      });

      const hash = resultHash(result);
      if (hash) setTxHash(hash);

      // Step 3: Read nextDropId - 1 from contract to get the new dropId.
      // We can infer it from the tx receipt events, but for simplicity we
      // use the fact that nextDropId increments by 1 after a successful
      // createDrop. We optimistically read it post-confirmation.
      // In production, parse DropCreated event from receipt logs.
      // For now, store a sentinel and resolve after link creation.
      setStep("linking");

      // We need the dropId from the receipt. Read logs off the hash if available.
      let dropId: number | null = null;

      if (hash) {
        // Poll for receipt then parse DropCreated log
        try {
          const { createPublicClient, http, parseEventLogs } = await import("viem");
          const { arcTestnet } = await import("viem/chains");
          const client = createPublicClient({
            chain: arcTestnet,
            transport: http("https://rpc.testnet.arc.network"),
          });

          for (let i = 0; i < 30; i++) {
            try {
              const receipt = await client.getTransactionReceipt({
                hash: hash as `0x${string}`,
              });
              if (receipt) {
                const logs = parseEventLogs({
                  abi: ARCDROP_ABI,
                  eventName: "DropCreated",
                  logs: receipt.logs,
                });
                if (logs.length > 0) {
                  const ev = logs[0] as { args: { dropId: bigint } };
                  dropId = Number(ev.args.dropId);
                }
                break;
              }
            } catch {
              // Not confirmed yet
            }
            await new Promise((r) => setTimeout(r, 2000));
          }
        } catch {
          // Fallback: dropId stays null
        }
      }

      if (!dropId) {
        // Fallback: prompt user to note the tx hash
        showToast("error", "Could not read drop ID from receipt. Check ArcScan for the DropCreated event.");
        setStep("error");
        setErrorMsg("Drop was created on-chain but the drop ID could not be read automatically. Please check ArcScan.");
        return;
      }

      // Step 4: Register slug in Redis
      const linkResp = await fetch("/api/drop/create-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dropId, creatorWallet: address }),
      });
      const linkBody = (await linkResp.json()) as {
        slug?: string;
        url?: string;
        error?: string;
      };
      if (!linkResp.ok || !linkBody.slug) {
        throw new Error(linkBody.error ?? "Could not generate shareable link.");
      }

      const slug = linkBody.slug;
      const url = clientDropUrl(slug);
      const now = Math.floor(Date.now() / 1000);
      const savedDrop: SavedDrop = {
        dropId,
        slug,
        url,
        asset,
        totalAmount: parsedAmount.toString(),
        mode,
        maxClaimants: effectiveClaimants,
        expiresAt: expirySeconds > 0 ? now + expirySeconds : 0,
        createdAt: now,
        active: true,
        claimantsCount: 0,
        remainingAmount: parsedAmount.toString(),
      };

      setMyDrops((prev) => {
        const next = [savedDrop, ...prev.filter((d) => d.dropId !== dropId)];
        writeSaved(next);
        return next;
      });

      setCreated({ slug, url, dropId });
      setStep("done");
      showToast("success", "Drop created — copy the link and share it.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transaction failed";
      const clean = msg.match(/ArcDrop:\s*([^\n"\\]+)/i)?.[1]?.trim() ?? msg.split("\n")[0];
      setErrorMsg(clean);
      setStep("error");
      showToast("error", clean);
    }
  }

  // ── Copy link ─────────────────────────────────────────────────────────────
  async function copyLink(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    showToast("success", "Link copied.");
    setTimeout(() => setCopied(false), 1600);
  }

  // ── Cancel drop ───────────────────────────────────────────────────────────
  async function handleCancel(drop: SavedDrop) {
    if (!ARCDROP_ADDRESS) return;
    setCancellingId(drop.dropId);
    try {
      await writeContractAsync({
        chainId: 5042002,
        address: ARCDROP_ADDRESS,
        abi: ARCDROP_ABI,
        functionName: "cancelDrop",
        args: [BigInt(drop.dropId)],
      });
      setMyDrops((prev) => {
        const next = prev.map((d) =>
          d.dropId === drop.dropId ? { ...d, active: false } : d,
        );
        writeSaved(next);
        return next;
      });
      showToast("success", "Drop cancelled — remaining funds returned to your wallet.");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Could not cancel drop.");
    } finally {
      setCancellingId(null);
    }
  }

  // ── Reclaim expired ───────────────────────────────────────────────────────
  async function handleReclaim(drop: SavedDrop) {
    if (!ARCDROP_ADDRESS) return;
    setReclaimingId(drop.dropId);
    try {
      await writeContractAsync({
        chainId: 5042002,
        address: ARCDROP_ADDRESS,
        abi: ARCDROP_ABI,
        functionName: "reclaimExpired",
        args: [BigInt(drop.dropId)],
      });
      setMyDrops((prev) => {
        const next = prev.map((d) =>
          d.dropId === drop.dropId
            ? { ...d, active: false, remainingAmount: "0" }
            : d,
        );
        writeSaved(next);
        return next;
      });
      showToast("success", "Expired funds reclaimed.");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Could not reclaim.");
    } finally {
      setReclaimingId(null);
    }
  }

  // ── Reset form ────────────────────────────────────────────────────────────
  function resetForm() {
    setStep("idle");
    setErrorMsg("");
    setTxHash("");
    setCreated(null);
    setAmount("");
    setClaimants("5");
  }

  const myAddressDrops = useMemo(
    () => myDrops.filter((d) => d.createdAt > 0),
    [myDrops],
  );

  const isBusy = step === "approving" || step === "creating" || step === "linking";

  return (
    <PageTransition>
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 pb-16 sm:px-6 lg:px-8">
        <PageHeader
          icon={<Gift />}
          title="Lendrop"
          description="Create a claim link — deposit USDC or EURC and anyone with the link can claim their share directly to their own wallet."
        />

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          {/* ── CREATE FORM ──────────────────────────────────────────────── */}
          <GlassCard depth="foreground" className="p-5 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <SectionLabel>New drop</SectionLabel>
                <h2 className="mt-2 font-display text-2xl text-white sm:text-3xl">
                  Create a claim link
                </h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-white/50">
                  Funds sit in escrow until claimed. Each recipient signs their
                  own transaction and pulls directly to their wallet.
                </p>
              </div>
              <Gift className="h-6 w-6 text-emerald-200/80" />
            </div>

            <div className="mt-7 grid gap-5">
              {/* Asset selector */}
              <div>
                <span className="mb-2 block text-[11px] uppercase tracking-wide text-white/40">
                  Asset
                </span>
                <div className="flex rounded-xl border border-white/10 bg-black/25 p-1">
                  {(["USDC", "EURC"] as const).map((token) => (
                    <button
                      key={token}
                      type="button"
                      onClick={() => setAsset(token)}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm transition",
                        asset === token
                          ? "bg-white text-black"
                          : "text-white/55 hover:text-white",
                      )}
                    >
                      <AssetMark symbol={token} size="sm" />
                      {token}
                    </button>
                  ))}
                </div>
              </div>

              {/* Total amount */}
              <label className="grid gap-2">
                <span className="text-[11px] uppercase tracking-wide text-white/40">
                  Total amount
                </span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-2xl text-white outline-none placeholder:text-white/25 focus:border-emerald-200/40"
                />
              </label>

              {/* Mode selector */}
              <div>
                <span className="mb-3 block text-[11px] uppercase tracking-wide text-white/40">
                  Distribution mode
                </span>
                <div className="flex gap-3">
                  <ModeCard
                    mode={DROP_MODE_EQUAL_SPLIT}
                    selected={isEqualSplit}
                    onClick={() => setMode(DROP_MODE_EQUAL_SPLIT)}
                  />
                  <ModeCard
                    mode={DROP_MODE_CLAIM_ALL}
                    selected={!isEqualSplit}
                    onClick={() => setMode(DROP_MODE_CLAIM_ALL)}
                  />
                </div>
              </div>

              {/* Claimants (Equal Split only) */}
              {isEqualSplit ? (
                <div className="grid gap-2">
                  <label className="grid gap-2">
                    <span className="text-[11px] uppercase tracking-wide text-white/40">
                      Number of claimants
                    </span>
                    <input
                      value={claimants}
                      onChange={(e) => setClaimants(e.target.value)}
                      inputMode="numeric"
                      placeholder="5"
                      className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-xl text-white outline-none placeholder:text-white/25 focus:border-emerald-200/40"
                    />
                  </label>
                  {perClaimPreview !== null && (
                    <p className="text-sm text-emerald-200/80">
                      Each claimant receives:{" "}
                      <span className="font-mono font-semibold">
                        {formatDropAmount(perClaimPreview.toString())} {asset}
                      </span>
                    </p>
                  )}
                  {unevenSplit && parsedAmount && (
                    <p className="text-sm text-red-300/80">
                      ⚠ {formatDropAmount(parsedAmount.toString())} {asset} does not divide
                      evenly among {claimants} claimants. Adjust the amount or
                      claimant count so the split is exact.
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-white/[0.07] bg-amber-200/[0.05] px-4 py-3">
                  <p className="text-sm text-amber-100/80">
                    <span className="font-semibold">First come, first served.</span>{" "}
                    Only one person can claim this drop — they receive the entire
                    deposit.
                  </p>
                </div>
              )}

              {/* Expiry */}
              <div>
                <span className="mb-3 block text-[11px] uppercase tracking-wide text-white/40">
                  Expiry
                </span>
                <div className="flex flex-wrap gap-2">
                  {DROP_EXPIRY_OPTIONS.map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setExpirySeconds(opt.seconds)}
                      className={cn(
                        "rounded-full border px-3.5 py-1.5 text-xs transition",
                        expirySeconds === opt.seconds
                          ? "border-white/80 bg-white text-black font-semibold"
                          : "border-white/10 text-white/50 hover:text-white",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Contract not deployed warning */}
              {!ARCDROP_ADDRESS && (
                <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3">
                  <p className="text-sm text-amber-200/80">
                    Lendrop contract is not yet deployed. Run{" "}
                    <code className="font-mono text-xs">
                      scripts/22_deploy_arcdrop.ts
                    </code>{" "}
                    first.
                  </p>
                </div>
              )}

              {/* CTA */}
              {step === "idle" || step === "error" ? (
                <div className="space-y-2">
                  <GlassButton
                    variant="primary"
                    disabled={!canCreate}
                    onClick={() => void handleCreate()}
                    className="mt-1 w-full"
                  >
                    <Sparkles className="h-4 w-4" />
                    {isConnected ? "Approve & Create Drop" : "Connect wallet first"}
                  </GlassButton>
                  {step === "error" && errorMsg && (
                    <div className="flex items-start gap-2 rounded-xl border border-red-300/20 bg-red-300/[0.06] px-3 py-3">
                      <X className="mt-0.5 h-4 w-4 shrink-0 text-red-300/80" />
                      <p className="text-sm text-red-200/80">{errorMsg}</p>
                    </div>
                  )}
                </div>
              ) : isBusy ? (
                <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-4">
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-white/60" />
                  <p className="text-sm text-white/70">
                    {step === "approving"
                      ? "Approving token spend…"
                      : step === "creating"
                        ? "Creating drop on-chain…"
                        : "Generating shareable link…"}
                  </p>
                </div>
              ) : null}

              {/* Success panel */}
              {step === "done" && created ? (
                <div className="rounded-2xl border border-emerald-200/20 bg-emerald-200/[0.06] p-5">
                  <p className="text-[11px] uppercase tracking-wide text-emerald-100/70">
                    Drop created — share this link
                  </p>
                  <p className="mt-2 break-all font-mono text-sm text-white">
                    {clientDropUrl(created.slug)}
                  </p>
                  <p className="mt-3 text-[11px] uppercase tracking-wide text-white/40">
                    Same drop on both domains
                  </p>
                  <ul className="mt-1 space-y-1">
                    {allDropShareUrls(created.slug)
                      .filter((shareUrl) => shareUrl !== clientDropUrl(created.slug))
                      .map((shareUrl) => (
                        <li key={shareUrl}>
                          <button
                            type="button"
                            onClick={() => void copyLink(shareUrl)}
                            className="break-all text-left font-mono text-xs text-white/50 hover:text-white"
                          >
                            {shareUrl}
                          </button>
                        </li>
                      ))}
                  </ul>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <GlassButton
                      variant="primary"
                      onClick={() => void copyLink(clientDropUrl(created.slug))}
                    >
                      {copied ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                      Copy link
                    </GlassButton>
                    {txHash && (
                      <GlassButton
                        variant="ghost"
                        onClick={() =>
                          window.open(`${ARCSCAN_TX_BASE}${txHash}`, "_blank")
                        }
                      >
                        <ExternalLink className="h-4 w-4" />
                        View on ArcScan
                      </GlassButton>
                    )}
                    <GlassButton variant="ghost" onClick={resetForm}>
                      <RotateCcw className="h-4 w-4" />
                      Create another
                    </GlassButton>
                  </div>
                </div>
              ) : null}
            </div>
          </GlassCard>

          {/* ── HOW IT WORKS ─────────────────────────────────────────────── */}
          <div className="space-y-5">
            <GlassCard className="p-5">
              <SectionLabel>How it works</SectionLabel>
              <ol className="mt-4 space-y-4 text-sm leading-6 text-white/55">
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/15 text-[10px] text-white/50">
                    1
                  </span>
                  Approve and deposit USDC or EURC into escrow on Arc.
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/15 text-[10px] text-white/50">
                    2
                  </span>
                  Share the link — anyone with it can claim their share.
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/15 text-[10px] text-white/50">
                    3
                  </span>
                  Recipients sign their own transaction. Funds go directly to
                  their connected wallet. No intermediary.
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/15 text-[10px] text-white/50">
                    4
                  </span>
                  Cancel any time or set an expiry to auto-close. Unclaimed
                  funds always return to you.
                </li>
              </ol>
            </GlassCard>

            {/* ── MY DROPS ─────────────────────────────────────────────── */}
            <GlassCard className="p-5">
              <SectionLabel>My drops</SectionLabel>
              {myAddressDrops.length === 0 ? (
                <p className="mt-4 text-sm text-white/40">
                  Nothing yet. Create a drop and it will appear here.
                </p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {myAddressDrops.map((drop) => {
                    const isExpired =
                      drop.expiresAt > 0 &&
                      Date.now() / 1000 >= drop.expiresAt;
                    const showCancel =
                      drop.active !== false && !isExpired;
                    const showReclaim =
                      drop.active !== false &&
                      isExpired &&
                      BigInt(drop.remainingAmount ?? drop.totalAmount) > 0n;

                    return (
                      <li
                        key={drop.dropId}
                        className="rounded-xl border border-white/[0.08] bg-black/20 px-3.5 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-mono text-sm text-white">
                            {formatDropAmount(drop.totalAmount)} {drop.asset}
                          </p>
                          <StatusBadge drop={drop} />
                        </div>
                        <p className="mt-1 text-xs text-white/40">
                          {drop.mode === DROP_MODE_EQUAL_SPLIT
                            ? `Equal Split · ${drop.claimantsCount ?? 0}/${drop.maxClaimants} claimed`
                            : "Claim All"}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-3">
                          {drop.active !== false && (
                            <button
                              type="button"
                              onClick={() => void copyLink(clientDropUrl(drop.slug))}
                              className="text-xs text-emerald-100/80 hover:text-white"
                            >
                              Copy link
                            </button>
                          )}
                          <a
                            href={clientDropUrl(drop.slug)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-white/40 hover:text-white"
                          >
                            View
                          </a>
                          {showCancel && (
                            <button
                              type="button"
                              onClick={() => void handleCancel(drop)}
                              disabled={cancellingId === drop.dropId}
                              className="text-xs text-red-200/70 hover:text-red-100 disabled:opacity-50"
                            >
                              {cancellingId === drop.dropId ? (
                                <Loader2 className="inline h-3 w-3 animate-spin" />
                              ) : (
                                "Cancel"
                              )}
                            </button>
                          )}
                          {showReclaim && (
                            <button
                              type="button"
                              onClick={() => void handleReclaim(drop)}
                              disabled={reclaimingId === drop.dropId}
                              className="text-xs text-amber-200/80 hover:text-amber-100 disabled:opacity-50"
                            >
                              {reclaimingId === drop.dropId ? (
                                <Loader2 className="inline h-3 w-3 animate-spin" />
                              ) : (
                                "Reclaim expired"
                              )}
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </GlassCard>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
