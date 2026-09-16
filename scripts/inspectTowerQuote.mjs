import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeFunctionData, getAddress } from "viem";

for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(resolve(process.cwd(), file), "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

const API = (process.env.TOWER_API_BASE_URL || "https://www.tower.exchange/api/public").replace(/\/$/, "");
async function api(path, init = {}) {
  const response = await fetch(API + path, {
    ...init,
    headers: {
      authorization: "Bearer " + process.env.TOWER_API_KEY,
      "content-type": "application/json",
      accept: "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await response.json();
  if (!response.ok || body.success === false) {
    throw new Error(JSON.stringify(body));
  }
  return body.data;
}

const TOWER_ABI = [
  {
    name: "executeSwap",
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
          { name: "minAmountOut", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "routeTarget", type: "address" },
          { name: "approvalSpender", type: "address" },
          { name: "routeCalldata", type: "bytes" },
        ],
      },
    ],
    outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
  },
];

const cases = [
  {
    name: "1 USDC->EURC native-6",
    inputToken: "0x3600000000000000000000000000000000000000",
    outputToken: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    inputAmount: "1000000",
  },
  {
    name: "1 USDC->EURC 18-scale",
    inputToken: "0x3600000000000000000000000000000000000000",
    outputToken: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    inputAmount: "1000000000000000000",
  },
  {
    name: "1 USDT->USDC native-18",
    inputToken: "0x175CdB1D338945f0D851A741ccF787D343E57952",
    outputToken: "0x3600000000000000000000000000000000000000",
    inputAmount: "1000000000000000000",
  },
];

for (const item of cases) {
  console.log("\n==== " + item.name + " ====");
  const quote = await api("/swap/quote", {
    method: "POST",
    body: JSON.stringify({
      inputToken: item.inputToken,
      outputToken: item.outputToken,
      inputAmount: item.inputAmount,
      slippageTolerance: 50,
    }),
  });
  console.log(JSON.stringify({
    sent: item.inputAmount,
    inputToken: quote.inputToken,
    outputToken: quote.outputToken,
    inputAmount: quote.inputAmount,
    outputAmount: quote.outputAmount,
    minOut: quote.minOut,
    dexId: quote.dexId,
    dexName: quote.dexName,
    feeBps: quote.feeBps,
    priceImpact: quote.priceImpact,
  }, null, 2));
  const built = await api("/swap/build-tx", {
    method: "POST",
    body: JSON.stringify({
      quote,
      userAddress: "0xa54FFd258815Ee711bA0d3Dbb7fA786AEA6095Fb",
    }),
  });
  const decoded = decodeFunctionData({ abi: TOWER_ABI, data: built.swap.data });
  const params = decoded.args[0];
  const approvalSpender = built.approval
    ? getAddress("0x" + String(built.approval.data).slice(34, 74))
    : null;
  const approvalAmount = built.approval
    ? BigInt("0x" + String(built.approval.data).slice(74, 138)).toString()
    : null;
  console.log(JSON.stringify({
    swapTo: getAddress(built.swap.to),
    chainId: built.swap.chainId,
    approvalTo: built.approval ? getAddress(built.approval.to) : null,
    approvalSpender,
    approvalAmount,
    calldata: {
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn.toString(),
      minAmountOut: params.minAmountOut.toString(),
      recipient: params.recipient,
      routeTarget: params.routeTarget,
      approvalSpender: params.approvalSpender,
    },
  }, null, 2));
}
