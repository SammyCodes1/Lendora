import { NextResponse } from "next/server";
import { parseUnits } from "viem";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { fetchTowerQuote, TowerApiError } from "@/lib/server/towerClient";
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
    scope: "tower-quote",
    limit: 40,
    windowMs: 60_000,
  });
  if (limited) return limited;

  try {
    const body = (await request.json()) as {
      tokenIn?: unknown;
      tokenOut?: unknown;
      amountIn?: unknown;
      slippageBps?: unknown;
    };
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
    if (typeof body.amountIn !== "string" || !body.amountIn.trim()) {
      return NextResponse.json(
        { error: "Enter a swap amount." },
        { status: 400 },
      );
    }
    const tokenIn = ARC_DEX_TOKENS[body.tokenIn];
    const tokenOut = ARC_DEX_TOKENS[body.tokenOut];
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
    const quote = await fetchTowerQuote({
      tokenIn: body.tokenIn,
      tokenOut: body.tokenOut,
      inputAmount: inputAmount.toString(),
      slippageBps,
    });
    return NextResponse.json({
      quote,
      output: quote.outputAmount,
      minOut: quote.minOut,
      router: quote.dexName,
      routeLabel: towerRouteLabel(quote),
      tokenIn: {
        symbol: body.tokenIn,
        address: tokenIn.address,
        decimals: tokenIn.decimals,
      },
      tokenOut: {
        symbol: body.tokenOut,
        address: tokenOut.address,
        decimals: tokenOut.decimals,
      },
    });
  } catch (error) {
    if (error instanceof TowerApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not quote this Tower swap.",
      },
      { status: 400 },
    );
  }
}
