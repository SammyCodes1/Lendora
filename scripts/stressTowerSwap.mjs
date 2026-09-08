/**
 * Stress-tests Lendora's Tower-only swap path.
 * Run from arclend/: node scripts/stressTowerSwap.mjs
 *
 * Always verifies on-chain token decimals, Tower executor, adapter quotes.
 * If TOWER_API_KEY is set, also hits Tower quote + build-tx and eth_calls
 * the returned swap calldata.
 */
import { createPublicClient, http, parseUnits, getAddress } from "viem";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TOKENS = {
  USDC: { symbol: "USDC", address: "0x3600000000000000000000000000000000000000", decimals: 6 },
  EURC: { symbol: "EURC", address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", decimals: 6 },
  USDT: { symbol: "USDT", address: "0x175CdB1D338945f0D851A741ccF787D343E57952", decimals: 18 },
  cirBTC: { symbol: "cirBTC", address: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF", decimals: 8 },
};
const TOWER = "0x2De8906a641d65d490bC60A4179d961d59742bCb";
const ADAPTER = "0xAF076A2DaA8fA1B30e51CEE5C9eed989f9f3BD58";
const DUMMY_USER = "0xa54FFd258815Ee711bA0d3Dbb7fA786AEA6095Fb";
const API_BASE = (process.env.TOWER_API_BASE_URL || "https://www.tower.exchange/api/public").replace(/\/$/, "");
const RPC = process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network";

function loadDotEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = readFileSync(resolve(process.cwd(), file), "utf8");
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 1) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
        if (!process.env[key]) process.env[key] = value;
      }
    } catch {}
  }
}

loadDotEnv();

const erc20 = [
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
];
const towerAbi = [
  { name: "platformFeeBps", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];
const adapterAbi = [
  {
    name: "getAmountOut",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
];

const client = createPublicClient({ transport: http(RPC) });
let failed = 0;
let passed = 0;

function ok(name, detail = "") {
  passed += 1;
  console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
}
function fail(name, error) {
  failed += 1;
  console.error(`FAIL  ${name} — ${error instanceof Error ? error.message : error}`);
}

async function towerApi(path, init) {
  const key = process.env.TOWER_API_KEY;
  if (!key) throw new Error("TOWER_API_KEY missing");
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      accept: "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await response.json();
  if (!response.ok || body.success === false) {
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return body.data;
}

const pairs = [];
for (const a of Object.keys(TOKENS)) {
  for (const b of Object.keys(TOKENS)) {
    if (a !== b) pairs.push([a, b]);
  }
}

const sizes = {
  USDC: ["0.01", "1", "10", "100"],
  EURC: ["0.01", "1", "10", "100"],
  USDT: ["0.01", "1", "10"],
  cirBTC: ["0.0001", "0.001", "0.01"],
};

console.log("=== On-chain confirmation ===");
try {
  const code = await client.getCode({ address: TOWER });
  if (!code || code === "0x") throw new Error("no code");
  ok("TowerSwapExecutor deployed", `${(code.length - 2) / 2} bytes`);
} catch (error) {
  fail("TowerSwapExecutor deployed", error);
}
try {
  const code = await client.getCode({ address: ADAPTER });
  if (!code || code === "0x") throw new Error("no code");
  ok("TowerDexAdapter deployed", `${(code.length - 2) / 2} bytes`);
} catch (error) {
  fail("TowerDexAdapter deployed", error);
}
try {
  const fee = await client.readContract({ address: TOWER, abi: towerAbi, functionName: "platformFeeBps" });
  if (fee !== 25n) throw new Error(`expected 25 bps, got ${fee}`);
  ok("platformFeeBps", "25");
} catch (error) {
  fail("platformFeeBps", error);
}

for (const token of Object.values(TOKENS)) {
  try {
    const decimals = await client.readContract({
      address: token.address,
      abi: erc20,
      functionName: "decimals",
    });
    const symbol = await client.readContract({
      address: token.address,
      abi: erc20,
      functionName: "symbol",
    });
    if (Number(decimals) !== token.decimals) {
      throw new Error(`decimals ${decimals} != ${token.decimals}`);
    }
    if (symbol !== token.symbol) throw new Error(`symbol ${symbol}`);
    ok(`${token.symbol} metadata`, `${decimals} decimals`);
  } catch (error) {
    fail(`${token.symbol} metadata`, error);
  }
}

console.log("=== Adapter quote matrix ===");
for (const [from, to] of pairs) {
  const tokenIn = TOKENS[from];
  const tokenOut = TOKENS[to];
  const amount = parseUnits(sizes[from][1], tokenIn.decimals);
  const postFee = amount - (amount * 25n) / 10_000n;
  try {
    const out = await client.readContract({
      address: ADAPTER,
      abi: adapterAbi,
      functionName: "getAmountOut",
      args: [tokenIn.address, tokenOut.address, postFee],
    });
    if (out <= 0n) throw new Error("zero output");
    ok(`adapter ${from}->${to}`, out.toString());
  } catch (error) {
    fail(`adapter ${from}->${to}`, error);
  }
}

if (!process.env.TOWER_API_KEY) {
  console.log("\nTOWER_API_KEY not set — skipped live API quote/build-tx tests.");
  console.log(`Result: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

console.log("=== Tower API quote + build-tx ===");
try {
  const prices = await towerApi("/prices", { method: "GET" });
  ok("GET /prices", JSON.stringify(prices).slice(0, 120));
} catch (error) {
  fail("GET /prices", error);
}
try {
  const dexes = await towerApi("/swap/dexes", { method: "GET" });
  const names = Array.isArray(dexes) ? dexes.map((d) => d.id || d.name).join(",") : typeof dexes;
  ok("GET /swap/dexes", names);
} catch (error) {
  fail("GET /swap/dexes", error);
}

for (const [from, to] of pairs) {
  for (const size of sizes[from]) {
    const label = `quote ${size} ${from}->${to}`;
    try {
      const amount = parseUnits(size, TOKENS[from].decimals).toString();
      const quote = await towerApi("/swap/quote", {
        method: "POST",
        body: JSON.stringify({
          inputToken: TOKENS[from].address,
          outputToken: TOKENS[to].address,
          inputAmount: amount,
          slippageTolerance: 50,
        }),
      });
      if (!quote?.outputAmount || BigInt(quote.outputAmount) <= 0n) {
        throw new Error("empty output");
      }
      if (getAddress(quote.inputToken) !== getAddress(TOKENS[from].address)) {
        throw new Error("input token mismatch");
      }
      if (getAddress(quote.outputToken) !== getAddress(TOKENS[to].address)) {
        throw new Error("output token mismatch");
      }
      const built = await towerApi("/swap/build-tx", {
        method: "POST",
        body: JSON.stringify({ quote, userAddress: DUMMY_USER }),
      });
      if (!built?.swap?.to || !built?.swap?.data) throw new Error("missing swap payload");
      if (getAddress(built.swap.to) !== getAddress(TOWER)) {
        throw new Error(`swap target ${built.swap.to} is not Tower router`);
      }
      if (built.swap.chainId && Number(built.swap.chainId) !== 5042002) {
        throw new Error(`chainId ${built.swap.chainId}`);
      }
      try {
        await client.call({
          account: DUMMY_USER,
          to: built.swap.to,
          data: built.swap.data,
          value: built.swap.value ? BigInt(built.swap.value) : 0n,
        });
        ok(`${label} build+eth_call`, `out=${quote.outputAmount} dex=${quote.dexId || quote.dexName}`);
      } catch (callError) {
        const message = callError instanceof Error ? callError.message : String(callError);
        if (/transfer amount exceeds|insufficient|allowance|ERC20/i.test(message)) {
          ok(`${label} build+revert-expected`, message.slice(0, 80));
        } else {
          throw callError;
        }
      }
    } catch (error) {
      fail(label, error);
    }
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
