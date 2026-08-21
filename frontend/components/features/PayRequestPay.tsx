"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  Copy,
  HandCoins,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import {
  erc20Abi,
  formatUnits,
  isAddress,
  parseUnits,
  type Address,
  type Hash,
} from "viem";
import { useChainId, usePublicClient, useSwitchChain } from "wagmi";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { AssetMark, SectionLabel } from "@/components/ui/MarketVisuals";
import { ARCSCAN_TX } from "@/components/modals/modalUtils";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import {
  resultHash,
  useArcLendContractWrite,
} from "@/hooks/useArcLendContractWrite";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import deployments from "@/constants/deployments.json";
import { ARC_DEX_TOKENS } from "@/lib/arcDex";
import {
  displayPayDomain,
  effectivePayRequestStatus,
  fallbackPayRequestFromSearch,
  formatPayExpiry,
  isPayRequestAsset,
  isStoredPayRequestId,
  parseExpiresAt,
  parsePayAmount,
  truncatePayAddress,
  type PayRequest,
  type PayRequestAsset,
} from "@/lib/payRequest";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type PayRequestPayProps = {
  refValue: string;
  amount?: string;
  asset?: string;
  memo?: string;
  to?: string;
  exp?: string;
};

type ViewState = "loading" | "ready" | "missing" | "paying" | "success";

export function PayRequestPay({
  refValue,
  amount,
  asset,
  memo,
  to,
  exp,
}: PayRequestPayProps) {
  const { address, isConnected } = useArcLendAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: 5042002 });
  const contractWrite = useArcLendContractWrite();
  const [request, setRequest] = useState<PayRequest | null>(null);
  const [editableAmount, setEditableAmount] = useState("");
  const [amountLocked, setAmountLocked] = useState(true);
  const [state, setState] = useState<ViewState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | undefined>();
  const [domainWarning, setDomainWarning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const ref = decodeURIComponent(refValue).trim();
    if (isStoredPayRequestId(ref)) {
      const response = await fetch(`/api/pay-requests/${ref}`);
      if (!response.ok) {
        setRequest(null);
        setState("missing");
        return;
      }
      const body = (await response.json()) as { request: PayRequest };
      const fromLink = parseExpiresAt(exp);
      const storedExpiry = body.request.expiresAt;
      const expiresAt =
        storedExpiry > 0 && fromLink
          ? Math.min(storedExpiry, fromLink)
          : storedExpiry > 0
            ? storedExpiry
            : fromLink ?? 0;
      setRequest({ ...body.request, expiresAt });
      setAmountLocked(true);
      setState("ready");
      return;
    }

    const fromQuery = fallbackPayRequestFromSearch({
      ref,
      amount,
      asset,
      memo,
      to,
      exp,
    });
    if (fromQuery) {
      if (
        fromQuery.recipientDomain &&
        (!fromQuery.recipient ||
          fromQuery.recipient === "0x0000000000000000000000000000000000000000")
      ) {
        const resolved = await resolveName(fromQuery.recipientDomain);
        if (!resolved) {
          setRequest(null);
          setState("missing");
          return;
        }
        fromQuery.recipient = resolved;
        fromQuery.createdBy = resolved;
      }
      setRequest(fromQuery);
      setAmountLocked(true);
      setState("ready");
      return;
    }

    const domain = displayPayDomain(ref);
    if (domain) {
      const resolved = await resolveName(domain);
      if (!resolved) {
        setRequest(null);
        setState("missing");
        return;
      }
      setRequest({
        id: `name:${domain}`,
        asset: "USDC",
        amount: "",
        recipient: resolved,
        recipientDomain: domain,
        createdBy: resolved,
        createdAt: Date.now(),
        expiresAt: parseExpiresAt(exp) ?? 0,
        status: "open",
      });
      setEditableAmount("");
      setAmountLocked(false);
      setState("ready");
      return;
    }

    if (isAddress(ref)) {
      setRequest({
        id: `addr:${ref.toLowerCase()}`,
        asset: "USDC",
        amount: "",
        recipient: ref,
        createdBy: ref,
        createdAt: Date.now(),
        expiresAt: parseExpiresAt(exp) ?? 0,
        status: "open",
      });
      setAmountLocked(false);
      setState("ready");
      return;
    }

    setRequest(null);
    setState("missing");
  }, [amount, asset, exp, memo, refValue, to]);

  useEffect(() => {
    void load().catch(() => {
      setState("missing");
    });
  }, [load]);

  useEffect(() => {
    if (!request?.recipientDomain || !publicClient) return;
    const domain = request.recipientDomain.replace(/\.lendora$/, "");
    void publicClient
      .readContract({
        address: deployments.WalletDomain as Address,
        abi: [
          {
            type: "function",
            name: "resolveDomain",
            stateMutability: "view",
            inputs: [{ name: "name", type: "string" }],
            outputs: [{ type: "address" }],
          },
        ],
        functionName: "resolveDomain",
        args: [domain],
      })
      .then((live) => {
        if (
          typeof live === "string" &&
          live.toLowerCase() !== request.recipient.toLowerCase()
        ) {
          setDomainWarning(
            `${request.recipientDomain} now resolves elsewhere. This request still pays the original wallet.`,
          );
        }
      })
      .catch(() => {
        // Keep the frozen recipient if live resolution fails.
      });
  }, [publicClient, request]);

  const payAsset: PayRequestAsset = request?.asset ?? "USDC";
  const token = ARC_DEX_TOKENS[payAsset];
  const lockedAmount = request ? parsePayAmount(request.amount) : null;
  const payAmount = amountLocked
    ? lockedAmount
    : parsePayAmount(editableAmount);
  const status = request ? effectivePayRequestStatus(request) : "open";
  const isSelf = Boolean(
    address && request && request.recipient.toLowerCase() === address.toLowerCase(),
  );

  const balance = useTokenBalance({
    address,
    token: token.address,
    chainId: 5042002,
    enabled: Boolean(address),
  });
  const walletBalance = balance.data?.value ?? 0n;
  const needed = payAmount ? parseUnits(payAmount, 6) : 0n;
  const insufficient = Boolean(address && payAmount && needed > walletBalance);

  const payeeTitle = request?.recipientDomain
    ? request.recipientDomain
    : request
      ? truncatePayAddress(request.recipient)
      : "—";

  const canPay =
    isConnected &&
    request &&
    status === "open" &&
    Boolean(payAmount) &&
    !isSelf &&
    !insufficient &&
    state !== "paying";

  async function handlePay() {
    if (!request || !payAmount || !address) return;
    setError(null);
    setState("paying");
    try {
      if (chainId !== 5042002) {
        await switchChainAsync({ chainId: 5042002 });
      }
      const submittedAt = performance.now();
      const hash = resultHash(
        await contractWrite.writeContractAsync({
          chainId: 5042002,
          address: token.address,
          abi: erc20Abi,
          functionName: "transfer",
          args: [request.recipient as Address, parseUnits(payAmount, 6)],
        }),
      );
      if (hash && publicClient) {
        await publicClient.waitForTransactionReceipt({ hash: hash as Hash });
      }
      setTxHash(hash);
      if (isStoredPayRequestId(request.id) && hash) {
        try {
          await fetch(`/api/pay-requests/${request.id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "paid",
              txHash: hash,
              payer: address,
            }),
          });
        } catch {
          // Receipt is still valid if indexing fails.
        }
      }
      setRequest((current) =>
        current
          ? { ...current, status: "paid", txHash: hash, paidBy: address }
          : current,
      );
      setState("success");
      showToast(
        "success",
        `Paid ${payAmount} ${payAsset} in ${Math.max(0, Math.round(performance.now() - submittedAt))}ms.`,
      );
    } catch (payError) {
      setState("ready");
      const message =
        payError instanceof Error ? payError.message : "Payment failed.";
      setError(message);
      showToast("error", message);
    }
  }

  const explorer = txHash ?? request?.txHash;

  if (state === "loading") {
    return (
      <GlassCard className="mx-auto max-w-xl p-8">
        <div className="flex items-center gap-3 text-white/50">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading request…
        </div>
      </GlassCard>
    );
  }

  if (state === "missing" || !request) {
    return (
      <GlassCard className="mx-auto max-w-xl p-8">
        <ShieldAlert className="h-6 w-6 text-red-200/80" />
        <h2 className="mt-3 font-display text-2xl text-white">
          This request is not live
        </h2>
        <p className="mt-2 text-sm leading-6 text-white/50">
          The link may be wrong, expired, or that .lendora name is not
          registered. Ask them to send a fresh request.
        </p>
      </GlassCard>
    );
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <GlassCard depth="foreground" className="p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <SectionLabel>Request to pay</SectionLabel>
            <h1 className="mt-2 font-display text-3xl text-white sm:text-5xl">
              {payAmount ? `${payAmount} ${payAsset}` : payAsset} to {payeeTitle}
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-6 text-white/50">
              Confirm once. Funds go to the wallet behind this name on Arc
              Testnet. Gas is USDC.
            </p>
          </div>
          <HandCoins className="h-7 w-7 text-emerald-200/85" />
        </div>

        <dl className="mt-8 grid gap-3 sm:grid-cols-2">
          <Fact label="Pay to" value={payeeTitle} />
          <Fact
            label="Wallet"
            value={truncatePayAddress(request.recipient)}
            copy={request.recipient}
          />
          <Fact
            label="Asset"
            value={
              <span className="inline-flex items-center gap-2">
                <AssetMark symbol={payAsset} size="sm" />
                {payAsset}
              </span>
            }
          />
          <Fact
            label="Status"
            value={
              <span
                className={cn(
                  "uppercase tracking-wide",
                  status === "open" && "text-emerald-200",
                  status === "paid" && "text-white",
                  (status === "cancelled" || status === "expired") &&
                    "text-red-200/80",
                )}
              >
                {status}
                {status === "open" && request.expiresAt > 0
                  ? ` · ${formatPayExpiry(request.expiresAt)}`
                  : ""}
              </span>
            }
          />
        </dl>

        {request.memo ? (
          <p className="mt-5 rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white/70">
            {request.memo}
          </p>
        ) : null}

        {domainWarning ? (
          <p className="mt-4 text-xs leading-5 text-amber-100/80">{domainWarning}</p>
        ) : null}

        {!amountLocked ? (
          <label className="mt-6 grid gap-2">
            <span className="text-[11px] uppercase tracking-wide text-white/40">
              Amount
            </span>
            <input
              value={editableAmount}
              onChange={(event) => setEditableAmount(event.target.value)}
              inputMode="decimal"
              placeholder="40"
              className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-2xl text-white outline-none placeholder:text-white/25 focus:border-emerald-200/40"
            />
          </label>
        ) : null}

        {address ? (
          <p className="mt-5 font-mono text-xs text-white/40">
            Your {payAsset}:{" "}
            {balance.data
              ? Number(formatUnits(balance.data.value, 6)).toLocaleString(
                  undefined,
                  { maximumFractionDigits: 2 },
                )
              : "—"}
          </p>
        ) : (
          <p className="mt-5 text-sm text-white/45">
            Connect a wallet in the header to pay this request.
          </p>
        )}

        {isSelf ? (
          <p className="mt-3 text-sm text-amber-100/80">
            This request is addressed to your connected wallet.
          </p>
        ) : null}
        {insufficient ? (
          <p className="mt-3 text-sm text-red-200/80">
            You need {payAmount} {payAsset} in this wallet.
          </p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-red-200/80">{error}</p> : null}

        {state === "success" || status === "paid" ? (
          <div className="mt-6 rounded-2xl border border-emerald-200/20 bg-emerald-200/[0.07] p-4">
            <div className="flex items-center gap-2 text-emerald-100">
              <CheckCircle2 className="h-5 w-5" />
              Paid
            </div>
            {explorer ? (
              <a
                href={`${ARCSCAN_TX}${explorer}`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-sm text-white/70 hover:text-white"
              >
                View on ArcScan
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            ) : null}
          </div>
        ) : (
          <GlassButton
            variant="primary"
            disabled={!canPay}
            onClick={() => void handlePay()}
            className="mt-6 w-full"
          >
            {state === "paying" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <HandCoins className="h-4 w-4" />
            )}
            {!isConnected
              ? "Connect to pay"
              : status !== "open"
                ? "Not payable"
                : `Pay ${payAmount ?? "—"} ${payAsset}`}
          </GlassButton>
        )}
      </GlassCard>
    </div>
  );
}

function Fact({
  label,
  value,
  copy,
}: {
  label: string;
  value: ReactNode;
  copy?: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-black/20 px-4 py-3">
      <p className="text-[10px] uppercase tracking-wide text-white/38">{label}</p>
      <div className="mt-1 flex items-center gap-2 text-sm text-white">
        <span className="min-w-0 truncate font-mono">{value}</span>
        {copy ? (
          <button
            type="button"
            aria-label="Copy address"
            onClick={() => {
              void navigator.clipboard.writeText(copy);
              showToast("success", "Address copied.");
            }}
            className="text-white/35 hover:text-white"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

async function resolveName(domain: string) {
  const label = domain.replace(/\.lendora$/, "");
  try {
    const response = await fetch(
      `/api/pay-resolve?name=${encodeURIComponent(label)}`,
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { address?: string };
    return body.address && isAddress(body.address) ? body.address : null;
  } catch {
    return null;
  }
}
