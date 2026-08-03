import type { Address } from "viem";

export const ARC_DEX_TOKENS = {
  USDC: {
    symbol: "USDC",
    address: "0x3600000000000000000000000000000000000000",
    decimals: 6,
  },
  EURC: {
    symbol: "EURC",
    address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    decimals: 6,
  },
  USDT: {
    symbol: "USDT",
    address: "0x175CdB1D338945f0D851A741ccF787D343E57952",
    decimals: 18,
  },
  cirBTC: {
    symbol: "cirBTC",
    address: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
    decimals: 8,
  },
} as const satisfies Record<
  string,
  { symbol: string; address: Address; decimals: number }
>;

export const ARC_DEX_ROUTERS = {
  curve: "0x2d84d79c852f6842abe0304b70bbaa1506add457",
  xylo: "0x73742278c31a76dBb0D2587d03ef92E6E2141023",
  v3: "0xA545bCB1Bd7985c59ea162aB1748A0803434C31b",
  v3Quoter: "0x3Ce954107b1A675826B33bF23060Dd655e3758fE",
} as const satisfies Record<string, Address>;

export const SYNTHRA_V3_POOLS = {
  usdcCirBtc: {
    address: "0xa231458f45727CbFa45c1181b25CccB911ca163a",
    fee: 3000,
  },
} as const;

export function synthraV3FeesForPair(
  tokenIn: keyof typeof ARC_DEX_TOKENS,
  tokenOut: keyof typeof ARC_DEX_TOKENS,
) {
  const pair = new Set([tokenIn, tokenOut]);
  if (pair.has("USDT")) return [500, 3000, 10000] as const;
  if (pair.has("USDC") && pair.has("EURC")) return [500] as const;
  if (pair.has("USDC") && pair.has("cirBTC")) {
    return [SYNTHRA_V3_POOLS.usdcCirBtc.fee] as const;
  }
  return [] as const;
}

export function isStableSwapPair(
  tokenIn: keyof typeof ARC_DEX_TOKENS,
  tokenOut: keyof typeof ARC_DEX_TOKENS,
) {
  const pair = new Set([tokenIn, tokenOut]);
  return pair.has("USDC") && pair.has("EURC");
}

export const CURVE_ABI = [
  {
    name: "exchange",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "i", type: "int128" },
      { name: "j", type: "int128" },
      { name: "dx", type: "uint256" },
      { name: "min_dy", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "get_dy",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "i", type: "int128" },
      { name: "j", type: "int128" },
      { name: "dx", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const V2_ROUTER_ABI = [
  {
    name: "getAmountsOut",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "path", type: "address[]" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    name: "swapExactTokensForTokens",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;

export const V3_ROUTER_ABI = [
  {
    name: "exactInputSingle",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

export const V3_QUOTER_ABI = [
  {
    name: "quoteExactInputSingle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;
