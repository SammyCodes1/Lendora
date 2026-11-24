import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertPeachPreparedSwap,
  isPeachQuoteExpired,
  parsePeachSwapResponse,
  PEACH_EXECUTION_ROUTER,
} from "../lib/peachSwap.ts";

const USDC = "0x3600000000000000000000000000000000000000";
const EURC = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1";
const WALLET = "0x1111111111111111111111111111111111111111";
const word = (hex: string) => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");

function calldata(amount = 1_000_000n, tokenOut = EURC, wallet = WALLET) {
  return (
    "0x02fcde22" +
    word(USDC) +
    word(tokenOut) +
    word(wallet) +
    word(amount.toString(16)) +
    word("ff")
  );
}

function response(overrides: Record<string, unknown> = {}, txOverrides: Record<string, unknown> = {}) {
  return {
    code: 200,
    msg: "Success",
    data: {
      quote_id: "0xabc",
      plan_hash: "0xdef",
      amount_in: "1000000",
      unfilled_amount_in: "0",
      is_partial_fill: false,
      amount_out: "912206",
      expect_amount_out: "912206",
      custom_fee_bps: 0,
      custom_fee_amount: "0",
      contracts: { execution_router: PEACH_EXECUTION_ROUTER.toLowerCase() },
      payer: WALLET,
      executor: WALLET,
      recipient: WALLET,
      ...overrides,
      tx: {
        to: PEACH_EXECUTION_ROUTER.toLowerCase(),
        data: calldata(),
        value: "0",
        entrypoint: "executePlan",
        amount_out_min: "907644",
        ...txOverrides,
      },
    },
  };
}

const expected = {
  tokenIn: USDC,
  tokenOut: EURC,
  inputAmount: "1000000",
  executor: WALLET,
  slippageBps: 50,
  deadlineSecs: 120,
  receivedAt: 1_000_000,
};

test("accepts a well-formed Peach quote", () => {
  const parsed = parsePeachSwapResponse(response(), expected);
  assert.equal(parsed.route, "peach");
  assert.equal(parsed.minOut, "907644");
  assert.equal(parsed.expectedOutput, "912206");
  assert.equal(parsed.swap.to, PEACH_EXECUTION_ROUTER);
  assert.equal(parsed.approvalSpender, PEACH_EXECUTION_ROUTER);
  assert.equal(parsed.expiresAt, 1_000_000 + 120_000 - 15_000);
});

test("rejects a non-200 application code", () => {
  assert.throws(() => parsePeachSwapResponse({ code: 5010, msg: "no route" }, expected), /5010/);
});

test("rejects a transaction to another router", () => {
  assert.throws(
    () => parsePeachSwapResponse(response({}, { to: "0x2222222222222222222222222222222222222222" }), expected),
    /Execution Router/,
  );
});

test("rejects the wrong chain", () => {
  assert.throws(() => parsePeachSwapResponse(response({ chain_id: 5042002 }), expected), /5042/);
});

test("rejects a different executor or recipient", () => {
  assert.throws(
    () => parsePeachSwapResponse(response({ recipient: "0x3333333333333333333333333333333333333333" }), expected),
    /recipient/,
  );
  assert.throws(
    () => parsePeachSwapResponse(response({ executor: "0x3333333333333333333333333333333333333333" }), expected),
    /executor/,
  );
});

test("rejects amount mismatch and partial fills", () => {
  assert.throws(() => parsePeachSwapResponse(response({ amount_in: "999999" }), expected), /input amount/);
  assert.throws(() => parsePeachSwapResponse(response({ is_partial_fill: true }), expected), /partial/);
});

test("rejects missing amount_out_min and loose slippage", () => {
  assert.throws(() => parsePeachSwapResponse(response({}, { amount_out_min: undefined }), expected), /amount_out_min/);
  assert.throws(() => parsePeachSwapResponse(response({}, { amount_out_min: "800000" }), expected), /slippage/);
});

test("rejects custom fees, native value and wrong selector", () => {
  assert.throws(() => parsePeachSwapResponse(response({ custom_fee_bps: 30 }), expected), /custom fee/);
  assert.throws(() => parsePeachSwapResponse(response({}, { value: "1" }), expected), /native value/);
  assert.throws(
    () => parsePeachSwapResponse(response({}, { data: "0xdeadbeef" + calldata().slice(10) }), expected),
    /executePlan/,
  );
});

test("rejects calldata that does not encode the requested tokens", () => {
  assert.throws(
    () =>
      parsePeachSwapResponse(
        response({}, { data: calldata(1_000_000n, "0x4444444444444444444444444444444444444444") }),
        expected,
      ),
    /output token/,
  );
});

test("browser re-validation and expiry", () => {
  const parsed = parsePeachSwapResponse(response(), expected);
  const roundTrip = JSON.parse(JSON.stringify(parsed));
  assert.equal(
    assertPeachPreparedSwap(roundTrip, { tokenIn: USDC, tokenOut: EURC, inputAmount: "1000000", executor: WALLET }).quoteId,
    "0xabc",
  );
  assert.throws(
    () => assertPeachPreparedSwap({ ...roundTrip, swap: { ...roundTrip.swap, to: WALLET } }, { tokenIn: USDC, tokenOut: EURC, inputAmount: "1000000", executor: WALLET }),
    /Execution Router/,
  );
  assert.equal(isPeachQuoteExpired(parsed, parsed.expiresAt - 1), false);
  assert.equal(isPeachQuoteExpired(parsed, parsed.expiresAt), true);
});
