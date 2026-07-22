"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Droplets, Menu, UserRound, X } from "lucide-react";
import { useState, useCallback } from "react";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import { NetworkSwitcher } from "@/components/wallet/NetworkSwitcher";
import { AssetBalanceChips } from "@/components/wallet/AssetBalanceChips";
import { useDismissibleDropdown } from "@/hooks/useDismissibleDropdown";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import { cn } from "@/lib/utils";

const UnifiedBalanceChip = dynamic(
  () => import("@/components/features/UnifiedBalance").then((module) => module.UnifiedBalanceChip),
  { ssr: false },
);



type LinkItem = {
  href?: string;
  label: string;
  disabled?: boolean;
  sublinks?: { href: string; label: string; disabled?: boolean }[];
};

const links: LinkItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/lend", label: "Lend" },
  { href: "/earn", label: "Earn" },
  { href: "/borrow", label: "Borrow" },
  { href: "/positions", label: "Positions" },
  { href: "/swap", label: "Swap" },
  {
    label: "More",
    sublinks: [
      { href: "/referrals", label: "Referrals", disabled: true },
      { href: "/bridge", label: "Bridge" },
      { href: "/predictions", label: "Predictions" },
      { href: "/liquidate", label: "Liquidate" },
      { href: "/domains", label: "Domain Mints" },
    ],
  },
];

function ArcLogo() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/arclend-logo.png" alt="ArcLend" width={28} height={28} className="h-7 w-7 object-contain" />
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const closeDropdown = useCallback(() => setOpenDropdown(null), []);
  const containerRef = useDismissibleDropdown(openDropdown !== null, closeDropdown);

  const toggleDropdown = (label: string) => {
    setOpenDropdown(openDropdown === label ? null : label);
  };

  return (
    <>
      {links.map((link) => {
        if (link.sublinks) {
          const isActive = link.sublinks.some(sub => pathname === sub.href);
          const isOpen = openDropdown === link.label;
          return (
            <div key={link.label} className="relative" ref={isOpen ? containerRef : undefined}>
              <button
                onClick={() => toggleDropdown(link.label)}
                className={cn(
                  "flex w-full xl:w-auto items-center justify-between xl:justify-start gap-1 rounded-xl px-3 py-2 text-sm transition text-white/50 hover:bg-white/[0.055] hover:text-white",
                  isActive && "text-white"
                )}
              >
                {link.label}
                <ChevronDown className={cn("h-4 w-4 opacity-50 transition-transform", isOpen && "rotate-180")} />
              </button>
              
              {isOpen && (
                <div className="xl:absolute xl:left-0 xl:top-full z-50 mt-2 flex xl:w-48 flex-col rounded-xl xl:border xl:border-white/10 xl:bg-black/80 p-1.5 xl:shadow-[0_24px_70px_rgba(0,0,0,0.7)] xl:backdrop-blur-3xl pl-6 xl:pl-1.5">
                  {link.sublinks.map((sublink) => {
                    const isSubActive = pathname === sublink.href;
                    if (sublink.disabled) {
                      return (
                        <span
                          key={sublink.href}
                          className="flex cursor-not-allowed items-center justify-between rounded-lg px-3 py-2 text-sm text-white/25 select-none"
                          aria-disabled="true"
                        >
                          {sublink.label}
                          <span className="rounded-full border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-white/30">
                            Soon
                          </span>
                        </span>
                      );
                    }
                    return (
                      <Link
                        key={sublink.href}
                        href={sublink.href}
                        onClick={() => {
                          setOpenDropdown(null);
                          if (onNavigate) onNavigate();
                        }}
                        className={cn(
                          "rounded-lg px-3 py-2 text-sm transition hover:bg-white/[0.07] text-white/60 hover:text-white",
                          isSubActive && "xl:bg-white/[0.07] text-white font-medium"
                        )}
                      >
                        {sublink.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        }

        const active = pathname === link.href;

        return (
          <Link
            key={link.href!}
            href={link.href!}
            onClick={onNavigate}
            className={cn(
              "group relative block xl:inline-block w-full xl:w-auto rounded-xl px-3 py-2 text-sm font-medium text-white/50 transition hover:bg-white/[0.055] hover:text-white",
              active && "bg-white/[0.07] text-white",
            )}
          >
            {link.label}
            {active ? <motion.span layoutId="navbar-underline" className="absolute inset-x-3 bottom-0 hidden h-px bg-white/85 shadow-[0_0_14px_rgba(255,255,255,0.45)] xl:block" /> : null}
            {!active ? (
              <motion.span
                className="absolute inset-x-2 -bottom-1 h-px origin-left scale-x-0 bg-white/40 transition-transform duration-200 group-hover:scale-x-100 hidden xl:block"
              />
            ) : null}
          </Link>
        );
      })}
    </>
  );
}

export function Navbar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { isConnected } = useArcLendAccount();

  const profileLink = isConnected ? (
    <Link
      href="/profile"
      aria-label="Open wallet profile"
      title="Wallet profile"
      onClick={() => setOpen(false)}
      className={cn(
        "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.045] text-white/55 transition hover:border-white/20 hover:bg-white/[0.075] hover:text-white",
        pathname === "/profile" && "border-white/25 bg-white/[0.09] text-white",
      )}
    >
      <UserRound className="h-4 w-4" />
    </Link>
  ) : null;

  const faucetLink = (
    <a
      href="https://faucet.circle.com"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open Circle faucet"
      title="Circle faucet"
      onClick={() => setOpen(false)}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.045] text-white/55 transition hover:border-white/20 hover:bg-white/[0.075] hover:text-white"
    >
      <Droplets className="h-4 w-4" />
    </a>
  );

  return (
    <header className="fixed left-0 right-0 top-0 z-[80] overflow-visible border-b border-white/[0.08] bg-black/65 shadow-[0_18px_60px_rgba(0,0,0,0.42),inset_0_-1px_0_rgba(255,255,255,0.025)] backdrop-blur-3xl">
      <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex items-center gap-3 text-white xl:-translate-x-4"
        >
          <div className="flex items-center justify-center">
            <ArcLogo />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-base font-semibold tracking-tight">ArcLend</p>
            </div>
            <p className="text-[10px] font-medium uppercase text-white/35">Stablecoin credit</p>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 xl:flex">
          <NavLinks />
        </nav>

        <div className="hidden items-center gap-3 xl:flex">
          <div className="shrink-0">
            <UnifiedBalanceChip />
          </div>
          <AssetBalanceChips />
          <NetworkSwitcher />
          <ConnectWalletButton />
          {faucetLink}
          {profileLink}
        </div>

        <div className="flex items-center gap-2 xl:hidden">
          <UnifiedBalanceChip />
          {faucetLink}
          <button
            type="button"
            aria-label="Toggle navigation menu"
            onClick={() => setOpen((value) => !value)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.045] text-white"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 top-[72px] bg-black/70 backdrop-blur-sm xl:hidden"
            onClick={() => setOpen(false)}
          >
            <motion.nav
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.24, ease: "easeOut" }}
              onClick={(event) => event.stopPropagation()}
              className="ml-auto flex h-[calc(100vh-72px)] w-[82vw] max-w-sm flex-col gap-3 border-l border-white/10 bg-black/90 px-5 py-6 shadow-[0_0_80px_rgba(0,0,0,0.78)] backdrop-blur-3xl"
            >
              <NavLinks onNavigate={() => setOpen(false)} />
              <div className="flex flex-col gap-3 pt-2">
                <AssetBalanceChips mobile />
                <NetworkSwitcher mobile />
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <ConnectWalletButton />
                  </div>
                  {profileLink}
                </div>
              </div>
            </motion.nav>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
