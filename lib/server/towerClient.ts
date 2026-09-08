import "server-only";

import { getAddress, type Address } from "viem";
import { ARC_DEX_TOKENS } from "@/lib/arcDex";
import {
  assertPreparedSwap,
  parseOptionalTowerTxPayload,
  parseSlippageBps,
  parseTowerQuote,
  parseTowerTxPayload,
  requireAtomicAmount,
  TOWER_DEFAULT_SLIPPAGE_BPS,
  type SwapTokenSymbol,
  type TowerPreparedSwap,
  type TowerQuoteData,
} from "@/lib/towerSwap";

type TokenSymbol = SwapTokenSymbol;

const DEFAULT_TOWER_API_BASE = "https://www.tower.exchange/api/public";
const TOWER_TIMEOUT_MS = 20_000;

export class TowerApiError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "TowerApiError";
    this.status = status;
  }
}

function apiKey() {
  const key = process.env.TOWER_API_KEY?.trim();
  if (!key) {
    throw new TowerApiError(
      "Tower API key is not configured. Set TOWER_API_KEY on the Lendora server.",
      503,
    );
  }
  if (!key.startsWith("sk_live_") && !key.startsWith("sk_test_")) {
    throw new TowerApiError(
      "Tower API key format is invalid. Use a sk_test_ or sk_live_ key from the Tower console.",
      503,
    );
  }
  return key;
}

function apiBase() {
  return (process.env.TOWER_API_BASE_URL?.trim() || DEFAULT_TOWER_API_BASE).replace(
    /\/$/,
    "",
  );
}

async function towerRequest<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOWER_TIMEOUT_MS);
  try {
    const response = await fetch(`${apiBase()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey()}`,
        "content-type": "application/json",
        accept: "application/json",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        throw new TowerApiError(
          `Tower API returned a non-JSON response (${response.status}).`,
          response.status || 502,
        );
      }
    }
    const payload = (body ?? {}) as {
      success?: boolean;
      error?: unknown;
      data?: T;
    };
    if (!response.ok || payload.success === false) {
      const message =
        typeof payload.error === "string" && payload.error.trim()
          ? payload.error
          : `Tower API request failed (${response.status}).`;
      throw new TowerApiError(message, response.status || 502);
    }
    if (payload.data === undefined) {
      throw new TowerApiError("Tower API response did not include data.", 502);
    }
    return payload.data;
  } catch (error) {
    if (error instanceof TowerApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new TowerApiError("Tower API timed out. Retry the quote.", 504);
    }
    throw new TowerApiError(
      error instanceof Error ? error.message : "Tower API is unreachable.",
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTowerQuote(input: {
  tokenIn: TokenSymbol;
  tokenOut: TokenSymbol;
  inputAmount: string;
  slippageBps?: number;
}): Promise<TowerQuoteData> {
  const tokenIn = ARC_DEX_TOKENS[input.tokenIn];
  const tokenOut = ARC_DEX_TOKENS[input.tokenOut];
  const slippageTolerance = input.slippageBps ?? TOWER_DEFAULT_SLIPPAGE_BPS;
  parseSlippageBps(slippageTolerance);
  const amount = requireAtomicAmount(input.inputAmount, "Swap amount");

  const data = await towerRequest<unknown>("/swap/quote", {
    method: "POST",
    body: JSON.stringify({
      inputToken: tokenIn.address,
      outputToken: tokenOut.address,
      inputAmount: amount,
      slippageTolerance,
    }),
  });
  return parseTowerQuote(data);
}

export async function fetchTowerBuildTx(input: {
  quote: unknown;
  userAddress: Address;
}): Promise<TowerPreparedSwap> {
  const parsedQuote = parseTowerQuote(input.quote);
  const data = await towerRequest<{
    approval?: unknown;
    swap?: unknown;
  }>("/swap/build-tx", {
    method: "POST",
    body: JSON.stringify({
      quote: input.quote,
      userAddress: getAddress(input.userAddress),
    }),
  });
  const swap = parseTowerTxPayload(data.swap, "Tower swap");
  const approval = parseOptionalTowerTxPayload(data.approval, "Tower approval");
  return { quote: parsedQuote, approval, swap };
}

export async function prepareTowerSwap(input: {
  tokenIn: TokenSymbol;
  tokenOut: TokenSymbol;
  inputAmount: string;
  slippageBps?: number;
  userAddress: Address;
}): Promise<TowerPreparedSwap> {
  const tokenIn = ARC_DEX_TOKENS[input.tokenIn];
  const tokenOut = ARC_DEX_TOKENS[input.tokenOut];
  const slippageTolerance = input.slippageBps ?? TOWER_DEFAULT_SLIPPAGE_BPS;
  parseSlippageBps(slippageTolerance);
  const amount = requireAtomicAmount(input.inputAmount, "Swap amount");

  const rawQuote = await towerRequest<unknown>("/swap/quote", {
    method: "POST",
    body: JSON.stringify({
      inputToken: tokenIn.address,
      outputToken: tokenOut.address,
      inputAmount: amount,
      slippageTolerance,
    }),
  });
  const prepared = await fetchTowerBuildTx({
    quote: rawQuote,
    userAddress: input.userAddress,
  });
  assertPreparedSwap(prepared, {
    userAddress: getAddress(input.userAddress),
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    inputAmount: amount,
  });
  return prepared;
}
