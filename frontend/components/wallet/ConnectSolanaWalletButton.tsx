"use client";

import Image from "next/image";
import { Check, ExternalLink, LogOut, Wallet } from "lucide-react";
import { GlassButton } from "@/components/ui/GlassButton";
import { useSolanaWallet } from "@/hooks/useSolanaWallet";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

function truncatePublicKey(publicKey: string) {
  return `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;
}

export function ConnectSolanaWalletButton() {
  const {
    wallets,
    selectedWalletName,
    selectWallet,
    publicKey,
    isConnected,
    connect,
    disconnect,
    isAvailable,
  } = useSolanaWallet();

  if (!isAvailable) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-white/70">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-violet-400/10 text-violet-200">
            <Wallet className="h-3.5 w-3.5" />
          </span>
          No Solana wallet detected
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <a
            href="https://phantom.app"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.035] px-2 text-xs text-white/60 transition hover:border-white/15 hover:text-white"
          >
            Phantom <ExternalLink className="h-3 w-3" />
          </a>
          <a
            href="https://solflare.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.035] px-2 text-xs text-white/60 transition hover:border-white/15 hover:text-white"
          >
            Solflare <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-violet-400/10 text-violet-200">
            <Wallet className="h-3.5 w-3.5" />
          </span>
          <div>
            <p className="text-xs font-medium text-white/75">Solana wallet</p>
            <p className="text-[10px] text-white/35">
              {wallets.length} detected
            </p>
          </div>
        </div>
        {isConnected ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200/10 bg-emerald-200/[0.06] px-2 py-1 text-[10px] text-emerald-100/75">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            Connected
          </span>
        ) : null}
      </div>

      <div
        role="radiogroup"
        aria-label="Choose a Solana wallet"
        className="mt-3 grid grid-cols-2 gap-2"
      >
        {wallets.map((wallet) => {
          const selected = wallet.name === selectedWalletName;
          return (
            <button
              key={wallet.name}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => selectWallet(wallet.name)}
              className={cn(
                "relative flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition",
                selected
                  ? "border-violet-300/30 bg-violet-300/[0.09] text-white"
                  : "border-white/[0.07] bg-white/[0.025] text-white/55 hover:border-white/15 hover:bg-white/[0.05] hover:text-white/80",
              )}
            >
              <Image
                src={wallet.icon}
                alt=""
                width={26}
                height={26}
                unoptimized
                className="h-7 w-7 shrink-0 rounded-md"
              />
              <span className="min-w-0 truncate text-xs font-medium">
                {wallet.name}
              </span>
              {selected ? (
                <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-violet-200" />
              ) : null}
            </button>
          );
        })}
      </div>

      {isConnected && publicKey ? (
        <GlassButton
          type="button"
          variant="ghost"
          className="mt-2.5 w-full justify-between font-mono text-xs"
          title="Disconnect Solana wallet"
          onClick={async () => {
            try {
              await disconnect();
            } catch (error) {
              showToast(
                "error",
                error instanceof Error
                  ? error.message
                  : "Could not disconnect wallet",
              );
            }
          }}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Wallet className="h-4 w-4 shrink-0" />
            <span className="truncate">{truncatePublicKey(publicKey)}</span>
          </span>
          <LogOut className="h-3.5 w-3.5 shrink-0 text-white/45" />
        </GlassButton>
      ) : (
        <GlassButton
          type="button"
          variant="ghost"
          className="mt-2.5 w-full"
          onClick={async () => {
            try {
              await connect();
              showToast("success", `${selectedWalletName ?? "Solana wallet"} connected`);
            } catch (error) {
              showToast(
                "error",
                error instanceof Error ? error.message : "Could not connect wallet",
              );
            }
          }}
        >
          <Wallet className="h-4 w-4" />
          Connect {selectedWalletName ?? "Wallet"}
        </GlassButton>
      )}
    </div>
  );
}
