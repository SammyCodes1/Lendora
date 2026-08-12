"use client";

import { Check, ChevronDown, Copy, ExternalLink, LogOut, Mail, Wallet } from "lucide-react";
import { useCallback, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { type Address } from "viem";
import { GlassButton } from "@/components/ui/GlassButton";
import { showToast } from "@/lib/toast";
import { usePrimaryDomain } from "@/hooks/usePrimaryDomain";
import {
  CircleEmailWalletDialog,
} from "@/components/wallet/CircleEmailWalletDialog";
import { useCircleEmailWallet } from "@/components/wallet/CircleEmailWalletProvider";
import { useCloseOnResume } from "@/hooks/useCloseOnResume";

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function ConnectWalletButton() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [emailWalletOpen, setEmailWalletOpen] = useState(false);
  const emailWallet = useCircleEmailWallet();
  const closeDropdown = useCallback(() => setOpen(false), []);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const activeAddress = address ?? (emailWallet.wallet?.address as Address | undefined);
  const { primaryDomain } = usePrimaryDomain(activeAddress);

  const handleEmailWalletReady = useCallback(
    (wallet: Parameters<typeof emailWallet.setSession>[0], auth: Parameters<typeof emailWallet.setSession>[1]) => {
      emailWallet.setSession(wallet, auth);
      setEmailWalletOpen(false);
    },
    [emailWallet.setSession],
  );

  useEffect(() => {
    if (!emailWallet.signInRequested) return;
    setEmailWalletOpen(true);
    emailWallet.clearSignInRequest();
  }, [emailWallet.clearSignInRequest, emailWallet.signInRequested]);

  // Close after wallet sheet / tab freeze so the portal cannot block the navbar.
  useCloseOnResume(closeDropdown, open);

  useEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }

    const positionMenu = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const width = 260;
      setMenuPosition({
        top: rect.bottom + 8,
        left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
      });
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        closeDropdown();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDropdown();
      }
    };

    positionMenu();
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [closeDropdown, open]);

  if ((!isConnected || !address) && !emailWallet.wallet) {
    return (
      <>
        <div className="flex items-center gap-2">
          <GlassButton
            variant="ghost"
            disabled={isPending}
            onClick={() => {
              if (connectors.length === 0) {
                showToast("error", "No wallet detected. Please install MetaMask or another Web3 extension.");
                return;
              }
              const connector = connectors[0];
              if (connector) {
                connect({ connector });
              }
            }}
          >
            <Wallet className="h-4 w-4" />
            Connect Wallet
          </GlassButton>
          <GlassButton
            variant="ghost"
            onClick={() => setEmailWalletOpen(true)}
          >
            <Mail className="h-4 w-4" />
            Sign in
          </GlassButton>
        </div>
        <CircleEmailWalletDialog
          open={emailWalletOpen}
          onClose={() => setEmailWalletOpen(false)}
          onWalletReady={handleEmailWalletReady}
        />
      </>
    );
  }

  if (!activeAddress) return null;

  return (
    <div ref={triggerRef} className="relative">
      <CircleEmailWalletDialog
        open={emailWalletOpen}
        onClose={() => setEmailWalletOpen(false)}
        onWalletReady={(wallet, auth) => {
          emailWallet.setSession(wallet, auth);
          setEmailWalletOpen(false);
        }}
      />
      <GlassButton
        variant="ghost"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className="font-mono"
      >
        {primaryDomain || truncateAddress(activeAddress)}
        <ChevronDown className="h-4 w-4" />
      </GlassButton>

      {typeof document !== "undefined" && open && menuPosition
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="fixed z-[1100] w-[260px] rounded-lg border border-white/10 bg-[#090b0d]/98 p-2 shadow-[0_16px_60px_rgba(0,0,0,0.75)] backdrop-blur-2xl"
              style={{
                top: menuPosition.top,
                left: menuPosition.left,
              }}
            >
              <div className="border-b border-white/[0.08] px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase text-white/35">
                  {emailWallet.wallet && !isConnected ? "Email wallet" : "Connected wallet"}
                </p>
                {primaryDomain ? (
                  <div className="mt-1 flex flex-col">
                    <span className="text-sm font-semibold text-white">{primaryDomain}</span>
                    <span className="font-mono text-[10px] text-white/50">
                      {truncateAddress(activeAddress)}
                    </span>
                  </div>
                ) : (
                  <p className="mt-1 font-mono text-xs text-white/75">
                    {truncateAddress(activeAddress)}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(activeAddress);
                  setCopied(true);
                  showToast("success", "Wallet address copied");
                  window.setTimeout(() => setCopied(false), 1600);
                }}
                className="mt-1 flex w-full touch-manipulation items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm text-white/70 transition hover:bg-white/[0.07] hover:text-white"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-200" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copied ? "Copied" : "Copy wallet address"}
              </button>
              <a
                href={`https://testnet.arcscan.app/address/${activeAddress}`}
                target="_blank"
                rel="noreferrer"
                className="flex w-full touch-manipulation items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm text-white/70 transition hover:bg-white/[0.07] hover:text-white"
                onClick={() => setOpen(false)}
              >
                <ExternalLink className="h-4 w-4" />
                View wallet on ArcScan
              </a>
              <button
                type="button"
                onClick={() => {
                  if (isConnected) {
                    disconnect();
                  }
                  emailWallet.clearSession();
                  setOpen(false);
                }}
                className="mt-1 flex w-full touch-manipulation items-center gap-2 rounded-md border border-red-400/15 bg-red-400/[0.06] px-3 py-2.5 text-left text-sm font-medium text-red-300 transition hover:bg-red-400/12 hover:text-red-200"
              >
                <LogOut className="h-4 w-4" />
                Disconnect
              </button>
              {!emailWallet.wallet ? (
                <button
                  type="button"
                  onClick={() => {
                    setEmailWalletOpen(true);
                    setOpen(false);
                  }}
                  className="mt-1 flex w-full touch-manipulation items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm text-white/70 transition hover:bg-white/[0.07] hover:text-white"
                >
                  <Mail className="h-4 w-4" />
                  Sign in
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
