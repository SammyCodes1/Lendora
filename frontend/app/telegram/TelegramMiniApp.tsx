"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAccount, useConnect, useSignMessage } from "wagmi";
import type { Address, EIP1193Provider } from "viem";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { ActionConfirmCard } from "@/components/agent/ActionConfirmCard";
import { linkMessage } from "@/lib/telegramLinkMessage";
import type {
  AgentTransactionReceipt,
  ValidatedAgentAction,
} from "@/lib/agentTypes";

function telegramUserIdFromInitData(initData: string): number | null {
  const params = new URLSearchParams(initData);
  const userRaw = params.get("user");
  if (!userRaw) return null;
  try {
    const user = JSON.parse(userRaw) as { id?: number };
    return typeof user.id === "number" ? user.id : null;
  } catch {
    return null;
  }
}

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

type LinkState =
  | { status: "idle" }
  | { status: "connecting" }
  | { status: "linked"; walletAddress: string };

export function TelegramMiniApp() {
  const searchParams = useSearchParams();
  const txRefId = searchParams.get("tx") ?? null;

  const { address, isConnected, connector } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { signMessageAsync } = useSignMessage();

  const [initData, setInitData] = useState<string | null>(null);
  const [linkState, setLinkState] = useState<LinkState>({ status: "idle" });
  const [pairingUri, setPairingUri] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Sign-flow state
  const [pending, setPending] = useState<
    | { status: "loading" }
    | { status: "ready"; validatedAction: ValidatedAgentAction }
    | { status: "error"; message: string }
  >({ status: "loading" });
  const [receipt, setReceipt] =
    useState<AgentTransactionReceipt | null>(null);
  const [signError, setSignError] = useState<string | null>(null);

  const telegram = typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;

  useEffect(() => {
    const data = telegram?.initData;
    if (data) {
      setInitData(data);
      telegram?.ready?.();
      telegram?.expand?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isLinkFlow = !txRefId;

  // Fetch the prepared transaction in sign mode.
  useEffect(() => {
    if (isLinkFlow || !initData || !txRefId) return;
    let cancelled = false;

    const load = async () => {
      setPending({ status: "loading" });
      try {
        const response = await fetch(
          `/api/telegram/pending-tx/${encodeURIComponent(txRefId)}`,
          { headers: { "x-telegram-initdata": initData } },
        );
        const body = (await response.json()) as {
          validatedAction?: ValidatedAgentAction;
          error?: string;
        };
        if (!response.ok) {
          if (!cancelled) {
            setPending({
              status: "error",
              message: body.error ?? "Unable to load the prepared transaction.",
            });
          }
          return;
        }
        if (!body.validatedAction) {
          if (!cancelled) {
            setPending({
              status: "error",
              message: "Prepared transaction is missing data.",
            });
          }
          return;
        }
        if (!cancelled) {
          setPending({ status: "ready", validatedAction: body.validatedAction });
        }
      } catch {
        if (!cancelled) {
          setPending({ status: "error", message: "Network error loading the transaction." });
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [initData, isLinkFlow, txRefId]);

  const walletConnectConnector = useMemo(
    () => connectors.find((c) => c.id === "walletConnect"),
    [connectors],
  );

  const connectWallet = useCallback(async () => {
    if (!walletConnectConnector) {
      setLinkError("WalletConnect is not configured.");
      return;
    }
    setLinkState({ status: "connecting" });
    setLinkError(null);
    setPairingUri(null);
    try {
      const provider = (await walletConnectConnector.getProvider()) as EIP1193Provider & {
        on?: (event: string, cb: (uri: string) => void) => void;
      };
      provider?.on?.("display_uri", (uri: string) => setPairingUri(uri));
      await connectAsync({ connector: walletConnectConnector });
      setPairingUri(null);
    } catch {
      // The connect promise may reject while pairing is still possible via the
      // emitted URI (e.g. user dismissed the in-wallet prompt). Keep the URI
      // visible so they can complete pairing manually.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletConnectConnector, connectAsync]);

  const linkWallet = useCallback(async () => {
    if (!initData || !address) return;
    const userId = telegramUserIdFromInitData(initData);
    if (!userId) {
      setLinkError("Could not read your Telegram identity.");
      return;
    }
    setLinkState({ status: "connecting" });
    setLinkError(null);

    try {
      const nonceResponse = await fetch("/api/telegram/nonce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      });
      const nonceBody = (await nonceResponse.json()) as {
        nonce?: string;
        error?: string;
      };
      if (!nonceResponse.ok || !nonceBody.nonce) {
        throw new Error(nonceBody.error ?? "Unable to start wallet linking.");
      }

      const signature = await signMessageAsync({
        message: linkMessage(userId, nonceBody.nonce),
      });

      const linkResponse = await fetch("/api/telegram/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initData,
          walletAddress: address,
          signature,
          nonce: nonceBody.nonce,
        }),
      });
      const linkBody = (await linkResponse.json()) as { error?: string };
      if (!linkResponse.ok) {
        throw new Error(linkBody.error ?? "Wallet linking failed.");
      }

      setLinkState({ status: "linked", walletAddress: address });
    } catch (caught) {
      setLinkState({ status: "idle" });
      setLinkError(
        caught instanceof Error ? caught.message : "Wallet linking failed.",
      );
    }
  }, [address, initData, signMessageAsync]);

  const consumeTransaction = useCallback(async () => {
    if (!initData || !txRefId) return;
    try {
      await fetch("/api/telegram/tx-consume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, txRefId }),
      });
    } catch {
      // The action already landed on-chain; consume failure is non-fatal.
    }
  }, [initData, txRefId]);

  const handleComplete = useCallback(
    (transactionReceipt: AgentTransactionReceipt) => {
      setReceipt(transactionReceipt);
      void consumeTransaction();
    },
    [consumeTransaction],
  );

  const handleBlocked = useCallback((reason: string) => {
    setSignError(reason);
  }, []);

  if (!initData) {
    return (
      <div className="-mt-[calc(6.75rem+env(safe-area-inset-top,0px))] sm:-mt-[calc(7rem+env(safe-area-inset-top,0px))] flex min-h-screen items-center justify-center p-5">
        <GlassCard className="w-full max-w-sm p-6 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-emerald-200" />
          <h1 className="mt-3 text-lg font-semibold text-white">
            Open inside Telegram
          </h1>
          <p className="mt-2 text-sm leading-5 text-white/60">
            This page signs Lendora transactions and only works inside the
            Lendora Telegram Mini App.
          </p>
        </GlassCard>
      </div>
    );
  }

  // Sign flow: a prepared transaction was handed off from the bot.
  if (!isLinkFlow) {
    return (
      <div className="-mt-[calc(6.75rem+env(safe-area-inset-top,0px))] sm:-mt-[calc(7rem+env(safe-area-inset-top,0px))] min-h-screen p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
        {pending.status === "loading" ? (
          <div className="flex min-h-[50vh] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-white/40" />
          </div>
        ) : null}

        {pending.status === "error" ? (
          <GlassCard className="mx-auto mt-16 w-full max-w-sm p-6 text-center">
            <X className="mx-auto h-10 w-10 text-red-300" />
            <h1 className="mt-3 text-lg font-semibold text-white">
              Transaction unavailable
            </h1>
            <p className="mt-2 text-sm leading-5 text-white/60">
              {pending.message}
            </p>
            <GlassButton
              variant="ghost"
              className="mt-5 w-full"
              onClick={() => telegram?.close()}
            >
              Close
            </GlassButton>
          </GlassCard>
        ) : null}

        {pending.status === "ready" && !receipt ? (
          <div className="mx-auto w-full max-w-md">
            <header className="px-1 pb-3 pt-2">
              <h1 className="text-base font-semibold text-white">
                Sign transaction
              </h1>
              <p className="mt-0.5 text-xs leading-4 text-white/50">
                Review and sign with your connected wallet. Only the transaction
                prepared by the bot can be executed.
              </p>
            </header>

            {!isConnected || !address ? (
              <GlassCard className="p-5 text-center">
                <Wallet className="mx-auto h-8 w-8 text-white/70" />
                <p className="mt-3 text-sm font-medium text-white">
                  Connect your wallet to sign
                </p>
                <p className="mt-1 text-xs leading-4 text-white/50">
                  Use the same wallet you linked to Telegram.
                </p>
                <GlassButton
                  variant="primary"
                  className="mt-4 w-full"
                  disabled={linkState.status === "connecting"}
                  onClick={() => void connectWallet()}
                >
                  {linkState.status === "connecting" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wallet className="h-4 w-4" />
                  )}
                  Connect Wallet
                </GlassButton>
                {pairingUri ? (
                  <PairingFallback uri={pairingUri} />
                ) : null}
                {linkError ? (
                  <p role="alert" className="mt-3 text-xs text-red-300">
                    {linkError}
                  </p>
                ) : null}
              </GlassCard>
            ) : (
              <>
                {signError ? (
                  <GlassCard className="mb-3 border-red-300/15 bg-red-300/[0.06] p-4">
                    <p role="alert" className="text-xs leading-5 text-red-200">
                      {signError}
                    </p>
                  </GlassCard>
                ) : null}
                <ActionConfirmCard
                  validatedAction={pending.validatedAction}
                  onCancel={() => telegram?.close()}
                  onComplete={handleComplete}
                  onBlocked={handleBlocked}
                />
              </>
            )}
          </div>
        ) : null}

        {receipt ? (
          <GlassCard className="mx-auto mt-16 w-full max-w-sm p-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-200" />
            <h1 className="mt-3 text-lg font-semibold text-white">
              {receipt.title}
            </h1>
            <p className="mt-1 text-xs text-white/50">
              {receipt.amountLabel}:{" "}
              <span className="font-medium text-white/80">{receipt.amount}</span>
            </p>
            {receipt.transactionHash ? (
              <a
                href={
                  receipt.explorerUrl ??
                  `https://testnet.arcscan.app/tx/${receipt.transactionHash}`
                }
                target="_blank"
                rel="noreferrer"
                className="mt-4 flex items-center justify-center gap-1.5 text-sm text-emerald-200 underline underline-offset-2"
              >
                <ExternalLink className="h-4 w-4" />
                View transaction
              </a>
            ) : null}
            <GlassButton
              variant="ghost"
              className="mt-5 w-full"
              onClick={() => telegram?.close()}
            >
              Done
            </GlassButton>
          </GlassCard>
        ) : null}
      </div>
    );
  }

  // Link flow: no prepared transaction — connect + link a wallet.
  return (
    <div className="-mt-[calc(6.75rem+env(safe-area-inset-top,0px))] sm:-mt-[calc(7rem+env(safe-area-inset-top,0px))] flex min-h-screen items-center justify-center p-5 pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
      <div className="w-full max-w-sm">
        <GlassCard className="p-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-200/20 bg-emerald-200/[0.08]">
            <Link2 className="h-5 w-5 text-emerald-100" />
          </div>
          <h1 className="mt-4 text-lg font-semibold text-white">
            {linkState.status === "linked"
              ? "Wallet linked"
              : "Link your wallet"}
          </h1>
          <p className="mt-2 text-sm leading-5 text-white/60">
            {linkState.status === "linked"
              ? "Your wallet is linked to your Telegram account. Ask the bot about your position or prepare a transaction and sign it here."
              : "Connect your wallet once so the Lendora bot can read your position, then sign transactions from Telegram."}
          </p>

          {linkState.status === "linked" ? (
            <>
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200/15 bg-emerald-200/[0.05] px-3 py-2.5">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-200" />
                <span className="font-mono text-xs text-white/80">
                  {truncateAddress(linkState.walletAddress)}
                </span>
              </div>
              <GlassButton
                variant="ghost"
                className="mt-4 w-full"
                onClick={() => telegram?.close()}
              >
                Done
              </GlassButton>
            </>
          ) : (
            <>
              {isConnected && address ? (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5">
                  <Wallet className="h-4 w-4 shrink-0 text-white/60" />
                  <span className="font-mono text-xs text-white/80">
                    {truncateAddress(address)}
                  </span>
                  {connector?.name ? (
                    <span className="ml-auto text-[10px] uppercase text-white/35">
                      {connector.name}
                    </span>
                  ) : null}
                </div>
              ) : null}

              <GlassButton
                variant="primary"
                className="mt-4 w-full"
                disabled={
                  linkState.status === "connecting" ||
                  (isConnected && Boolean(address))
                }
                onClick={() => {
                  if (isConnected && address) {
                    void linkWallet();
                  } else {
                    void connectWallet();
                  }
                }}
              >
                {linkState.status === "connecting" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isConnected && address ? (
                  <Link2 className="h-4 w-4" />
                ) : (
                  <Wallet className="h-4 w-4" />
                )}
                {linkState.status === "connecting"
                  ? "Waiting…"
                  : isConnected && address
                    ? "Link to Telegram"
                    : "Connect Wallet"}
              </GlassButton>

              {isConnected && address ? (
                <p className="mt-3 text-center text-[11px] leading-4 text-white/40">
                  Sign one message with your wallet to prove ownership. No keys
                  are shared with the bot.
                </p>
              ) : null}

              {pairingUri ? <PairingFallback uri={pairingUri} /> : null}
              {linkError ? (
                <p role="alert" className="mt-3 text-xs text-red-300">
                  {linkError}
                </p>
              ) : null}
            </>
          )}
        </GlassCard>

        <p className="mt-4 px-4 text-center text-[11px] leading-4 text-white/35">
          The bot never holds your private keys. Every transaction is signed by
          your own wallet and broadcast directly on Arc Testnet.
        </p>
      </div>
    </div>
  );
}

function PairingFallback({ uri }: { uri: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(uri);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be unavailable inside the WebView; the user can select the text.
    }
  }, [uri]);

  return (
    <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3 text-left">
      <p className="text-[11px] font-semibold uppercase text-white/50">
        Pair with your wallet app
      </p>
      <p className="mt-1 text-[11px] leading-4 text-white/45">
        Open your WalletConnect wallet and paste this pairing URI:
      </p>
      <code className="mt-2 block max-h-16 overflow-y-auto break-all rounded-md border border-white/[0.08] bg-black/30 px-2 py-1.5 font-mono text-[10px] text-white/60">
        {uri}
      </code>
      <GlassButton
        variant="ghost"
        className="mt-2 w-full"
        onClick={() => void copy()}
      >
        {copied ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-200" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
        {copied ? "Copied" : "Copy pairing URI"}
      </GlassButton>
    </div>
  );
}
