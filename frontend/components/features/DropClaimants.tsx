"use client";

import { ExternalLink } from "lucide-react";
import {
  ARCSCAN_ADDRESS_BASE,
  ARCSCAN_TX_BASE,
  formatDropAmount,
  truncateDropAddress,
  type DropClaim,
} from "@/lib/arcDrop";

export function DropClaimants({
  claims,
  symbol,
  loading,
  error,
}: {
  claims: DropClaim[];
  symbol?: string;
  loading?: boolean;
  error?: string;
}) {
  if (loading) {
    return (
      <p className="text-xs text-white/40">Loading claimants…</p>
    );
  }

  if (error) {
    return <p className="text-xs text-red-200/70">{error}</p>;
  }

  if (claims.length === 0) {
    return (
      <p className="text-xs text-white/40">No wallets have claimed yet.</p>
    );
  }

  return (
    <ul className="space-y-2">
      {claims.map((claim) => (
        <li
          key={`${claim.txHash}-${claim.claimant}`}
          className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-black/25 px-3 py-2"
        >
          <a
            href={`${ARCSCAN_ADDRESS_BASE}${claim.claimant}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-white/80 hover:text-white"
            title={claim.claimant}
          >
            {truncateDropAddress(claim.claimant)}
          </a>
          <span className="flex items-center gap-2">
            <span className="font-mono text-xs text-emerald-200/80">
              {formatDropAmount(claim.amount)}
              {symbol ? ` ${symbol}` : ""}
            </span>
            {claim.txHash && (
              <a
                href={`${ARCSCAN_TX_BASE}${claim.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="text-white/35 hover:text-white"
                aria-label="View claim transaction"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
