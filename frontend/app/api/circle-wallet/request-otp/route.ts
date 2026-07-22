import { NextResponse } from "next/server";
import { circleErrorDetails, circleWalletClient } from "@/lib/circleWalletsServer";
import { enforceRateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, {
    scope: "circle-otp",
    limit: 5,
    windowMs: 10 * 60_000,
  });
  if (limited) return limited;

  try {
    const body = (await request.json()) as {
      deviceId?: string;
      email?: string;
    };
    const deviceId = body.deviceId?.trim();
    const email = body.email?.trim().toLowerCase();

    if (!deviceId || !email || !emailPattern.test(email)) {
      return NextResponse.json(
        { error: "Enter a valid email address and device ID." },
        { status: 400 },
      );
    }

    const emailLimited = enforceRateLimit(request, {
      scope: "circle-otp-email",
      key: email,
      limit: 3,
      windowMs: 10 * 60_000,
    });
    if (emailLimited) return emailLimited;

    const response = await circleWalletClient().createDeviceTokenForEmailLogin({
      deviceId,
      email,
      idempotencyKey: crypto.randomUUID(),
    });

    return NextResponse.json(response.data ?? {});
  } catch (error) {
    const details = circleErrorDetails(error);
    return NextResponse.json(details, { status: 500 });
  }
}
