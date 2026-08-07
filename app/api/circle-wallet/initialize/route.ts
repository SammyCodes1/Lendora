import { NextResponse } from "next/server";
import {
  CIRCLE_WALLET_ACCOUNT_TYPE,
  CIRCLE_WALLET_BLOCKCHAIN,
  circleErrorDetails,
  circleWalletClient,
  normalizeCircleWallet,
} from "@/lib/circleWalletsServer";
import { enforceRateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function listArcWallets(userToken: string) {
  const response = await circleWalletClient().listWallets({
    userToken,
    blockchain: CIRCLE_WALLET_BLOCKCHAIN,
  });

  return (response.data?.wallets ?? [])
    .map(normalizeCircleWallet)
    .filter((wallet) => wallet.id && wallet.address);
}

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, {
    scope: "circle-initialize",
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) return limited;

  try {
    const body = (await request.json()) as { userToken?: string };
    const userToken = body.userToken?.trim();

    if (!userToken) {
      return NextResponse.json(
        { error: "Missing Circle user token." },
        { status: 400 },
      );
    }

    try {
      const response = await circleWalletClient().createUserPinWithWallets({
        userToken,
        blockchains: [CIRCLE_WALLET_BLOCKCHAIN],
        accountType: CIRCLE_WALLET_ACCOUNT_TYPE,
        idempotencyKey: crypto.randomUUID(),
      });

      return NextResponse.json({
        challengeId: response.data?.challengeId,
        wallets: [],
      });
    } catch (error) {
      const details = circleErrorDetails(error);
      if (details.code === 155106) {
        return NextResponse.json({
          alreadyInitialized: true,
          wallets: await listArcWallets(userToken),
        });
      }

      throw error;
    }
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
