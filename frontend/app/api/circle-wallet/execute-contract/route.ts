import { getAddress, isAddress } from "viem";
import { NextResponse } from "next/server";
import {
  CIRCLE_WALLET_FEE_LEVEL,
  circleErrorDetails,
  circleWalletClient,
} from "@/lib/circleWalletsServer";
import { enforceRateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExecuteContractBody = {
  userToken?: string;
  walletId?: string;
  contractAddress?: string;
  abiFunctionSignature?: string;
  abiParameters?: unknown[];
  callData?: `0x${string}`;
  amount?: string;
  refId?: string;
};

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, {
    scope: "circle-execute",
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  try {
    const body = (await request.json()) as ExecuteContractBody;
    const userToken = body.userToken?.trim();
    const walletId = body.walletId?.trim();
    const contractAddress = body.contractAddress?.trim();

    if (!userToken || !walletId || !contractAddress || !isAddress(contractAddress)) {
      return NextResponse.json(
        { error: "Missing user token, wallet ID, or contract address." },
        { status: 400 },
      );
    }

    const hasAbiSignature = Boolean(body.abiFunctionSignature?.trim());
    const hasCallData = Boolean(body.callData);
    if (hasAbiSignature === hasCallData) {
      return NextResponse.json(
        { error: "Provide either ABI function signature or callData." },
        { status: 400 },
      );
    }

    const common = {
      userToken,
      walletId,
      contractAddress: getAddress(contractAddress),
      // Circle requires either walletId or walletAddress + blockchain. The
      // Google/social-login flow supplies a walletId, so including blockchain
      // as well makes the request invalid before it reaches the chain.
      ...(body.amount ? { amount: body.amount } : {}),
      refId: body.refId,
      idempotencyKey: crypto.randomUUID(),
      fee: {
        type: "level" as const,
        config: { feeLevel: CIRCLE_WALLET_FEE_LEVEL },
      },
    };

    const response = hasCallData
      ? await circleWalletClient().createUserTransactionContractExecutionChallenge({
          ...common,
          callData: body.callData!,
        })
      : await circleWalletClient().createUserTransactionContractExecutionChallenge({
          ...common,
          abiFunctionSignature: body.abiFunctionSignature!.trim(),
          abiParameters: body.abiParameters ?? [],
        });

    return NextResponse.json({
      challengeId: response.data?.challengeId,
    });
  } catch (error) {
    const details = circleErrorDetails(error);
    return NextResponse.json(details, { status: 500 });
  }
}
