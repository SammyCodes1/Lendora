import "server-only";

import { getAddress, type Address } from "viem";
import { ARC_DEX_TOKENS } from "@/lib/arcDex";
import {
  parsePeachSwapResponse,
  PEACH_DEFAULT_API_BASE,
  PEACH_DEFAULT_DEADLINE_SECS,
  PEACH_SWAP_CHAIN_ID,
  type PeachPreparedSwap,
} from "@/lib/peachSwap";
import { parseSlippageBps, requireAtomicAmount, type SwapTokenSymbol } from "@/lib/towerSwap";

const PEACH_TIMEOUT_MS = 10_000;
/** Retry a 429 once only when Peach asks us to wait no longer than this. */
const PEACH_MAX_RETRY_AFTER_MS = 3_000;

export class PeachApiError extends Error {
  status: number;
  retryAfterSeconds?: number;
  constructor(message: string, status = 502, retryAfterSeconds?: number) {
    super(message);
    this.name = "PeachApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function apiBase() {
  return (process.env.PEACH_API_URL?.trim() || PEACH_DEFAULT_API_BASE).replace(/\/$/, "");
}

function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

async function peachGet(path: string, params: URLSearchParams): Promise<unknown> {
  const key = process.env.PEACH_API_KEY?.trim();
  if (key) params.set("apikey", key);
  const url = `${apiBase()}${path}?${params.toString()}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PEACH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 429 || response.status === 503) {
        const waitMs = retryAfterMs(response.headers.get("retry-after"));
        if (attempt === 0 && waitMs !== undefined && waitMs <= PEACH_MAX_RETRY_AFTER_MS) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
        throw new PeachApiError(
          "Peach is rate limiting quotes. Wait a moment and retry.",
          429,
          waitMs === undefined ? undefined : Math.ceil(waitMs / 1000),
        );
      }
      const text = await response.text();
      let body: unknown;
      try {
        body = text ? (JSON.parse(text) as unknown) : null;
      } catch {
        throw new PeachApiError(`Peach returned a non-JSON response (${response.status}).`, 502);
      }
      if (!response.ok) {
        const msg =
          body && typeof body === "object" && typeof (body as { msg?: unknown }).msg === "string"
            ? (body as { msg: string }).msg
            : `Peach request failed (${response.status}).`;
        throw new PeachApiError(msg, response.status >= 500 ? 502 : 400);
      }
      return body;
    } catch (error) {
      if (error instanceof PeachApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new PeachApiError("Peach timed out. Retry the quote.", 504);
      }
      throw new PeachApiError(error instanceof Error ? error.message : "Peach is unreachable.", 502);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new PeachApiError("Peach is rate limiting quotes. Wait a moment and retry.", 429);
}

/**
 * Requests a Direct Allowance quote + signed transaction from Peach.
 * The returned transaction is the exact one the user must confirm and send.
 */
export async function fetchPeachSwap(input: {
  tokenIn: SwapTokenSymbol;
  tokenOut: SwapTokenSymbol;
  inputAmount: string;
  slippageBps: number;
  userAddress: Address;
  deadlineSecs?: number;
}): Promise<PeachPreparedSwap> {
  const tokenIn = ARC_DEX_TOKENS[input.tokenIn];
  const tokenOut = ARC_DEX_TOKENS[input.tokenOut];
  if (tokenIn.address.toLowerCase() === tokenOut.address.toLowerCase()) {
    throw new PeachApiError("Swap assets must be different.", 400);
  }
  const slippageBps = parseSlippageBps(input.slippageBps);
  const amount = requireAtomicAmount(input.inputAmount, "Swap amount");
  const executor = getAddress(input.userAddress);
  const deadlineSecs = input.deadlineSecs ?? PEACH_DEFAULT_DEADLINE_SECS;

  const params = new URLSearchParams({
    chain_id: String(PEACH_SWAP_CHAIN_ID),
    from: tokenIn.address,
    target: tokenOut.address,
    amount,
    executor,
    by_amount_in: "true",
    slippage_bps: String(slippageBps),
    deadline_secs: String(deadlineSecs),
    custom_fee_bps: "0",
  });
  const receivedBefore = Date.now();
  const body = await peachGet("/router/swap", params);
  const envelope = body as { code?: unknown; msg?: unknown } | null;
  if (envelope && envelope.code !== 200) {
    const code = Number(envelope.code);
    const msg = typeof envelope.msg === "string" ? envelope.msg : "Peach could not quote this swap.";
    // 5010 = no usable route / insufficient liquidity (see Peach error codes).
    throw new PeachApiError(code === 5010 ? "Peach has no route for this pair or amount." : msg, code === 5030 ? 503 : 400);
  }
  try {
    return parsePeachSwapResponse(body, {
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      inputAmount: amount,
      executor,
      slippageBps,
      deadlineSecs,
      // Use the request start so the local expiry is never later than Peach's.
      receivedAt: receivedBefore,
    });
  } catch (error) {
    throw new PeachApiError(
      error instanceof Error ? `Rejected Peach quote: ${error.message}` : "Rejected Peach quote.",
      502,
    );
  }
}
