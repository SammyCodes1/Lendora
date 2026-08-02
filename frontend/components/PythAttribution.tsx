"use client";

/**
 * Small attribution badge for Pyth Network price feeds.
 * Rendered near market data displays so hackathon judges can see
 * that ArcLend uses real, first-party-sourced oracle data.
 */
export function PythAttribution() {
  return (
    <a
      href="https://pyth.network"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white/80"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="currentColor"
        viewBox="0 0 32.3 41"
        width="12"
        height="12"
        className="opacity-60"
      >
        <path d="M20 16.513a4 4 0 0 1-4 4.003v4.003c4.418 0 8-3.584 8-8.006 0-4.42-3.582-8.006-8-8.006a8 8 0 0 0-8 8.006v20.015l3.596 3.6.404.403V16.513a4 4 0 0 1 4-4.003c2.209 0 4 1.793 4 4.003" />
        <path d="M16 .502c-2.915 0-5.646.78-8 2.144a16 16 0 0 0-4 3.278c-2.49 2.823-4 6.53-4 10.59v12.009l4 4.003V16.514c0-3.556 1.545-6.751 4-8.951a11.98 11.98 0 0 1 8-3.058c6.627 0 12 5.377 12 12.009s-5.373 12.009-12 12.009v4.003c8.838 0 16-7.17 16-16.012S24.838.502 16 .502" />
      </svg>
      Prices by Pyth Network
    </a>
  );
}
