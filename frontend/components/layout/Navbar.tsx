"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Droplets, Menu, UserRound, X } from "lucide-react";
import { useState, useCallback, useEffect, useId } from "react";
import { createPortal } from "react-dom";
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

/** Matches header: safe-area inset + bar height (h-16 / sm:h-[72px]). */
const MOBILE_BAR_TOP =
  "top-[calc(4rem+env(safe-area-inset-top,0px))] sm:top-[calc(4.5rem+env(safe-area-inset-top,0px))]";
const MOBILE_DRAWER_HEIGHT =
  "h-[calc(100dvh-4rem-env(safe-area-inset-top,0px))] sm:h-[calc(100dvh-4.5rem-env(safe-area-inset-top,0px))]";

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
    <img
      src="/arclend-mark.png"
      alt="ArcLend"
      width={28}
      height={28}
      className="h-7 w-7 object-contain"
      style={{ opacity: 1, visibility: "visible" }}
    />
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const closeDropdown = useCallback(() => setOpenDropdown(null), []);
  const containerRef = useDismissibleDropdown(openDropdown !== null, closeDropdown);

  const toggleDropdown = (label: string) => {
    setOpenDropdown((current) => (current === label ? null : label));
  };

  const handleNavClick = useCallback(() => {
    setOpenDropdown(null);
    onNavigate?.();
  }, [onNavigate]);

  return (
    <>
      {links.map((link) => {
        if (link.sublinks) {
          const isActive = link.sublinks.some((sub) => pathname === sub.href);
          const isOpen = openDropdown === link.label;
          return (
            <div
              key={link.label}
              className="relative"
              ref={isOpen ? containerRef : undefined}
            >
              <button
                type="button"
                onClick={() => toggleDropdown(link.label)}
                className={cn(
                  "flex w-full items-center justify-between gap-1 rounded-xl px-3 py-2.5 text-sm transition text-white/50 hover:bg-white/[0.055] hover:text-white xl:w-auto xl:justify-start xl:py-2",
                  isActive && "text-white",
                )}
              >
                {link.label}
                <ChevronDown
                  className={cn(
                    "h-4 w-4 opacity-50 transition-transform",
                    isOpen && "rotate-180",
                  )}
                />
              </button>

              {isOpen ? (
                <div className="z-50 mt-1 flex flex-col rounded-xl p-1.5 pl-6 xl:absolute xl:left-0 xl:top-full xl:mt-2 xl:w-48 xl:border xl:border-white/10 xl:bg-black/80 xl:pl-1.5 xl:shadow-[0_24px_70px_rgba(0,0,0,0.7)] xl:backdrop-blur-3xl">
                  {link.sublinks.map((sublink) => {
                    const isSubActive = pathname === sublink.href;
                    if (sublink.disabled) {
                      return (
                        <span
                          key={sublink.href}
                          className="flex cursor-not-allowed select-none items-center justify-between rounded-lg px-3 py-2.5 text-sm text-white/25 xl:py-2"
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
                        prefetch
                        onClick={handleNavClick}
                        className={cn(
                          "rounded-lg px-3 py-2.5 text-sm text-white/60 transition hover:bg-white/[0.07] hover:text-white xl:py-2",
                          isSubActive && "font-medium text-white xl:bg-white/[0.07]",
                        )}
                      >
                        {sublink.label}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        }

        const active = pathname === link.href;

        return (
          <Link
            key={link.href!}
            href={link.href!}
            prefetch
            onClick={handleNavClick}
            className={cn(
              "group relative block w-full rounded-xl px-3 py-2.5 text-sm font-medium text-white/50 transition hover:bg-white/[0.055] hover:text-white xl:inline-block xl:w-auto xl:py-2",
              active && "bg-white/[0.07] text-white",
            )}
          >
            {link.label}
            {active ? (
              <motion.span
                layoutId="navbar-underline"
                className="absolute inset-x-3 bottom-0 hidden h-px bg-white/85 shadow-[0_0_14px_rgba(255,255,255,0.45)] xl:block"
              />
            ) : null}
            {!active ? (
              <motion.span className="absolute inset-x-2 -bottom-1 hidden h-px origin-left scale-x-0 bg-white/40 transition-transform duration-200 group-hover:scale-x-100 xl:block" />
            ) : null}
          </Link>
        );
      })}
    </>
  );
}

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const { isConnected } = useArcLendAccount();
  const menuId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close after route changes (primary close path — safe for Link navigation).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Lock background scroll while open; always restore on cleanup.
  useEffect(() => {
    if (!open) return;
    const { body, documentElement } = document;
    const previousBody = body.style.overflow;
    const previousHtml = documentElement.style.overflow;
    body.style.overflow = "hidden";
    documentElement.style.overflow = "hidden";
    return () => {
      body.style.overflow = previousBody;
      documentElement.style.overflow = previousHtml;
    };
  }, [open]);

  /**
   * Defer unmount so Next.js <Link> can finish handling the tap before the
   * drawer (and the link node) are removed. Immediate unmount was canceling
   * navigations intermittently on mobile.
   */
  const closeMenuDeferred = useCallback(() => {
    window.setTimeout(() => setOpen(false), 80);
  }, []);

  const closeMenu = useCallback(() => setOpen(false), []);

  const toggleMenu = useCallback(() => {
    setOpen((value) => !value);
  }, []);

  const profileLink = isConnected ? (
    <Link
      href="/profile"
      aria-label="Open wallet profile"
      title="Wallet profile"
      prefetch
      onClick={closeMenuDeferred}
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
      onClick={closeMenu}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.045] text-white/55 transition hover:border-white/20 hover:bg-white/[0.075] hover:text-white"
    >
      <Droplets className="h-4 w-4" />
    </a>
  );

  const mobileMenu =
    mounted &&
    createPortal(
      <AnimatePresence>
        {open ? (
          <motion.div
            key="mobile-nav-overlay"
            id={menuId}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.16 } }}
            transition={{ duration: 0.18 }}
            className={cn(
              "fixed inset-x-0 bottom-0 z-[90] bg-black/70 backdrop-blur-sm xl:hidden",
              MOBILE_BAR_TOP,
            )}
            onClick={closeMenu}
          >
            <motion.nav
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              className={cn(
                "ml-auto flex w-[min(88vw,22rem)] max-w-sm flex-col gap-3 overflow-y-auto overscroll-contain border-l border-white/10 bg-black/95 px-4 py-5 shadow-[0_0_80px_rgba(0,0,0,0.78)] backdrop-blur-3xl safe-bottom sm:px-5 sm:py-6",
                MOBILE_DRAWER_HEIGHT,
              )}
            >
              <NavLinks onNavigate={closeMenuDeferred} />
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
      </AnimatePresence>,
      document.body,
    );

  return (
    <>
      <header className="safe-top fixed left-0 right-0 top-0 z-[100] border-b border-white/[0.08] bg-black/65 shadow-[0_18px_60px_rgba(0,0,0,0.42),inset_0_-1px_0_rgba(255,255,255,0.025)] backdrop-blur-3xl">
        {/* Bar stays above the drawer overlay so hamburger / logo always receive taps. */}
        <div className="relative z-[110] mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-2 px-3 sm:h-[72px] sm:px-6 lg:px-8">
          <Link
            href="/"
            onClick={closeMenuDeferred}
            className="relative z-[111] flex min-w-0 items-center gap-2 text-white sm:gap-3 xl:-translate-x-4"
          >
            <div className="flex shrink-0 items-center justify-center">
              <ArcLogo />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold tracking-tight sm:text-base">
                  ArcLend
                </p>
              </div>
              <p className="hidden text-[10px] font-medium uppercase text-white/35 sm:block">
                Stablecoin credit
              </p>
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

          <div className="relative z-[111] flex items-center gap-2 xl:hidden">
            <UnifiedBalanceChip />
            {faucetLink}
            <button
              type="button"
              aria-label={open ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={open}
              aria-controls={menuId}
              onClick={toggleMenu}
              className="inline-flex h-11 w-11 touch-manipulation items-center justify-center rounded-md border border-white/10 bg-white/[0.045] text-white"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </header>

      {mobileMenu}
    </>
  );
}
