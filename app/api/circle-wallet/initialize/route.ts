import { NextResponse } from "next/server";
import type { AccountType } from "@circle-fin/user-controlled-wallets";
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

async function createUserWithWallets(userToken: string, accountType: AccountType) {
  const response = await circleWalletClient().createUserPinWithWallets({
    userToken,
    blockchains: [CIRCLE_WALLET_BLOCKCHAIN],
    accountType,
    idempotencyKey: crypto.randomUUID(),
  });

  return {
    challengeId: response.data?.challengeId,
    wallets: [],
  };
}

async function createAdditionalArcWallet(userToken: string, accountType = CIRCLE_WALLET_ACCOUNT_TYPE) {
  const response = await circleWalletClient().createWallet({
    userToken,
    blockchains: [CIRCLE_WALLET_BLOCKCHAIN],
    accountType,
    idempotencyKey: crypto.randomUUID(),
  });

  return {
    challengeId: response.data?.challengeId,
    wallets: [],
  };
}

function shouldRetryAsEoa(error: unknown) {
  if (CIRCLE_WALLET_ACCOUNT_TYPE !== "SCA") return false;
  const details = circleErrorDetails(error);
  const message = (details.message ?? "").toLowerCase();
  return (
    message.includes("sca") ||
    message.includes("account type") ||
    message.includes("not support") ||
    message.includes("unsupported")
  );
}

async function initializeArcWallet(userToken: string) {
  try {
    return await createUserWithWallets(userToken, CIRCLE_WALLET_ACCOUNT_TYPE);
  } catch (error) {
    if (shouldRetryAsEoa(error)) {
      return await createUserWithWallets(userToken, "EOA" as AccountType);
    }
    throw error;
  }
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
      return NextResponse.json(await initializeArcWallet(userToken));
    } catch (error) {
      const details = circleErrorDetails(error);
      if (details.code === 155106) {
        const wallets = await listArcWallets(userToken);
        if (wallets.length > 0) {
          return NextResponse.json({ alreadyInitialized: true, wallets });
        }
        try {
          return NextResponse.json(await createAdditionalArcWallet(userToken));
        } catch (createError) {
          if (shouldRetryAsEoa(createError)) {
            return NextResponse.json(
              await createAdditionalArcWallet(userToken, "EOA" as AccountType),
            );
          }
          throw createError;
        }
      }
      throw error;
    }
  } catch (error) {
    const details = circleErrorDetails(error);
    console.error("Circle initialize failed", details);
    const status = details.code === 401 ? 401 : 500;
    if (details.code === 401) {
      details.message =
        "Circle API key is invalid or expired. Please check your CIRCLE_API_KEY environment variable.";
    }
    return NextResponse.json(details, { status });
  }
}
