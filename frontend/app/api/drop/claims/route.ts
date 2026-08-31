import { NextResponse } from "next/server";
import { isAddress, type Address } from "viem";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import {
  dropContractsToTry,
  fetchDropClaims,
  getArcDropAddress,
} from "@/lib/server/dropClaims";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/drop/claims?dropId=123
 *
 * Returns wallets that claimed a drop, from on-chain DropClaimed events.
 */
export async function GET(request: Request) {
  const limited = enforceRateLimit(request, {
    scope: "arcdrop-list-claims",
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  if (!getArcDropAddress()) {
    return NextResponse.json(
      { error: "Lendrop contract not deployed yet." },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const dropIdRaw = url.searchParams.get("dropId");
  const dropId = dropIdRaw ? parseInt(dropIdRaw, 10) : NaN;
  if (!Number.isInteger(dropId) || dropId < 1) {
    return NextResponse.json(
      { error: "A valid drop ID is required." },
      { status: 400 },
    );
  }

  const requested = url.searchParams.get("contract");
  const known = dropContractsToTry(requested);
  const contract = (
    requested && isAddress(requested)
      ? known.find((item) => item.toLowerCase() === requested.toLowerCase())
      : getArcDropAddress()
  ) as Address | undefined;

  try {
    const claims = await fetchDropClaims(dropId, contract);
    return NextResponse.json({ dropId, claims });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load claimants.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
