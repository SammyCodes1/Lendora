import type { Address } from "viem";

export const ARCANA_MARKETS_ADDRESS =
  "0x443a47eF1025e047879b1BA08c94e6dedB354D54" as Address;

export const ARC_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000" as Address;

export const arcanaMarketsAbi = [
  {
    type: "function",
    name: "marketCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "usdc",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getMarket",
    stateMutability: "view",
    inputs: [{ name: "_marketId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "title", type: "string" },
          { name: "category", type: "string" },
          { name: "yesPool", type: "uint256" },
          { name: "noPool", type: "uint256" },
          { name: "endTime", type: "uint256" },
          { name: "resolved", type: "bool" },
          { name: "yesWon", type: "bool" },
          { name: "cancelled", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getPosition",
    stateMutability: "view",
    inputs: [
      { name: "_marketId", type: "uint256" },
      { name: "_user", type: "address" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "yesShares", type: "uint256" },
          { name: "noShares", type: "uint256" },
          { name: "claimed", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "buyShares",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_marketId", type: "uint256" },
      { name: "_isYes", type: "bool" },
      { name: "_usdcAmount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claimWinnings",
    stateMutability: "nonpayable",
    inputs: [{ name: "_marketId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "refund",
    stateMutability: "nonpayable",
    inputs: [{ name: "_marketId", type: "uint256" }],
    outputs: [],
  },
] as const;
