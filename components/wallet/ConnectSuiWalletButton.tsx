"use client";

import { Check, ExternalLink, LogOut, Wallet } from "lucide-react";
import { GlassButton } from "@/components/ui/GlassButton";
import { useSuiWallet } from "@/hooks/useSuiWallet";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

function truncateAddress(address: string) {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function ConnectSuiWalletButton() {
  const {
    wallets,
    selectedWalletName,
    selectWallet,
    address,
    isConnected,
    connect,
    disconnect,
    isAvailable,
  } = useSuiWallet();

  if (!isAvailable) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-white/70">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-sky-400/10 text-sky-200">
            <Wallet className="h-3.5 w-3.5" />
          </span>
          No Sui wallet detected
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <a
            href="https://slush.app"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.035] px-2 text-xs text-white/60 transition hover:border-white/15 hover:text-white"
          >
            Slush <ExternalLink className="h-3 w-3" />
          </a>
          <a
            href="https://phantom.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.035] px-2 text-xs text-white/60 transition hover:border-white/15 hover:text-white"
          >
            Phantom <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/35">
          Sui wallet
        </span>
        {isConnected ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300">
            <Check className="h-3 w-3" /> Connected
          </span>
        ) : null}
      </div>
      {wallets.length > 1 ? (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {wallets.map((wallet) => {
            const selected = wallet.name === selectedWalletName;
            return (
              <button
                key={wallet.name}
                type="button"
                onClick={() => selectWallet(wallet.name)}
                className={cn(
                  "truncate rounded-lg border px-2 py-1.5 text-left text-[11px]",
                  selected
                    ? "border-sky-400/40 bg-sky-400/10 text-white"
                    : "border-white/10 text-white/55 hover:text-white",
                )}
              >
                {wallet.name}
              </button>
            );
          })}
        </div>
      ) : null}
      {isConnected && address ? (
        <GlassButton
          type="button"
          variant="ghost"
          className="mt-2.5 w-full justify-between font-mono text-xs"
          title="Disconnect Sui wallet"
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
            <span className="truncate">{truncateAddress(address)}</span>
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
              showToast("success", `${selectedWalletName ?? "Sui wallet"} connected`);
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
