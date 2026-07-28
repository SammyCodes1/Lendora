"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { ChevronDown, Droplets, Menu, UserRound, X } from "lucide-react";
import { useState, useCallback, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import { NetworkSwitcher } from "@/components/wallet/NetworkSwitcher";
import { AssetBalanceChips } from "@/components/wallet/AssetBalanceChips";
import { useDismissibleDropdown } from "@/hooks/useDismissibleDropdown";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import {
  releaseScrollLocks,
  useCloseOnResume,
} from "@/hooks/useCloseOnResume";
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
  { href: "/borrow", label: "Borrow" },
  { href: "/positions", label: "Positions" },
  { href: "/swap", label: "Swap" },
  {
    label: "More",
    sublinks: [
      { href: "/earn", label: "Earn" },
      { href: "/referrals", label: "Referrals", disabled: true },
      { href: "/bridge", label: "Bridge" },
      { href: "/predictions", label: "Predictions", disabled: true },
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
      className="pointer-events-none h-7 w-7 object-contain"
      style={{ opacity: 1, visibility: "visible" }}
      draggable={false}
    />
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const closeDropdown = useCallback(() => setOpenDropdown(null), []);
  const containerRef = useDismissibleDropdown(openDropdown !== null, closeDropdown);
  useCloseOnResume(closeDropdown, openDropdown !== null);

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
                  "flex w-full touch-manipulation items-center justify-between gap-1 rounded-xl px-3 py-2.5 text-sm transition text-white/50 hover:bg-white/[0.055] hover:text-white xl:w-auto xl:justify-start xl:py-2",
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
              "group relative block w-full touch-manipulation rounded-xl px-3 py-2.5 text-sm font-medium text-white/50 transition hover:bg-white/[0.055] hover:text-white xl:inline-block xl:w-auto xl:py-2",
              active && "bg-white/[0.07] text-white",
            )}
          >
            {link.label}
            {active ? (
              <span className="absolute inset-x-3 bottom-0 hidden h-px bg-white/85 shadow-[0_0_14px_rgba(255,255,255,0.45)] xl:block" />
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
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const closeMenu = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(false);
    releaseScrollLocks();
  }, []);

  // Defer unmount slightly so Next.js Link can finish the tap.
  const closeMenuDeferred = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
      releaseScrollLocks();
      closeTimerRef.current = null;
    }, 80);
  }, []);

  // Route changes always dismiss + unlock scroll.
  useEffect(() => {
    closeMenu();
  }, [pathname, closeMenu]);

  // Wallet browsers freeze the page; on return, force-close any open drawer.
  useCloseOnResume(closeMenu, true);

  // Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeMenu]);

  // Scroll lock while open — always hard-clear on cleanup.
  useEffect(() => {
    if (!open) {
      releaseScrollLocks();
      return;
    }
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      releaseScrollLocks();
    };
  }, [open]);

  // Close drawer when viewport grows to desktop nav.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const onChange = () => {
      if (mq.matches) closeMenu();
    };
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [closeMenu]);

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      releaseScrollLocks();
    },
    [],
  );

  const toggleMenu = useCallback(() => {
    setOpen((value) => {
      if (value) {
        releaseScrollLocks();
        return false;
      }
      return true;
    });
  }, []);

  const profileLink = isConnected ? (
    <Link
      href="/profile"
      aria-label="Open wallet profile"
      title="Wallet profile"
      prefetch
      onClick={closeMenuDeferred}
      className={cn(
        "inline-flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-lg border border-white/10 bg-white/[0.045] text-white/55 transition hover:border-white/20 hover:bg-white/[0.075] hover:text-white",
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
      className="inline-flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-lg border border-white/10 bg-white/[0.045] text-white/55 transition hover:border-white/20 hover:bg-white/[0.075] hover:text-white"
    >
      <Droplets className="h-4 w-4" />
    </a>
  );

  // No AnimatePresence / exit animations — those leave invisible full-screen
  // hit targets stuck in wallet in-app browsers after backgrounding.
  const mobileMenu =
    mounted && open
      ? createPortal(
          <div
            id={menuId}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            data-mobile-nav-root
            className={cn(
              "fixed inset-x-0 bottom-0 z-[900] xl:hidden",
              MOBILE_BAR_TOP,
            )}
          >
            <button
              type="button"
              aria-label="Close navigation menu"
              className="absolute inset-0 z-0 touch-manipulation border-0 bg-black/70 p-0 backdrop-blur-sm"
              onPointerUp={(event) => {
                event.preventDefault();
                closeMenu();
              }}
              onClick={(event) => {
                event.preventDefault();
                closeMenu();
              }}
            />

            <nav
              className={cn(
                "absolute right-0 top-0 z-10 flex w-[min(88vw,22rem)] max-w-sm flex-col gap-3 overflow-y-auto overscroll-contain border-l border-white/10 bg-black/95 px-4 py-5 shadow-[0_0_80px_rgba(0,0,0,0.78)] backdrop-blur-3xl safe-bottom touch-manipulation sm:px-5 sm:py-6",
                MOBILE_DRAWER_HEIGHT,
              )}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
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
            </nav>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {/*
        High z-index + isolation so residual portal layers from wallet sheets
        cannot permanently steal taps from the bar / icons.
      */}
      <header
        data-arclend-navbar
        className="safe-top pointer-events-auto fixed left-0 right-0 top-0 z-[1000] isolate border-b border-white/[0.08] bg-black/80 shadow-[0_18px_60px_rgba(0,0,0,0.42),inset_0_-1px_0_rgba(255,255,255,0.025)] backdrop-blur-3xl"
      >
        <div className="relative z-[1001] mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-2 px-3 sm:h-[72px] sm:px-6 lg:px-8">
          <Link
            href="/"
            onClick={closeMenuDeferred}
            className="relative z-[1002] flex shrink-0 touch-manipulation items-center gap-2 text-white sm:gap-3"
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

          <nav className="hidden items-center gap-1 xl:flex ml-10">
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

          <div className="relative z-[1002] flex items-center gap-2 xl:hidden">
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
