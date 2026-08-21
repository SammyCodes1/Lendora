import { NextResponse } from "next/server";
import { isStoredPayRequestId } from "@/lib/payRequest";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import {
  cancelStoredPayRequest,
  getPublicPayRequest,
  markPayRequestPaid,
} from "@/lib/server/payRequests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = enforceRateLimit(request, {
    scope: "pay-requests-get",
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { id } = await params;
  if (!isStoredPayRequestId(id)) {
    return NextResponse.json({ error: "Invalid request id." }, { status: 400 });
  }
  const payRequest = await getPublicPayRequest(id);
  if (!payRequest) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }
  return NextResponse.json({ request: payRequest });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = enforceRateLimit(request, {
    scope: "pay-requests-update",
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { id } = await params;
  if (!isStoredPayRequestId(id)) {
    return NextResponse.json({ error: "Invalid request id." }, { status: 400 });
  }

  try {
    const body = (await request.json()) as {
      action?: unknown;
      manageToken?: unknown;
      txHash?: unknown;
      payer?: unknown;
    };
    if (body.action === "cancel") {
      if (typeof body.manageToken !== "string") {
        return NextResponse.json(
          { error: "A manage token is required to cancel." },
          { status: 400 },
        );
      }
      const payRequest = await cancelStoredPayRequest(id, body.manageToken);
      return NextResponse.json({ request: payRequest });
    }
    if (body.action === "paid") {
      if (typeof body.txHash !== "string" || typeof body.payer !== "string") {
        return NextResponse.json(
          { error: "Transaction hash and payer are required." },
          { status: 400 },
        );
      }
      const payRequest = await markPayRequestPaid({
        id,
        txHash: body.txHash,
        payer: body.payer,
      });
      return NextResponse.json({ request: payRequest });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not update that request.";
    const status =
      message.includes("not found") ? 404 : message.includes("cannot cancel") ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
