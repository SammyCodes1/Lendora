import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { resolvePayDomain } from "@/lib/server/payRequests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limited = enforceRateLimit(request, {
    scope: "pay-resolve",
    limit: 40,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const name = new URL(request.url).searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "A .lendora name is required." }, { status: 400 });
  }
  const resolved = await resolvePayDomain(name);
  if (!resolved) {
    return NextResponse.json({ error: "Unregistered .lendora name." }, { status: 404 });
  }
  return NextResponse.json({
    address: resolved.address,
    domain: resolved.domain,
  });
}
