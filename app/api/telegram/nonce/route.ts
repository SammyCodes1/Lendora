import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getRedis } from "@/lib/server/redis";
import { verifyTelegramInitData } from "@/lib/server/telegramAuth";

export const runtime = "nodejs";

const NONCE_TTL_SECONDS = 5 * 60;

export async function POST(request: Request) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
  let body: { initData?: unknown };
  try {
    body = (await request.json()) as { initData?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (typeof body.initData !== "string") {
    return NextResponse.json(
      { error: "initData is required" },
      { status: 400 },
    );
  }

  const verification = verifyTelegramInitData(body.initData, botToken);
  if (!verification.valid) {
    return NextResponse.json(
      { error: verification.reason },
      { status: 401 },
    );
  }

  const nonce = randomUUID();
  const redis = getRedis();
  await redis.set(
    `telegram:${verification.user.id}:nonce`,
    nonce,
    { ex: NONCE_TTL_SECONDS },
  );

  return NextResponse.json({ nonce });
}
