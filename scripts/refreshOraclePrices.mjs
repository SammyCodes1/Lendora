/**
 * refreshOraclePrices.mjs
 * Refreshes stale MockPriceOracle prices on Arc Testnet.
 * Run from: C:\Users\USER\arclend\frontend
 *   $env:DEPLOYER_PRIVATE_KEY="0x..."; node ..\scripts\refreshOraclePrices.mjs
 */

import { createPublicClient, createWalletClient, http, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const ORACLE_ADDRESS = getAddress("0x5D401B38686245B57Efb682828877a3124d36653");

// Prices with 8 decimals (1_00000000 = $1.00)
const PRICES = [
  {
    symbol: "USDC",
    token: getAddress("0x3600000000000000000000000000000000000000"),
    price: 1_00000000n,
    minBound: 95000000n,   // $0.95
    maxBound: 105000000n,  // $1.05
  },
  {
    symbol: "EURC",
    token: getAddress("0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"),
    price: 1_08000000n,
    minBound: 100000000n,  // $1.00
    maxBound: 120000000n,  // $1.20
  },
  {
    symbol: "cirBTC",
    token: getAddress("0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF"),
    price: 105_000_00000000n,
    minBound: 50_000_00000000n,  // $50,000
    maxBound: 200_000_00000000n, // $200,000
  },
];

const ORACLE_ABI = [
  {
    name: "setPriceBounds",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "minPriceUSD8decimals", type: "uint256" },
      { name: "maxPriceUSD8decimals", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "setPrice",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "priceUSD8decimals", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "getPrice",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      { name: "price", type: "uint256" },
      { name: "decimals", type: "uint8" },
    ],
  },
  {
    name: "priceBounds",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "min", type: "uint256" },
      { name: "max", type: "uint256" },
    ],
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
if (!privateKey) {
  console.error("\n❌  Set DEPLOYER_PRIVATE_KEY env var first.\n");
  process.exit(1);
}

const account = privateKeyToAccount(privateKey);
console.log(`\n🔑  Signer: ${account.address}`);

const transport = http("https://rpc.testnet.arc.network", {
  retryCount: 3,
  retryDelay: 2000,
  timeout: 20_000,
});

const publicClient = createPublicClient({ chain: arcTestnet, transport });
const walletClient = createWalletClient({ chain: arcTestnet, transport, account });

// ── Step 1: Set bounds for any token that needs it ────────────────────────────
console.log("\n── Step 1: setPriceBounds ──────────────────────────────────────");
for (const { symbol, token, minBound, maxBound } of PRICES) {
  // Check existing bounds
  let needsBounds = false;
  try {
    const [min, max] = await publicClient.readContract({
      address: ORACLE_ADDRESS,
      abi: ORACLE_ABI,
      functionName: "priceBounds",
      args: [token],
    });
    needsBounds = min === 0n && max === 0n;
    if (!needsBounds) {
      console.log(`  ℹ️   ${symbol} bounds already set (min=${min}, max=${max}), skipping`);
      continue;
    }
  } catch {
    needsBounds = true;
  }

  process.stdout.write(`  📤  setPriceBounds ${symbol}… `);
  try {
    const hash = await walletClient.writeContract({
      address: ORACLE_ADDRESS,
      abi: ORACLE_ABI,
      functionName: "setPriceBounds",
      args: [token, minBound, maxBound],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    console.log(`✅  block ${receipt.blockNumber}`);
  } catch (err) {
    console.error(`❌  ${err.shortMessage ?? err.message}`);
  }
  await sleep(500);
}

// ── Step 2: setPrice for all tokens ──────────────────────────────────────────
console.log("\n── Step 2: setPrice ────────────────────────────────────────────");
const hashes = [];
for (const { symbol, token, price } of PRICES) {
  process.stdout.write(`  📤  setPrice ${symbol} → $${Number(price) / 1e8}… `);
  try {
    const hash = await walletClient.writeContract({
      address: ORACLE_ADDRESS,
      abi: ORACLE_ABI,
      functionName: "setPrice",
      args: [token, price],
    });
    console.log(`tx: ${hash}`);
    hashes.push({ symbol, token, hash });
  } catch (err) {
    console.error(`❌  ${err.shortMessage ?? err.message}`);
  }
  await sleep(300);
}

console.log("\n⏳  Waiting for confirmations…");
for (const { symbol, hash } of hashes) {
  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    const icon = receipt.status === "success" ? "✅" : "❌";
    console.log(`  ${icon}  ${symbol} in block ${receipt.blockNumber}`);
  } catch (err) {
    console.error(`  ❌  ${symbol}: ${err.message}`);
  }
}

// ── Step 3: Verify ────────────────────────────────────────────────────────────
console.log("\n── Step 3: Verifying getPrice ──────────────────────────────────");
await sleep(2000); // brief pause to avoid immediate rate limit
for (const { symbol, token } of PRICES) {
  try {
    const [value, decimals] = await publicClient.readContract({
      address: ORACLE_ADDRESS,
      abi: ORACLE_ABI,
      functionName: "getPrice",
      args: [token],
    });
    console.log(`  ✅  ${symbol.padEnd(6)} $${Number(value) / 10 ** Number(decimals)}`);
  } catch (err) {
    console.error(`  ❌  ${symbol}: ${err.shortMessage ?? err.message}`);
  }
  await sleep(400);
}

console.log("\n✨  Done. Agent can now load USDC/EURC context without reverting.\n");
