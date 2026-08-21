import { getAddress, isAddress } from "viem";
import { NextResponse } from "next/server";
import {
  CIRCLE_WALLET_BLOCKCHAIN,
  CIRCLE_WALLET_FEE_LEVEL,
  circleErrorDetails,
  circleWalletClient,
} from "@/lib/circleWalletsServer";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { ARC_DEX_TOKENS } from "@/lib/arcDex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NATIVE_USDC = ARC_DEX_TOKENS.USDC.address.toLowerCase();

type TransferBody = {
  userToken?: string;
  walletId?: string;
  destinationAddress?: string;
  amount?: string;
  tokenAddress?: string;
  refId?: string;
};

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, {
    scope: "circle-transfer",
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  try {
    const body = (await request.json()) as TransferBody;
    const userToken = body.userToken?.trim();
    const walletId = body.walletId?.trim();
    const destinationAddress = body.destinationAddress?.trim();
    const amount = body.amount?.trim();

    if (!userToken || !walletId || !destinationAddress || !isAddress(destinationAddress)) {
      return NextResponse.json(
        { error: "Missing user token, wallet ID, or destination." },
        { status: 400 },
      );
    }
    if (!amount || !/^(0|[1-9]\d*)(\.\d+)?$/.test(amount) || Number(amount) <= 0) {
      return NextResponse.json({ error: "Enter a valid amount." }, { status: 400 });
    }

    const tokenAddress = body.tokenAddress?.trim() ?? "";
    const isNativeUsdc =
      !tokenAddress || tokenAddress.toLowerCase() === NATIVE_USDC;

    const response = await circleWalletClient().createTransaction({
      userToken,
      walletId,
      destinationAddress: getAddress(destinationAddress),
      amounts: [amount],
      blockchain: CIRCLE_WALLET_BLOCKCHAIN,
      tokenAddress: isNativeUsdc ? "" : getAddress(tokenAddress),
      refId: body.refId,
      idempotencyKey: crypto.randomUUID(),
      fee: {
        type: "level",
        config: { feeLevel: CIRCLE_WALLET_FEE_LEVEL },
      },
    });

    return NextResponse.json({
      challengeId: response.data?.challengeId,
    });
  } catch (error) {
    const details = circleErrorDetails(error);
    return NextResponse.json(details, { status: 500 });
  }
}
