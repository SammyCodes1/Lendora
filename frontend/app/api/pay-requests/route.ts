import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import {
  isPayRequestAsset,
  parseExpiresInSeconds,
  parsePayAmount,
} from "@/lib/payRequest";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import {
  createStoredPayRequest,
  listWalletPayRequests,
} from "@/lib/server/payRequests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limited = enforceRateLimit(request, {
    scope: "pay-requests-list",
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const wallet = new URL(request.url).searchParams.get("wallet");
  if (!wallet || !isAddress(wallet)) {
    return NextResponse.json({ error: "A valid wallet is required." }, { status: 400 });
  }

  const requests = await listWalletPayRequests(getAddress(wallet));
  return NextResponse.json({ requests });
}

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, {
    scope: "pay-requests-create",
    limit: 12,
    windowMs: 60_000,
  });
  if (limited) return limited;

  try {
    const body = (await request.json()) as {
      wallet?: unknown;
      asset?: unknown;
      amount?: unknown;
      memo?: unknown;
      expiresInSeconds?: unknown;
      domain?: unknown;
    };
    if (typeof body.wallet !== "string" || !isAddress(body.wallet)) {
      return NextResponse.json(
        { error: "Connect your wallet to create a request." },
        { status: 400 },
      );
    }
    if (!isPayRequestAsset(body.asset)) {
      return NextResponse.json(
        { error: "Requests currently support USDC and EURC." },
        { status: 400 },
      );
    }
    if (typeof body.amount !== "string" || !parsePayAmount(body.amount)) {
      return NextResponse.json(
        { error: "Enter a valid amount." },
        { status: 400 },
      );
    }
    const expiresInSeconds = parseExpiresInSeconds(body.expiresInSeconds);
    const created = await createStoredPayRequest({
      createdBy: body.wallet,
      asset: body.asset,
      amount: body.amount,
      memo: typeof body.memo === "string" ? body.memo : undefined,
      expiresInSeconds,
      domain: typeof body.domain === "string" ? body.domain : undefined,
    });
    return NextResponse.json({
      request: created.request,
      path: created.urlPath,
      manageToken: created.manageToken,
      stored: created.stored,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not create that request.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
