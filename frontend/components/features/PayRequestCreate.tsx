"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  HandCoins,
  Link2,
  Loader2,
  Sparkles,
} from "lucide-react";
import { isAddress } from "viem";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { AssetMark, SectionLabel } from "@/components/ui/MarketVisuals";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import { usePrimaryDomain } from "@/hooks/usePrimaryDomain";
import {
  absolutePayUrl,
  formatPayExpiry,
  isPayRequestAsset,
  PAY_REQUEST_EXPIRY_OPTIONS,
  parsePayAmount,
  truncatePayAddress,
  type PayRequest,
  type PayRequestAsset,
} from "@/lib/payRequest";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "lendora:pay-requests";

type SavedRequest = PayRequest & {
  path: string;
  manageToken?: string;
  stored: boolean;
};

function readSaved(): SavedRequest[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedRequest[];
    return Array.isArray(parsed) ? parsed.slice(0, 40) : [];
  } catch {
    return [];
  }
}

function writeSaved(rows: SavedRequest[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(0, 40)));
}

export function PayRequestCreate() {
  const { address, isConnected } = useArcLendAccount();
  const { primaryDomain } = usePrimaryDomain(address);
  const [asset, setAsset] = useState<PayRequestAsset>("USDC");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [expiry, setExpiry] = useState(PAY_REQUEST_EXPIRY_OPTIONS[1].seconds);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [created, setCreated] = useState<SavedRequest | null>(null);
  const [mine, setMine] = useState<SavedRequest[]>([]);

  useEffect(() => {
    setMine(readSaved());
  }, []);

  const payeeLabel = primaryDomain ?? (address ? truncatePayAddress(address) : "your wallet");

  const refreshRemote = useCallback(async () => {
    if (!address || !isAddress(address)) return;
    try {
      const response = await fetch(
        `/api/pay-requests?wallet=${encodeURIComponent(address)}`,
      );
      if (!response.ok) return;
      const body = (await response.json()) as { requests?: PayRequest[] };
      const remote = body.requests ?? [];
      setMine((current) => {
        const localById = new Map(current.map((row) => [row.id, row]));
        const merged = remote.map((row) => {
          const local = localById.get(row.id);
          return {
            ...row,
            path: local?.path ?? `/pay/${row.id}`,
            manageToken: local?.manageToken,
            stored: true,
          };
        });
        const extras = current.filter(
          (row) => !remote.some((item) => item.id === row.id),
        );
        const next = [...merged, ...extras];
        writeSaved(next);
        return next;
      });
    } catch {
      // Local history is enough when the index is unavailable.
    }
  }, [address]);

  useEffect(() => {
    void refreshRemote();
  }, [refreshRemote]);

  const parsedAmount = parsePayAmount(amount);
  const canCreate = isConnected && Boolean(parsedAmount) && !busy;

  async function handleCreate() {
    if (!address || !parsedAmount) return;
    setBusy(true);
    try {
      const response = await fetch("/api/pay-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: address,
          asset,
          amount: parsedAmount,
          memo: memo.trim() || undefined,
          expiresInSeconds: expiry,
          domain: primaryDomain || undefined,
        }),
      });
      const body = (await response.json()) as {
        request?: PayRequest;
        path?: string;
        manageToken?: string;
        stored?: boolean;
        error?: string;
      };
      if (!response.ok || !body.request || !body.path) {
        throw new Error(body.error ?? "Could not create that request.");
      }
      const saved: SavedRequest = {
        ...body.request,
        path: body.path,
        manageToken: body.manageToken,
        stored: Boolean(body.stored),
      };
      setCreated(saved);
      setMine((current) => {
        const next = [saved, ...current.filter((row) => row.id !== saved.id)];
        writeSaved(next);
        return next;
      });
      showToast("success", "Request ready — copy the link and send it.");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Could not create that request.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyPath(path: string) {
    const url = absolutePayUrl(path);
    await navigator.clipboard.writeText(url);
    setCopied(true);
    showToast("success", "Link copied.");
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function cancelRequest(row: SavedRequest) {
    if (!row.manageToken || !row.stored) {
      showToast("error", "This link cannot be cancelled from here.");
      return;
    }
    try {
      const response = await fetch(`/api/pay-requests/${row.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", manageToken: row.manageToken }),
      });
      const body = (await response.json()) as {
        request?: PayRequest;
        error?: string;
      };
      if (!response.ok || !body.request) {
        throw new Error(body.error ?? "Could not cancel.");
      }
      setMine((current) => {
        const next = current.map((item) =>
          item.id === row.id ? { ...item, ...body.request! } : item,
        );
        writeSaved(next);
        return next;
      });
      if (created?.id === row.id) {
        setCreated((current) =>
          current ? { ...current, ...body.request! } : current,
        );
      }
      showToast("success", "Request cancelled.");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Could not cancel.",
      );
    }
  }

  const createdUrl = created ? absolutePayUrl(created.path) : null;
  const history = useMemo(
    () => mine.filter((row) => row.createdBy.toLowerCase() === address?.toLowerCase()),
    [address, mine],
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[1.12fr_0.88fr]">
      <GlassCard depth="foreground" className="p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <SectionLabel>New request</SectionLabel>
            <h2 className="mt-2 font-display text-2xl text-white sm:text-3xl">
              Ask for {asset}
            </h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-white/50">
              Pays {payeeLabel}. The payer sees your .lendora name, not a raw
              paste of your address. They confirm once.
            </p>
          </div>
          <HandCoins className="h-6 w-6 text-emerald-200/80" />
        </div>

        <div className="mt-6 grid gap-4">
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

          <label className="grid gap-2">
            <span className="text-[11px] uppercase tracking-wide text-white/40">
              Amount
            </span>
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              placeholder=""
              className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-2xl text-white outline-none placeholder:text-white/25 focus:border-emerald-200/40"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-[11px] uppercase tracking-wide text-white/40">
              Memo
            </span>
            <input
              value={memo}
              onChange={(event) => setMemo(event.target.value.slice(0, 120))}
              placeholder="Dinner, invoice 104, Friday rent…"
              className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-emerald-200/40"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            {PAY_REQUEST_EXPIRY_OPTIONS.map((option) => (
              <button
                key={option.seconds}
                type="button"
                onClick={() => setExpiry(option.seconds)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs transition",
                  expiry === option.seconds
                    ? "border-white/80 bg-white text-black"
                    : "border-white/10 text-white/50 hover:text-white",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <GlassButton
            variant="primary"
            disabled={!canCreate}
            onClick={() => void handleCreate()}
            className="mt-1"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {isConnected ? "Create request link" : "Connect wallet first"}
          </GlassButton>
        </div>

        {created && createdUrl ? (
          <div className="mt-6 rounded-2xl border border-emerald-200/20 bg-emerald-200/[0.06] p-4">
            <p className="text-[11px] uppercase tracking-wide text-emerald-100/70">
              Share this
            </p>
            <p className="mt-2 break-all font-mono text-sm text-white">{createdUrl}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <GlassButton
                variant="primary"
                onClick={() => void copyPath(created.path)}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                Copy link
              </GlassButton>
              <GlassButton
                type="button"
                onClick={() => window.location.assign(created.path)}
              >
                Open pay page
              </GlassButton>
            </div>
          </div>
        ) : null}
      </GlassCard>

      <div className="space-y-5">
        <GlassCard className="p-5">
          <SectionLabel>How it works</SectionLabel>
          <ol className="mt-4 space-y-3 text-sm leading-6 text-white/55">
            <li>1. You lock an amount to {payeeLabel}.</li>
            <li>2. Share the link — chat, email, Telegram.</li>
            <li>3. They open it, see the name, confirm once. USDC gas.</li>
          </ol>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-center justify-between gap-3">
            <SectionLabel>Your requests</SectionLabel>
            <Link2 className="h-4 w-4 text-white/35" />
          </div>
          {history.length === 0 ? (
            <p className="mt-4 text-sm text-white/40">
              Nothing yet. Create a request and the link stays here on this device.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {history.slice(0, 8).map((row) => (
                <li
                  key={row.id}
                  className="rounded-xl border border-white/[0.08] bg-black/20 px-3.5 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-sm text-white">
                      {row.amount} {isPayRequestAsset(row.asset) ? row.asset : ""}
                    </p>
                    <span
                      className={cn(
                        "text-[10px] uppercase tracking-wide",
                        row.status === "open" && "text-emerald-200/80",
                        row.status === "paid" && "text-white/55",
                        (row.status === "cancelled" || row.status === "expired") &&
                          "text-red-200/70",
                      )}
                    >
                      {row.status}
                    </span>
                  </div>
                  {row.memo ? (
                    <p className="mt-1 truncate text-xs text-white/45">{row.memo}</p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-white/35">
                    {row.status === "open" ? formatPayExpiry(row.expiresAt) : null}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void copyPath(row.path)}
                      className="text-xs text-emerald-100/80 hover:text-white"
                    >
                      Copy
                    </button>
                    {row.status === "open" && row.manageToken ? (
                      <button
                        type="button"
                        onClick={() => void cancelRequest(row)}
                        className="text-xs text-red-200/70 hover:text-red-100"
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
