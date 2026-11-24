import { NextResponse } from "next/server";
import { getAddress, isAddress, parseUnits } from "viem";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { fetchTowerQuote, TowerApiError } from "@/lib/server/towerClient";
import { fetchPeachSwap, PeachApiError } from "@/lib/server/peachClient";
import {
  fromTowerQuoteAmount,
  isSupportedTowerPair,
  isSwapTokenSymbol,
  parseSlippageBps,
  towerRouteLabel,
} from "@/lib/towerSwap";
import { ARC_DEX_TOKENS } from "@/lib/arcDex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function routeError(reason: unknown, fallback: string) {
  if (reason instanceof TowerApiError || reason instanceof PeachApiError) {
    return { message: reason.message, status: reason.status };
  }
  return {
    message: reason instanceof Error ? reason.message : fallback,
    status: 400,
  };
}

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
      userAddress?: unknown;
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
    const userAddress =
      typeof body.userAddress === "string" && isAddress(body.userAddress)
        ? getAddress(body.userAddress)
        : null;
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

    // Quote both routers in parallel; either may be unconfigured or fail.
    const [towerResult, peachResult] = await Promise.allSettled([
      fetchTowerQuote({
        tokenIn: body.tokenIn,
        tokenOut: body.tokenOut,
        inputAmount: inputAmount.toString(),
        slippageBps,
      }),
      userAddress
        ? fetchPeachSwap({
            tokenIn: body.tokenIn,
            tokenOut: body.tokenOut,
            inputAmount: inputAmount.toString(),
            slippageBps,
            userAddress,
          })
        : Promise.reject(new PeachApiError("Connect a wallet to get a Peach quote.", 400)),
    ]);

    const tower = towerResult.status === "fulfilled" ? towerResult.value : null;
    const peach = peachResult.status === "fulfilled" ? peachResult.value : null;
    const errors: { tower?: string; peach?: string } = {};
    if (towerResult.status === "rejected") {
      errors.tower = routeError(towerResult.reason, "Could not quote this Tower swap.").message;
    }
    if (peachResult.status === "rejected") {
      errors.peach = routeError(peachResult.reason, "Could not quote this Peach swap.").message;
    }

    if (!tower && !peach) {
      const primary = routeError(towerResult.status === "rejected" ? towerResult.reason : null, "No swap route is available.");
      return NextResponse.json(
        { error: primary.message, errors },
        { status: primary.status },
      );
    }

    // Best route = highest guaranteed (minimum) output in output-token units.
    const towerMinOut = tower ? fromTowerQuoteAmount(tower.minOut, tokenOut.decimals) : -1n;
    const peachMinOut = peach ? BigInt(peach.minOut) : -1n;
    const best = peachMinOut > towerMinOut ? "peach" : "tower";

    return NextResponse.json({
      best,
      routes: {
        ...(tower ? { tower: { quote: tower, routeLabel: towerRouteLabel(tower) } } : {}),
        ...(peach ? { peach } : {}),
      },
      errors,
      // Backwards-compatible Tower fields.
      ...(tower
        ? {
            quote: tower,
            output: tower.outputAmount,
            minOut: tower.minOut,
            router: tower.dexName,
            routeLabel: towerRouteLabel(tower),
          }
        : {}),
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
    const failure = routeError(error, "Could not quote this swap.");
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
