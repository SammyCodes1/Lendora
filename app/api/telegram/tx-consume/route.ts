import { NextResponse } from "next/server";
import { getRedis } from "@/lib/server/redis";
import { verifyTelegramInitData } from "@/lib/server/telegramAuth";

export const runtime = "nodejs";

type PendingTransaction = {
  telegramUserId: number;
};

export async function POST(request: Request) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
  let body: { initData?: unknown; txRefId?: unknown };
  try {
    body = (await request.json()) as {
      initData?: unknown;
      txRefId?: unknown;
    };
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (typeof body.initData !== "string" || typeof body.txRefId !== "string") {
    return NextResponse.json(
      { error: "initData and txRefId are required" },
      { status: 400 },
    );
  }
  if (body.txRefId.length > 128) {
    return NextResponse.json({ error: "Invalid txRefId" }, { status: 400 });
  }

  const verification = verifyTelegramInitData(body.initData, botToken);
  if (!verification.valid) {
    return NextResponse.json(
      { error: verification.reason },
      { status: 401 },
    );
  }

  const redis = getRedis();
  const key = `pendingtx:${body.txRefId}`;
  const pending = await redis.get<PendingTransaction>(key);
  if (!pending) {
    return NextResponse.json(
      { error: "Transaction not found or already consumed" },
      { status: 404 },
    );
  }

  if (pending.telegramUserId !== verification.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Consuming deletes the reference so the same tx cannot be signed twice.
  await redis.del(key);
  return NextResponse.json({ ok: true });
}
