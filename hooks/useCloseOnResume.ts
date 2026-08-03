"use client";

import { useEffect } from "react";

/**
 * Closes UI that would otherwise stick after wallet popups / backgrounding.
 * In-app browser wallets (MetaMask, Coinbase, etc.) freeze the page; on return
 * open dropdowns and scroll locks often keep blocking the navbar.
 *
 * Intentionally does NOT listen to window "focus" — that fires during normal
 * clicks and can close menus the moment they open.
 */
export function useCloseOnResume(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const close = () => onClose();

    const onVisibility = () => {
      // Close when the tab is hidden (wallet sheet) and again when visible
      // so any half-mounted portal is torn down on resume.
      close();
    };

    const onPageShow = (event: PageTransitionEvent) => {
      // bfcache restores often leave stale overlays.
      if (event.persisted) close();
      close();
    };

    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pagehide", close);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("pagehide", close);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, onClose]);
}

/** Force-clear body / html scroll locks left by modals or drawers. */
export function releaseScrollLocks() {
  if (typeof document === "undefined") return;
  document.body.style.overflow = "";
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.width = "";
  document.documentElement.style.overflow = "";
}
