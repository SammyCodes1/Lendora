import "server-only";

import { NextResponse } from "next/server";

/**
 * Verifies the shared-secret header the Telegram bot sends on API calls.
 * Returns null when auth passes, or a 401 NextResponse when it fails.
 * The web client does not send x-api-key, so callers must treat an absent
 * header as "not a bot request" and skip this check.
 */
export function verifyBotAuth(request: Request): NextResponse | null {
  const apiKey = request.headers.get("x-api-key");
  if (apiKey === null) return null;
  if (apiKey !== (process.env.BOT_API_KEY ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
