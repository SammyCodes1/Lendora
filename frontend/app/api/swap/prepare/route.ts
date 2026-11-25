import { NextResponse } from "next/server";
import { getAddress, isAddress, parseUnits } from "viem";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { prepareTowerSwap, TowerApiError } from "@/lib/server/towerClient";
import { fetchPeachSwap, PeachApiError } from "@/lib/server/peachClient";
import {
  isSupportedTowerPair,
  isSwapTokenSymbol,
  parseSlippageBps,
  towerRouteLabel,
} from "@/lib/towerSwap";
import { ARC_DEX_TOKENS } from "@/lib/arcDex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, {
    scope: "tower-prepare",
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) return limited;

  try {
    const body = (await request.json()) as {
      tokenIn?: unknown;
      tokenOut?: unknown;
      amountIn?: unknown;
      slippageBps?: unknown;
      userAddress?: unknown;
      route?: unknown;
      acceptedMinOut?: unknown;
    };
    const route = body.route === undefined ? "tower" : body.route;
    if (route !== "tower" && route !== "peach") {
      return NextResponse.json(
        { error: "Choose the Tower or Peach route." },
        { status: 400 },
      );
    }
    if (!isSwapTokenSymbol(body.tokenIn) || !isSwapTokenSymbol(body.tokenOut)) {
      return NextResponse.json(
        { error: "Choose two supported Arc tokens to swap." },
        { status: 400 },
      );
    }
    if (!isSupportedTowerPair(body.tokenIn, body.tokenOut)) {
      return NextResponse.json(
        { error: "Swap assets must be different." },
        { status: 400 },
      );
    }
    if (typeof body.userAddress !== "string" || !isAddress(body.userAddress)) {
      return NextResponse.json(
        { error: "Connect a valid wallet before swapping." },
        { status: 400 },
      );
    }
    if (typeof body.amountIn !== "string" || !body.amountIn.trim()) {
      return NextResponse.json(
        { error: "Enter a swap amount." },
        { status: 400 },
      );
    }
    const tokenIn = ARC_DEX_TOKENS[body.tokenIn];
    let inputAmount: bigint;
    try {
      inputAmount = parseUnits(body.amountIn.trim(), tokenIn.decimals);
    } catch {
      return NextResponse.json(
        { error: "That swap amount is not valid." },
        { status: 400 },
      );
    }
    if (inputAmount <= 0n) {
      return NextResponse.json(
        { error: "Swap amount must be greater than zero." },
        { status: 400 },
      );
    }
    const slippageBps = parseSlippageBps(body.slippageBps ?? 50);
    if (route === "peach") {
      // Peach quotes are signed transactions. A refreshed plan is only
      // returned when it guarantees at least what the user confirmed;
      // otherwise the user must review and confirm the new terms.
      if (typeof body.acceptedMinOut !== "string" || !/^[0-9]+$/.test(body.acceptedMinOut)) {
        return NextResponse.json(
          { error: "Confirm a Peach quote before preparing the swap." },
          { status: 400 },
        );
      }
      const peach = await fetchPeachSwap({
        tokenIn: body.tokenIn,
        tokenOut: body.tokenOut,
        inputAmount: inputAmount.toString(),
        slippageBps,
        userAddress: getAddress(body.userAddress),
      });
      if (BigInt(peach.minOut) < BigInt(body.acceptedMinOut)) {
        return NextResponse.json(
          {
            error: "The Peach price moved below the minimum you confirmed. Review and confirm the new quote.",
            requoteRequired: true,
            peach,
          },
          { status: 409 },
        );
      }
      return NextResponse.json({ route: "peach", peach });
    }
    const prepared = await prepareTowerSwap({
      tokenIn: body.tokenIn,
      tokenOut: body.tokenOut,
      inputAmount: inputAmount.toString(),
      slippageBps,
      userAddress: getAddress(body.userAddress),
    });
    return NextResponse.json({
      route: "tower",
      ...prepared,
      routeLabel: towerRouteLabel(prepared.quote),
    });
  } catch (error) {
    if (error instanceof TowerApiError || error instanceof PeachApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not build this Tower swap transaction.",
      },
      { status: 400 },
    );
  }
}
