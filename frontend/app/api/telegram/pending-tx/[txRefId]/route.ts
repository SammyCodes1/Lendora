import { NextResponse } from "next/server";
import { getRedis } from "@/lib/server/redis";
import { verifyTelegramInitData } from "@/lib/server/telegramAuth";
import type { ValidatedAgentAction } from "@/lib/agentTypes";

export const runtime = "nodejs";

type PendingTransaction = {
  validatedAction: ValidatedAgentAction;
  telegramUserId: number;
  createdAt: number;
  expiresAt: number;
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ txRefId: string }> },
) {
  const { txRefId } = await params;
  if (!txRefId || txRefId.length > 128) {
    return NextResponse.json({ error: "Invalid txRefId" }, { status: 400 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
  const initData = request.headers.get("x-telegram-initdata");
  if (!initData) {
    return NextResponse.json(
      { error: "Missing initData" },
      { status: 401 },
    );
  }

  const verification = verifyTelegramInitData(initData, botToken);
  if (!verification.valid) {
    return NextResponse.json(
      { error: verification.reason },
      { status: 401 },
    );
  }

  const redis = getRedis();
  const pending = await redis.get<PendingTransaction>(`pendingtx:${txRefId}`);
  if (!pending) {
    return NextResponse.json(
      { error: "Transaction not found or expired" },
      { status: 404 },
    );
  }

  if (pending.telegramUserId !== verification.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (pending.expiresAt < Date.now()) {
    await redis.del(`pendingtx:${txRefId}`);
    return NextResponse.json(
      { error: "Transaction expired" },
      { status: 410 },
    );
  }

  return NextResponse.json({
    validatedAction: pending.validatedAction,
    expiresAt: pending.expiresAt,
  });
}
