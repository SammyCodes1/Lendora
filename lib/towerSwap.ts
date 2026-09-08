import {
  decodeFunctionData,
  getAddress,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { ARC_DEX_ROUTERS, ARC_DEX_TOKENS, TOWER_ABI } from "@/lib/arcDex";

export const TOWER_SWAP_CHAIN_ID = 5042002;
export const TOWER_SWAP_EXECUTOR = ARC_DEX_ROUTERS.tower;
export const TOWER_QUOTE_DECIMALS = 18;
export const TOWER_QUOTE_MAX_AGE_MS = 55_000;
export const TOWER_MIN_SLIPPAGE_BPS = 1;
export const TOWER_MAX_SLIPPAGE_BPS = 500;
export const TOWER_DEFAULT_SLIPPAGE_BPS = 50;

export type SwapTokenSymbol = keyof typeof ARC_DEX_TOKENS;

export type TowerQuoteData = {
  inputToken: Address;
  outputToken: Address;
  inputAmount: string;
  outputAmount: string;
  minOut: string;
  priceImpact: number;
  gasEstimate?: string;
  feeBps: number;
  platformFeeAmount?: string;
  dexId: string;
  dexName: string;
  route?: unknown;
  routeOptions?: unknown;
  [key: string]: unknown;
};

export type TowerTxPayload = {
  to: Address;
  data: Hex;
  value: string;
  from?: Address;
  gasLimit?: string;
  chainId?: number;
};

export type TowerPreparedSwap = {
  quote: TowerQuoteData;
  approval: TowerTxPayload | null;
  swap: TowerTxPayload;
};

export function isSwapTokenSymbol(value: unknown): value is SwapTokenSymbol {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ARC_DEX_TOKENS, value)
  );
}

export function isSupportedTowerPair(
  tokenIn: SwapTokenSymbol,
  tokenOut: SwapTokenSymbol,
) {
  return tokenIn !== tokenOut;
}

export function tokenByAddress(address: string) {
  const normalized = address.toLowerCase();
  return (
    Object.values(ARC_DEX_TOKENS).find(
      (token) => token.address.toLowerCase() === normalized,
    ) ?? null
  );
}

/** Tower quote JSON uses 18-decimal amounts. On-chain executeSwap uses token decimals. */
export function fromTowerQuoteAmount(apiAmount: string, tokenDecimals: number): bigint {
  const value = BigInt(apiAmount);
  if (tokenDecimals >= TOWER_QUOTE_DECIMALS) return value;
  const scale = 10n ** BigInt(TOWER_QUOTE_DECIMALS - tokenDecimals);
  return value / scale;
}

export function quoteAmountMatchesNative(
  quoteAmount: string,
  nativeAmount: string,
  tokenDecimals: number,
) {
  if (quoteAmount === nativeAmount) return true;
  return fromTowerQuoteAmount(quoteAmount, tokenDecimals).toString() === nativeAmount;
}

export function parseWeiAmount(value: unknown, label: string): string {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    value === 0 ||
    value === 0n ||
    value === "0" ||
    value === "0x" ||
    value === "0x0"
  ) {
    return "0";
  }
  if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) {
    return BigInt(value).toString();
  }
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error(`${label} cannot be negative`);
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative integer`);
    }
    return String(value);
  }
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new Error(`${label} must be an integer string`);
  }
  return value.replace(/^0+(?=\d)/, "") || "0";
}

export function requireAtomicAmount(value: unknown, label: string): string {
  const amount = parseWeiAmount(value, label);
  if (amount === "0") {
    throw new Error(`${label} must be greater than zero`);
  }
  return amount;
}

export function requireAddress(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`${label} is not a valid Arc address`);
  }
  return getAddress(value);
}

export function requireHexData(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value) || value.length < 10) {
    throw new Error(`${label} is not valid transaction calldata`);
  }
  return value.toLowerCase() as Hex;
}

export function parseSlippageBps(value: unknown): number {
  const slippage = typeof value === "number" ? value : Number(value);
  if (
    !Number.isInteger(slippage) ||
    slippage < TOWER_MIN_SLIPPAGE_BPS ||
    slippage > TOWER_MAX_SLIPPAGE_BPS
  ) {
    throw new Error("Slippage must be a whole number between 1 and 500 basis points");
  }
  return slippage;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is missing`);
  }
  return value as Record<string, unknown>;
}

export function parseTowerQuote(value: unknown): TowerQuoteData {
  const quote = asRecord(value, "Tower quote");
  const inputToken = requireAddress(quote.inputToken, "Quote input token");
  const outputToken = requireAddress(quote.outputToken, "Quote output token");
  const inputMeta = tokenByAddress(inputToken);
  const outputMeta = tokenByAddress(outputToken);
  if (!inputMeta || !outputMeta) {
    throw new Error("Tower quote uses a token that Lendora does not support");
  }
  if (inputMeta.address.toLowerCase() === outputMeta.address.toLowerCase()) {
    throw new Error("Tower quote tokens must be different");
  }

  const inputAmount = requireAtomicAmount(quote.inputAmount, "Quote input amount");
  const outputAmount = requireAtomicAmount(quote.outputAmount, "Quote output amount");
  const minOut = requireAtomicAmount(
    quote.minOut ?? quote.outputAmount,
    "Quote minimum output",
  );
  if (BigInt(minOut) > BigInt(outputAmount)) {
    throw new Error("Tower quote minimum output exceeds quoted output");
  }

  const priceImpact =
    typeof quote.priceImpact === "number" && Number.isFinite(quote.priceImpact)
      ? quote.priceImpact
      : 0;
  const feeBps =
    typeof quote.feeBps === "number" && Number.isInteger(quote.feeBps) && quote.feeBps >= 0
      ? quote.feeBps
      : 25;
  const dexId = typeof quote.dexId === "string" && quote.dexId.trim()
    ? quote.dexId.trim()
    : "tower";
  const dexName = typeof quote.dexName === "string" && quote.dexName.trim()
    ? quote.dexName.trim()
    : "Tower Exchange";

  return {
    ...quote,
    inputToken,
    outputToken,
    inputAmount,
    outputAmount,
    minOut,
    priceImpact,
    gasEstimate:
      typeof quote.gasEstimate === "string" ? quote.gasEstimate : undefined,
    feeBps,
    platformFeeAmount:
      typeof quote.platformFeeAmount === "string"
        ? quote.platformFeeAmount
        : undefined,
    dexId,
    dexName,
  };
}

export function parseTowerTxPayload(
  value: unknown,
  label: string,
): TowerTxPayload {
  const payload = asRecord(value, label);
  const to = requireAddress(payload.to, `${label} target`);
  const data = requireHexData(payload.data, `${label} calldata`);
  const valueWei = parseWeiAmount(payload.value, `${label} value`);
  const chainId =
    typeof payload.chainId === "number"
      ? payload.chainId
      : payload.chainId === undefined
        ? undefined
        : Number(payload.chainId);
  if (chainId !== undefined && (!Number.isInteger(chainId) || chainId <= 0)) {
    throw new Error(`${label} chain id is invalid`);
  }
  return {
    to,
    data,
    value: valueWei,
    from: payload.from ? requireAddress(payload.from, `${label} sender`) : undefined,
    gasLimit:
      typeof payload.gasLimit === "string" || typeof payload.gasLimit === "number"
        ? String(payload.gasLimit)
        : undefined,
    chainId,
  };
}

export function parseOptionalTowerTxPayload(
  value: unknown,
  label: string,
): TowerTxPayload | null {
  if (value === null || value === undefined) return null;
  return parseTowerTxPayload(value, label);
}

export function assertPreparedSwap(
  prepared: TowerPreparedSwap,
  expected: {
    userAddress: Address;
    tokenIn: SwapTokenSymbol;
    tokenOut: SwapTokenSymbol;
    inputAmount: string;
  },
) {
  const input = ARC_DEX_TOKENS[expected.tokenIn];
  const output = ARC_DEX_TOKENS[expected.tokenOut];
  if (prepared.quote.inputToken.toLowerCase() !== input.address.toLowerCase()) {
    throw new Error("Tower quote input token does not match the requested swap");
  }
  if (prepared.quote.outputToken.toLowerCase() !== output.address.toLowerCase()) {
    throw new Error("Tower quote output token does not match the requested swap");
  }
  const inputMeta = tokenByAddress(prepared.quote.inputToken);
  if (
    !inputMeta ||
    !quoteAmountMatchesNative(
      prepared.quote.inputAmount,
      expected.inputAmount,
      inputMeta.decimals,
    )
  ) {
    throw new Error("Tower quote input amount does not match the requested swap");
  }
  if (prepared.swap.chainId !== undefined && prepared.swap.chainId !== TOWER_SWAP_CHAIN_ID) {
    throw new Error("Tower swap calldata is not for Arc Testnet");
  }
  if (prepared.swap.to.toLowerCase() !== TOWER_SWAP_EXECUTOR.toLowerCase()) {
    throw new Error("Tower swap target is not the Tower Exchange router");
  }
  const decoded = decodeFunctionData({
    abi: TOWER_ABI,
    data: prepared.swap.data,
  });
  if (decoded.functionName !== "executeSwap") {
    throw new Error("Tower swap calldata is not executeSwap");
  }
  const params = decoded.args[0];
  if (getAddress(params.tokenIn) !== input.address) {
    throw new Error("Tower calldata input token does not match the requested swap");
  }
  if (getAddress(params.tokenOut) !== output.address) {
    throw new Error("Tower calldata output token does not match the requested swap");
  }
  if (params.amountIn.toString() !== expected.inputAmount) {
    throw new Error("Tower calldata amount does not match the requested swap");
  }
  if (getAddress(params.recipient) !== getAddress(expected.userAddress)) {
    throw new Error("Tower calldata recipient does not match the connected wallet");
  }
  if (prepared.swap.from && prepared.swap.from.toLowerCase() !== expected.userAddress.toLowerCase()) {
    throw new Error("Tower swap sender does not match the connected wallet");
  }
  if (prepared.swap.value !== "0") {
    throw new Error("Tower swap unexpectedly requires native value");
  }
  if (prepared.approval) {
    if (prepared.approval.to.toLowerCase() !== input.address.toLowerCase()) {
      throw new Error("Tower approval target is not the input token");
    }
    if (
      prepared.approval.from &&
      prepared.approval.from.toLowerCase() !== expected.userAddress.toLowerCase()
    ) {
      throw new Error("Tower approval sender does not match the connected wallet");
    }
    if (!prepared.approval.data.startsWith("0x095ea7b3")) {
      throw new Error("Tower approval calldata is not an ERC-20 approve");
    }
    const spenderWord = prepared.approval.data.slice(34, 74);
    const spender = getAddress(`0x${spenderWord}`);
    if (spender.toLowerCase() !== TOWER_SWAP_EXECUTOR.toLowerCase()) {
      throw new Error("Tower approval spender is not the Tower Exchange router");
    }
  }
}

export function towerRouteLabel(quote: Pick<TowerQuoteData, "dexName" | "dexId">) {
  if (quote.dexName && quote.dexName.toLowerCase() !== "tower") {
    return `Tower Exchange · ${quote.dexName}`;
  }
  if (quote.dexId && quote.dexId !== "tower" && quote.dexId !== "tower-dex") {
    return `Tower Exchange · ${quote.dexId}`;
  }
  return "Tower Exchange";
}
