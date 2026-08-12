import { NextResponse } from "next/server";
import { circleErrorDetails, circleWalletClient } from "@/lib/circleWalletsServer";
import { enforceRateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Creates a Circle device token bound to the given deviceId for social login
 * (Google / Facebook / Apple). The returned deviceToken + deviceEncryptionKey
 * are fed into the W3SSdk `loginConfigs` before calling `performLogin`.
 */
export async function POST(request: Request) {
  const limited = enforceRateLimit(request, {
    scope: "circle-social-token",
    limit: 10,
    windowMs: 10 * 60_000,
  });
  if (limited) return limited;

  try {
    const body = (await request.json()) as { deviceId?: string };
    const deviceId = body.deviceId?.trim();

    if (!deviceId) {
      return NextResponse.json(
        { error: "Missing device ID." },
        { status: 400 },
      );
    }

    const response = await circleWalletClient().createDeviceTokenForSocialLogin({
      deviceId,
      idempotencyKey: crypto.randomUUID(),
    });

    return NextResponse.json({
      deviceToken: response.data?.deviceToken ?? "",
      deviceEncryptionKey: response.data?.deviceEncryptionKey ?? "",
    });
  } catch (error) {
    const details = circleErrorDetails(error);
    const status = details.code === 401 ? 401 : 500;
    if (details.code === 401) {
      details.message =
        "Circle API key is invalid or expired. Please check your CIRCLE_API_KEY environment variable.";
    }
    return NextResponse.json(details, { status });
  }
}
