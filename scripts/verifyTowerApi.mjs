import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  decodeFunctionData,
  getAddress,
  http,
  parseUnits,
} from "viem";

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

const TOKENS = {
  USDC: { address: "0x3600000000000000000000000000000000000000", decimals: 6 },
  EURC: { address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", decimals: 6 },
  USDT: { address: "0x175CdB1D338945f0D851A741ccF787D343E57952", decimals: 18 },
  cirBTC: { address: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF", decimals: 8 },
};
const TOWER = "0x2De8906a641d65d490bC60A4179d961d59742bCb";
const USER = "0xa54FFd258815Ee711bA0d3Dbb7fA786AEA6095Fb";
const API = (process.env.TOWER_API_BASE_URL || "https://www.tower.exchange/api/public").replace(/\/$/, "");
const client = createPublicClient({
  transport: http(process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network"),
});
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
    throw new Error(body.error || "HTTP " + response.status);
  }
  return body.data;
}

let passed = 0;
let failed = 0;
function ok(name, detail = "") {
  passed += 1;
  console.log("PASS  " + name + (detail ? " — " + detail : ""));
}
function bad(name, error) {
  failed += 1;
  console.log("FAIL  " + name + " — " + (error instanceof Error ? error.message : error));
}

try {
  const prices = await api("/prices");
  const keys =
    prices && typeof prices === "object"
      ? Object.keys(prices).slice(0, 8).join(",")
      : typeof prices;
  ok("GET /prices", keys);
} catch (error) {
  bad("GET /prices", error);
}

try {
  const dexes = await api("/swap/dexes");
  ok(
    "GET /swap/dexes",
    (Array.isArray(dexes) ? dexes.map((item) => item.id || item.name) : []).join(","),
  );
} catch (error) {
  bad("GET /swap/dexes", error);
}

const sizes = { USDC: "1", EURC: "1", USDT: "1", cirBTC: "0.001" };
for (const from of Object.keys(TOKENS)) {
  for (const to of Object.keys(TOKENS)) {
    if (from === to) continue;
    const label = from + "->" + to;
    try {
      const amount = parseUnits(sizes[from], TOKENS[from].decimals).toString();
      const quote = await api("/swap/quote", {
        method: "POST",
        body: JSON.stringify({
          inputToken: TOKENS[from].address,
          outputToken: TOKENS[to].address,
          inputAmount: amount,
          slippageTolerance: 50,
        }),
      });
      if (getAddress(quote.inputToken) !== getAddress(TOKENS[from].address)) {
        throw new Error("input token mismatch");
      }
      if (getAddress(quote.outputToken) !== getAddress(TOKENS[to].address)) {
        throw new Error("output token mismatch");
      }
      if (BigInt(quote.outputAmount) <= 0n) throw new Error("zero output");
      if (BigInt(quote.minOut) <= 0n) throw new Error("zero minOut");
      const quoteDecimals = 18;
      const inDecimals = TOKENS[from].decimals;
      const outDecimals = TOKENS[to].decimals;
      const scaledIn =
        inDecimals >= quoteDecimals
          ? quote.inputAmount
          : (BigInt(quote.inputAmount) / 10n ** BigInt(quoteDecimals - inDecimals)).toString();
      if (scaledIn !== amount) {
        throw new Error("amount mismatch " + quote.inputAmount + " != " + amount);
      }

      const built = await api("/swap/build-tx", {
        method: "POST",
        body: JSON.stringify({ quote, userAddress: USER }),
      });
      if (getAddress(built.swap.to) !== getAddress(TOWER)) {
        throw new Error("swap.to is not Tower " + built.swap.to);
      }
      if (Number(built.swap.chainId) !== 5042002) {
        throw new Error("chainId " + built.swap.chainId);
      }
      if (!String(built.swap.data).startsWith("0xcd6267d5")) {
        throw new Error("not executeSwap selector");
      }
      if (built.swap.value && BigInt(built.swap.value) !== 0n) {
        throw new Error("unexpected value");
      }
      if (built.approval) {
        if (getAddress(built.approval.to) !== getAddress(TOKENS[from].address)) {
          throw new Error("approval.to not input token");
        }
        if (!String(built.approval.data).toLowerCase().startsWith("0x095ea7b3")) {
          throw new Error("approval not ERC20 approve");
        }
        const spender = getAddress("0x" + built.approval.data.slice(34, 74));
        if (spender !== getAddress(TOWER)) {
          throw new Error("approval spender not Tower");
        }
      }

      const decoded = decodeFunctionData({ abi: TOWER_ABI, data: built.swap.data });
      const params = decoded.args[0];
      if (getAddress(params.tokenIn) !== getAddress(TOKENS[from].address)) {
        throw new Error("calldata tokenIn mismatch");
      }
      if (getAddress(params.tokenOut) !== getAddress(TOKENS[to].address)) {
        throw new Error("calldata tokenOut mismatch");
      }
      if (params.amountIn.toString() !== amount) {
        throw new Error("calldata amountIn mismatch");
      }
      if (getAddress(params.recipient) !== getAddress(USER)) {
        throw new Error("recipient mismatch");
      }

      let callNote = "eth_call-skipped";
      try {
        await client.call({
          account: USER,
          to: built.swap.to,
          data: built.swap.data,
          value: 0n,
        });
        callNote = "eth_call-ok";
      } catch (callError) {
        const message = callError instanceof Error ? callError.message : String(callError);
        if (/revert/i.test(message)) {
          callNote = "eth_call-revert-expected-no-allowance";
        } else {
          throw callError;
        }
      }
      ok(
        label,
        "dex=" +
          (quote.dexId || quote.dexName) +
          " out=" +
          quote.outputAmount +
          " min=" +
          quote.minOut +
          " " +
          callNote,
      );
    } catch (error) {
      bad(label, error);
    }
  }
}

console.log("\nResult: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
