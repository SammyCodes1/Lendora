import { isAddress, recoverMessageAddress } from "viem";
import { NextResponse } from "next/server";
import { getRedis } from "@/lib/server/redis";
import { verifyTelegramInitData } from "@/lib/server/telegramAuth";

export const runtime = "nodejs";

const WALLET_LINK_TTL_SECONDS = 90 * 24 * 60 * 60;

function linkMessage(userId: number, nonce: string) {
  return `Link Telegram account ${userId} to ArcLend wallet\n\nNonce: ${nonce}`;
}

export async function POST(request: Request) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
  let body: {
    initData?: unknown;
    walletAddress?: unknown;
    signature?: unknown;
    nonce?: unknown;
  };
  try {
    body = (await request.json()) as {
      initData?: unknown;
      walletAddress?: unknown;
      signature?: unknown;
      nonce?: unknown;
    };
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (
    typeof body.initData !== "string" ||
    typeof body.walletAddress !== "string" ||
    typeof body.signature !== "string" ||
    typeof body.nonce !== "string"
  ) {
    return NextResponse.json(
      { error: "initData, walletAddress, signature, and nonce are required" },
      { status: 400 },
    );
  }

  // 1. The Telegram identity must be genuine — forged initData has a bad HMAC.
  const verification = verifyTelegramInitData(body.initData, botToken);
  if (!verification.valid) {
    return NextResponse.json(
      { error: verification.reason },
      { status: 401 },
    );
  }

  if (!isAddress(body.walletAddress)) {
    return NextResponse.json(
      { error: "Invalid wallet address" },
      { status: 400 },
    );
  }

  const redis = getRedis();
  const userId = verification.user.id;

  // 2. The nonce is single-use — it proves the linking request is fresh and
  //    cannot be replayed with a captured initData + signature pair.
  const nonceKey = `telegram:${userId}:nonce`;
  const storedNonce = await redis.get<string>(nonceKey);
  if (storedNonce !== body.nonce) {
    return NextResponse.json(
      { error: "Invalid or expired nonce" },
      { status: 401 },
    );
  }
  await redis.del(nonceKey);

  // 3. The wallet must be genuinely controlled by whoever opened the Mini App.
  const message = linkMessage(userId, body.nonce);
  const recovered = await recoverMessageAddress({
    message,
    signature: body.signature as `0x${string}`,
  });
  if (recovered.toLowerCase() !== body.walletAddress.toLowerCase()) {
    return NextResponse.json(
      { error: "Signature does not match the claimed wallet" },
      { status: 401 },
    );
  }

  // 4. Persist the link so the bot can resolve wallet for this Telegram user.
  await redis.set(
    `telegram:${userId}:wallet`,
    body.walletAddress.toLowerCase(),
    { ex: WALLET_LINK_TTL_SECONDS },
  );

  return NextResponse.json({ ok: true });
}

export { linkMessage };
