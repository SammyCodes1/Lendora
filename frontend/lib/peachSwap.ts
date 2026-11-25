/**
 * Peach Arc Aggregator helpers shared by the server client, API routes and
 * the swap hook. This file must stay free of `@/` imports and server-only
 * code so it can run in the browser and under `node --test`.
 *
 * Docs: https://docs.peach.ag/documentation/arc/aggregator/overview
 */

export const PEACH_SWAP_CHAIN_ID = 5042;
/** Arc Mainnet ArcExecutionRouter proxy: swap destination and Direct approval spender. */
export const PEACH_EXECUTION_ROUTER = "0x2528F3190603B85A155D48C31946703d71f921ED" as const;
/** `executePlan(...)` selector documented by Peach. */
export const PEACH_EXECUTE_PLAN_SELECTOR = "0x02fcde22";
export const PEACH_DEFAULT_API_BASE = "https://api.peach.ag/arc";
export const PEACH_DEFAULT_DEADLINE_SECS = 120;
/** Treat a quote as expired this long before its signed deadline. */
export const PEACH_EXPIRY_SAFETY_MS = 15_000;

type Hex = `0x${string}`;
type Address = `0x${string}`;

export type PeachPreparedSwap = {
  route: "peach";
  quoteId: string;
  planHash?: string;
  tokenIn: Address;
  tokenOut: Address;
  inputAmount: string;
  /** Gross route output before any aggregator custom fee. */
  outputAmount: string;
  /** Expected net output (custom fee is always 0 for Lendora). */
  expectedOutput: string;
  /** Signed minimum output after slippage. */
  minOut: string;
  executor: Address;
  recipient: Address;
  slippageBps: number;
  /** Unix ms after which Lendora refuses to submit this exact quote. */
  expiresAt: number;
  approvalSpender: Address;
  swap: {
    to: Address;
    data: Hex;
    value: "0";
    chainId: number;
  };
};

export type PeachExpectedSwap = {
  tokenIn: string;
  tokenOut: string;
  inputAmount: string;
  executor: string;
  slippageBps: number;
  deadlineSecs: number;
  /** Server receive time in Unix ms (defaults to Date.now()). */
  receivedAt?: number;
};

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const UINT_RE = /^[0-9]+$/;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is missing`);
  }
  return value as Record<string, unknown>;
}

function requireUint(value: unknown, label: string): string {
  const text =
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? String(value)
      : value;
  if (typeof text !== "string" || !UINT_RE.test(text)) {
    throw new Error(`${label} must be a base-unit integer string`);
  }
  return text.replace(/^0+(?=\d)/, "");
}

function requireAddr(value: unknown, label: string): Address {
  if (typeof value !== "string" || !ADDRESS_RE.test(value)) {
    throw new Error(`${label} is not a valid address`);
  }
  return value as Address;
}

function sameAddress(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

/** True when `word` (address or uint) is ABI-encoded somewhere in calldata. */
function calldataHasWord(data: string, word: string) {
  return data.slice(10).toLowerCase().includes(word.toLowerCase());
}

function addressWord(address: string) {
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function uintWord(value: string) {
  return BigInt(value).toString(16).padStart(64, "0");
}

/**
 * Validates a Peach `GET /router/swap` response against the order Lendora
 * requested. Throws on any mismatch; never trusts the API's own addresses.
 */
export function parsePeachSwapResponse(
  body: unknown,
  expected: PeachExpectedSwap,
): PeachPreparedSwap {
  const envelope = asRecord(body, "Peach response");
  if (envelope.code !== 200) {
    const msg = typeof envelope.msg === "string" ? envelope.msg : "unknown error";
    throw new Error(`Peach returned code ${String(envelope.code)}: ${msg}`);
  }
  const data = asRecord(envelope.data, "Peach response data");
  const tx = asRecord(data.tx, "Peach transaction");

  if (data.chain_id !== undefined && Number(data.chain_id) !== PEACH_SWAP_CHAIN_ID) {
    throw new Error("Peach quote is not for Arc Mainnet (5042)");
  }

  const to = requireAddr(tx.to, "Peach transaction target");
  if (!sameAddress(to, PEACH_EXECUTION_ROUTER)) {
    throw new Error("Peach transaction target is not the Peach Execution Router");
  }
  const contracts = data.contracts as Record<string, unknown> | undefined;
  if (
    contracts &&
    typeof contracts.execution_router === "string" &&
    !sameAddress(contracts.execution_router, PEACH_EXECUTION_ROUTER)
  ) {
    throw new Error("Peach reported an unexpected Execution Router");
  }

  const txData = tx.data;
  if (typeof txData !== "string" || !/^0x[0-9a-fA-F]+$/.test(txData) || txData.length < 10) {
    throw new Error("Peach transaction calldata is invalid");
  }
  if (!txData.toLowerCase().startsWith(PEACH_EXECUTE_PLAN_SELECTOR)) {
    throw new Error("Peach calldata is not executePlan");
  }
  if (tx.entrypoint !== undefined && tx.entrypoint !== "executePlan") {
    throw new Error("Peach entrypoint is not executePlan");
  }
  const value = tx.value === undefined || tx.value === null ? "0" : requireUint(tx.value, "Peach tx value");
  if (value !== "0") {
    throw new Error("Peach swap unexpectedly requires native value");
  }

  const executor = requireAddr(data.executor, "Peach executor");
  const payer = data.payer === undefined ? executor : requireAddr(data.payer, "Peach payer");
  const recipient =
    data.recipient === undefined ? executor : requireAddr(data.recipient, "Peach recipient");
  if (!sameAddress(executor, expected.executor) || !sameAddress(payer, expected.executor)) {
    throw new Error("Peach executor/payer does not match the connected wallet");
  }
  if (!sameAddress(recipient, expected.executor)) {
    throw new Error("Peach recipient does not match the connected wallet");
  }

  const inputAmount = requireUint(data.amount_in, "Peach input amount");
  if (inputAmount !== requireUint(expected.inputAmount, "Requested input amount")) {
    throw new Error("Peach input amount does not match the requested swap");
  }
  if (data.is_partial_fill === true || (data.unfilled_amount_in !== undefined && requireUint(data.unfilled_amount_in, "Peach unfilled amount") !== "0")) {
    throw new Error("Peach returned a partial fill");
  }

  const feeBps = data.custom_fee_bps === undefined ? 0 : Number(data.custom_fee_bps);
  const feeAmount =
    data.custom_fee_amount === undefined ? "0" : requireUint(data.custom_fee_amount, "Peach custom fee");
  if (feeBps !== 0 || feeAmount !== "0") {
    throw new Error("Peach quote includes an unexpected custom fee");
  }

  const outputAmount = requireUint(data.amount_out, "Peach output amount");
  const expectedOutput = requireUint(data.expect_amount_out, "Peach expected output");
  if (tx.amount_out_min === undefined || tx.amount_out_min === null) {
    throw new Error("Peach quote is missing amount_out_min");
  }
  const minOut = requireUint(tx.amount_out_min, "Peach minimum output");
  if (minOut === "0") throw new Error("Peach minimum output must be positive");
  if (BigInt(minOut) > BigInt(expectedOutput)) {
    throw new Error("Peach minimum output exceeds expected output");
  }
  const floorMin =
    (BigInt(expectedOutput) * BigInt(10_000 - expected.slippageBps)) / 10_000n;
  if (BigInt(minOut) < floorMin) {
    throw new Error("Peach minimum output is below the requested slippage");
  }

  // The signed plan is ABI-encoded in calldata; make sure it references the
  // tokens, wallet and amount we asked for.
  for (const [word, label] of [
    [addressWord(expected.tokenIn), "input token"],
    [addressWord(expected.tokenOut), "output token"],
    [addressWord(expected.executor), "wallet"],
    [uintWord(inputAmount), "input amount"],
  ] as const) {
    if (!calldataHasWord(txData, word)) {
      throw new Error(`Peach calldata does not reference the requested ${label}`);
    }
  }

  const quoteId = typeof data.quote_id === "string" && data.quote_id ? data.quote_id : "";
  if (!quoteId) throw new Error("Peach quote id is missing");
  const receivedAt = expected.receivedAt ?? Date.now();

  return {
    route: "peach",
    quoteId,
    planHash: typeof data.plan_hash === "string" ? data.plan_hash : undefined,
    tokenIn: expected.tokenIn as Address,
    tokenOut: expected.tokenOut as Address,
    inputAmount,
    outputAmount,
    expectedOutput,
    minOut,
    executor: expected.executor as Address,
    recipient: expected.executor as Address,
    slippageBps: expected.slippageBps,
    expiresAt: receivedAt + expected.deadlineSecs * 1000 - PEACH_EXPIRY_SAFETY_MS,
    approvalSpender: PEACH_EXECUTION_ROUTER,
    swap: {
      to: PEACH_EXECUTION_ROUTER,
      data: txData.toLowerCase() as Hex,
      value: "0",
      chainId: PEACH_SWAP_CHAIN_ID,
    },
  };
}

/** Re-validates a prepared swap that crossed the network (API -> browser). */
export function assertPeachPreparedSwap(
  value: unknown,
  expected: { tokenIn: string; tokenOut: string; inputAmount: string; executor: string },
): PeachPreparedSwap {
  const prepared = asRecord(value, "Peach quote") as unknown as PeachPreparedSwap;
  const swap = asRecord(prepared.swap, "Peach transaction") as PeachPreparedSwap["swap"];
  if (prepared.route !== "peach") throw new Error("Not a Peach quote");
  if (!sameAddress(requireAddr(swap.to, "Peach target"), PEACH_EXECUTION_ROUTER)) {
    throw new Error("Peach transaction target is not the Peach Execution Router");
  }
  if (!sameAddress(requireAddr(prepared.approvalSpender, "Peach spender"), PEACH_EXECUTION_ROUTER)) {
    throw new Error("Peach approval spender is not the Peach Execution Router");
  }
  if (swap.chainId !== PEACH_SWAP_CHAIN_ID) throw new Error("Peach quote is not for Arc Mainnet");
  if (swap.value !== "0") throw new Error("Peach swap unexpectedly requires native value");
  if (typeof swap.data !== "string" || !swap.data.toLowerCase().startsWith(PEACH_EXECUTE_PLAN_SELECTOR)) {
    throw new Error("Peach calldata is not executePlan");
  }
  if (
    !sameAddress(prepared.tokenIn, expected.tokenIn) ||
    !sameAddress(prepared.tokenOut, expected.tokenOut) ||
    requireUint(prepared.inputAmount, "Peach input amount") !== requireUint(expected.inputAmount, "Requested input amount") ||
    !sameAddress(prepared.executor, expected.executor) ||
    !sameAddress(prepared.recipient, expected.executor)
  ) {
    throw new Error("Peach quote does not match this swap");
  }
  requireUint(prepared.minOut, "Peach minimum output");
  requireUint(prepared.expectedOutput, "Peach expected output");
  if (typeof prepared.expiresAt !== "number" || !Number.isFinite(prepared.expiresAt)) {
    throw new Error("Peach quote expiry is missing");
  }
  return prepared;
}

export function isPeachQuoteExpired(prepared: Pick<PeachPreparedSwap, "expiresAt">, now = Date.now()) {
  return now >= prepared.expiresAt;
}
