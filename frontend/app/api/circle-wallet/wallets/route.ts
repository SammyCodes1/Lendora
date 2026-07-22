import { NextResponse } from "next/server";
import {
  CIRCLE_WALLET_BLOCKCHAIN,
  circleErrorDetails,
  circleWalletClient,
  normalizeCircleWallet,
} from "@/lib/circleWalletsServer";
import { enforceRateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, {
    scope: "circle-wallets",
    limit: 30,
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

    const response = await circleWalletClient().listWallets({
      userToken,
      blockchain: CIRCLE_WALLET_BLOCKCHAIN,
    });
    const wallets = (response.data?.wallets ?? [])
      .map(normalizeCircleWallet)
      .filter((wallet) => wallet.id && wallet.address);

    return NextResponse.json({ wallets });
  } catch (error) {
    const details = circleErrorDetails(error);
    return NextResponse.json(details, { status: 500 });
  }
}
