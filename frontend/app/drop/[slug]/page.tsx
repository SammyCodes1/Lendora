"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Gift,
  Loader2,
  XCircle,
} from "lucide-react";
import type { Abi } from "viem";
import { useAccount } from "wagmi";
import Link from "next/link";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import { useArcLendContractWrite, resultHash } from "@/hooks/useArcLendContractWrite";
import {
  ARCSCAN_TX_BASE,
  DROP_MODE_CLAIM_ALL,
  DROP_MODE_EQUAL_SPLIT,
  effectiveDropStatus,
  formatDropAmount,
  type ApiDrop,
} from "@/lib/arcDrop";
import deployments from "@/constants/deployments.json";
import arcDropJson from "@/constants/abis/ArcDrop.json";

// ─── ArcDrop ABI ─────────────────────────────────────────────────────────────

const ARCDROP_ABI: Abi = arcDropJson as Abi;

const ARCDROP_ADDRESS = (deployments as Record<string, unknown>).ArcDrop as
  | `0x${string}`
  | undefined;

const ASSET_SYMBOLS: Record<string, string> = {
  "0x3600000000000000000000000000000000000000": "USDC",
  "0x89b50855aa3be2f677cd6303cec089b5f319d72a": "EURC",
};

function assetSymbol(address: string): string {
  return ASSET_SYMBOLS[address.toLowerCase()] ?? "Token";
}

// ─── Load state types ─────────────────────────────────────────────────────────

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; data: ApiDrop };

type ClaimState =
  | "idle"
  | "claiming"
  | "success"
  | "error";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusLabel(mode: number, expiresAt: string, active: boolean, remaining: string): string {
  const status = effectiveDropStatus({
    active,
    mode: mode as 0 | 1,
    expiresAt,
    remainingAmount: remaining,
    claimantsCount: "0",
    maxClaimants: "1",
    creator: "",
    asset: "",
    totalAmount: "0",
    perClaimAmount: "0",
    createdAt: "0",
  });
  switch (status) {
    case "fully_claimed":
      return "This drop has been fully claimed.";
    case "cancelled":
      return "This drop was cancelled by its creator.";
    case "expired":
      return "This drop has expired.";
    default:
      return "";
  }
}

// ─── Main claim page ──────────────────────────────────────────────────────────

export default function DropClaimPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useArcLendContractWrite();

  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [claimState, setClaimState] = useState<ClaimState>("idle");
  const [claimTxHash, setClaimTxHash] = useState("");
  const [claimError, setClaimError] = useState("");
  const [alreadyClaimed, setAlreadyClaimed] = useState(false);
  const [checkingClaimed, setCheckingClaimed] = useState(false);

  // ── Fetch drop from slug ─────────────────────────────────────────────────
  const fetchDrop = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const resp = await fetch(`/api/drop/${encodeURIComponent(slug)}`);
      const body = (await resp.json()) as ApiDrop & { error?: string };
      if (!resp.ok || !body.drop) {
        setLoad({ status: "error", message: body.error ?? "Drop not found." });
        return;
      }
      setLoad({ status: "loaded", data: { dropId: body.dropId, drop: body.drop } });
    } catch {
      setLoad({ status: "error", message: "Could not load drop. Check your connection." });
    }
  }, [slug]);

  useEffect(() => {
    if (slug) void fetchDrop();
  }, [fetchDrop, slug]);

  // ── Check if this wallet already claimed ─────────────────────────────────
  useEffect(() => {
    async function checkClaimed() {
      if (!address || !ARCDROP_ADDRESS || load.status !== "loaded") return;
      setCheckingClaimed(true);
      try {
        const { createPublicClient, http } = await import("viem");
        const { arcTestnet } = await import("viem/chains");
        const client = createPublicClient({
          chain: arcTestnet,
          transport: http("https://rpc.testnet.arc.network"),
        });
        const claimed = await client.readContract({
          address: ARCDROP_ADDRESS,
          abi: ARCDROP_ABI,
          functionName: "hasClaimed",
          args: [BigInt(load.data.dropId), address],
        });
        setAlreadyClaimed(Boolean(claimed));
      } catch {
        // Non-fatal; default stays false
      } finally {
        setCheckingClaimed(false);
      }
    }
    void checkClaimed();
  }, [address, load]);

  // ── Claim ────────────────────────────────────────────────────────────────
  async function handleClaim() {
    if (load.status !== "loaded" || !ARCDROP_ADDRESS) return;
    setClaimState("claiming");
    setClaimError("");
    try {
      const result = await writeContractAsync({
        chainId: 5042002,
        address: ARCDROP_ADDRESS,
        abi: ARCDROP_ABI,
        functionName: "claim",
        args: [BigInt(load.data.dropId)],
      });
      const hash = resultHash(result);
      if (hash) setClaimTxHash(hash);
      setClaimState("success");
      // Refresh drop state
      await fetchDrop();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Claim failed.";
      // Friendly message for the "already inactive" race condition
      const isInactive =
        msg.includes("drop is not active") ||
        msg.includes("already closed");
      setClaimError(
        isInactive
          ? "This drop was just fully claimed by someone else. You were too slow — the link is now closed."
          : msg.match(/ArcDrop:\s*([^\n"\\]+)/i)?.[1]?.trim() ?? msg.split("\n")[0],
      );
      setClaimState("error");
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-dvh flex-col bg-black">
      {/* Minimal header */}
      <header className="sticky top-0 z-40 flex h-16 items-center border-b border-white/[0.07] bg-black/80 px-4 backdrop-blur-xl sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/arclend-mark.png"
            alt="Lendora"
            width={24}
            height={24}
            className="h-6 w-6 object-contain"
          />
          <span className="font-display text-sm text-white/70">Lendora</span>
        </Link>
        <div className="ml-auto">
          <ConnectWalletButton />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-16 sm:px-6">
        <div className="w-full max-w-md">
          {load.status === "loading" && (
            <GlassCard className="flex flex-col items-center gap-4 p-10 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-white/40" />
              <p className="text-sm text-white/50">Loading drop…</p>
            </GlassCard>
          )}

          {load.status === "error" && (
            <GlassCard className="flex flex-col items-center gap-4 p-10 text-center">
              <XCircle className="h-10 w-10 text-red-300/70" />
              <p className="font-display text-xl text-white">Drop Not Found</p>
              <p className="text-sm text-white/55">{load.message}</p>
              <Link
                href="/arcdrop"
                className="mt-2 text-sm text-emerald-200/80 hover:text-white"
              >
                Create your own drop →
              </Link>
            </GlassCard>
          )}

          {load.status === "loaded" && (() => {
            const { drop, dropId } = load.data;
            const status = effectiveDropStatus(drop);
            const symbol = assetSymbol(drop.asset);
            const isActive = status === "active";
            const claimableAmount =
              drop.mode === DROP_MODE_CLAIM_ALL
                ? drop.remainingAmount
                : drop.perClaimAmount;
            const inactiveReason = statusLabel(
              drop.mode,
              drop.expiresAt,
              drop.active,
              drop.remainingAmount,
            );

            return (
              <GlassCard depth="foreground" className="overflow-hidden">
                {/* Drop header */}
                <div className="border-b border-white/[0.07] px-6 py-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-emerald-200/25 bg-emerald-200/[0.08]">
                      <Gift className="h-5 w-5 text-emerald-200/80" />
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-white/40">
                        Lendrop
                      </p>
                      <p className="font-display text-lg text-white">
                        {formatDropAmount(drop.totalAmount)} {symbol}
                      </p>
                    </div>
                    <span
                      className={[
                        "ml-auto rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wide",
                        isActive
                          ? "border-emerald-200/20 text-emerald-200/80"
                          : "border-white/10 text-white/35",
                      ].join(" ")}
                    >
                      {isActive ? "Active" : status.replace("_", " ")}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-[11px] text-white/35">Mode</p>
                      <p className="font-medium text-white/80">
                        {drop.mode === DROP_MODE_EQUAL_SPLIT
                          ? "Equal Split"
                          : "Claim All"}
                      </p>
                    </div>
                    {drop.mode === DROP_MODE_EQUAL_SPLIT && (
                      <div>
                        <p className="text-[11px] text-white/35">Claimed</p>
                        <p className="font-medium text-white/80">
                          {drop.claimantsCount} / {drop.maxClaimants}
                        </p>
                      </div>
                    )}
                    {drop.expiresAt !== "0" && (
                      <div>
                        <p className="text-[11px] text-white/35">Expires</p>
                        <p className="font-medium text-white/80">
                          {new Date(Number(drop.expiresAt) * 1000).toLocaleString()}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="px-6 py-6">
                  {/* Inactive states */}
                  {!isActive && (
                    <div className="flex flex-col items-center gap-3 py-4 text-center">
                      <XCircle className="h-8 w-8 text-white/30" />
                      <p className="text-sm text-white/55">{inactiveReason}</p>
                      <Link
                        href="/arcdrop"
                        className="mt-2 text-sm text-emerald-200/80 hover:text-white"
                      >
                        Create your own drop →
                      </Link>
                    </div>
                  )}

                  {/* Active: not connected */}
                  {isActive && !isConnected && (
                    <div className="flex flex-col items-center gap-5 text-center">
                      <div>
                        <p className="font-display text-2xl text-white">
                          You could receive
                        </p>
                        <p className="mt-1 font-display text-4xl font-medium text-emerald-200">
                          {formatDropAmount(claimableAmount)} {symbol}
                        </p>
                        <p className="mt-3 text-sm text-white/50">
                          {drop.mode === DROP_MODE_CLAIM_ALL
                            ? "First wallet to claim gets everything."
                            : `You'd receive an equal share of ${formatDropAmount(drop.totalAmount)} ${symbol}.`}
                        </p>
                      </div>
                      <p className="text-sm text-white/55">
                        Connect your wallet to claim
                      </p>
                      <ConnectWalletButton />
                    </div>
                  )}

                  {/* Active: connected, checking */}
                  {isActive && isConnected && checkingClaimed && (
                    <div className="flex items-center justify-center gap-3 py-6">
                      <Loader2 className="h-5 w-5 animate-spin text-white/40" />
                      <p className="text-sm text-white/50">Checking eligibility…</p>
                    </div>
                  )}

                  {/* Active: connected, already claimed */}
                  {isActive && isConnected && !checkingClaimed && alreadyClaimed && (
                    <div className="flex flex-col items-center gap-4 py-4 text-center">
                      <CheckCircle2 className="h-8 w-8 text-emerald-200/80" />
                      <p className="text-sm text-white/70">
                        You&apos;ve already claimed your share from this drop.
                      </p>
                      {claimTxHash && (
                        <a
                          href={`${ARCSCAN_TX_BASE}${claimTxHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-sm text-emerald-200/80 hover:text-white"
                        >
                          View transaction <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  )}

                  {/* Active: connected, eligible */}
                  {isActive && isConnected && !checkingClaimed && !alreadyClaimed && claimState !== "success" && (
                    <div className="flex flex-col gap-4">
                      <div className="rounded-2xl border border-emerald-200/15 bg-emerald-200/[0.05] px-4 py-4 text-center">
                        <p className="text-[11px] uppercase tracking-wide text-emerald-100/60">
                          You will receive
                        </p>
                        <p className="mt-1 font-display text-3xl font-medium text-emerald-200">
                          {formatDropAmount(claimableAmount)} {symbol}
                        </p>
                        <p className="mt-1.5 text-xs text-white/40">
                          Sent directly to your connected wallet
                        </p>
                      </div>

                      {claimState === "error" && claimError && (
                        <div className="flex items-start gap-2 rounded-xl border border-red-300/20 bg-red-300/[0.06] px-3 py-3">
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300/80" />
                          <p className="text-sm text-red-200/80">{claimError}</p>
                        </div>
                      )}

                      <GlassButton
                        variant="primary"
                        disabled={claimState === "claiming"}
                        onClick={() => void handleClaim()}
                        className="w-full"
                      >
                        {claimState === "claiming" ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Claiming…
                          </>
                        ) : (
                          <>
                            <Gift className="h-4 w-4" />
                            Claim {formatDropAmount(claimableAmount)} {symbol}
                          </>
                        )}
                      </GlassButton>
                      <p className="text-center text-xs text-white/35">
                        You sign your own transaction. Lendrop never touches
                        funds on your behalf.
                      </p>
                    </div>
                  )}

                  {/* Success */}
                  {claimState === "success" && (
                    <div className="flex flex-col items-center gap-4 py-4 text-center">
                      <CheckCircle2 className="h-10 w-10 text-emerald-200" />
                      <p className="font-display text-xl text-white">
                        Claimed successfully
                      </p>
                      <p className="text-sm text-white/55">
                        {formatDropAmount(claimableAmount)} {symbol} is now in
                        your wallet.
                      </p>
                      {claimTxHash && (
                        <a
                          href={`${ARCSCAN_TX_BASE}${claimTxHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-sm text-emerald-200/80 hover:text-white"
                        >
                          View on ArcScan{" "}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </GlassCard>
            );
          })()}
        </div>
      </main>

      <footer className="border-t border-white/[0.06] py-5 text-center">
        <p className="text-xs text-white/25">
          Powered by{" "}
          <a href="/" className="hover:text-white/60">
            Lendora on Arc
          </a>
        </p>
      </footer>
    </div>
  );
}
