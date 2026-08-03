import { ethers, type ContractTransactionResponse } from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

/**
 * relayer.ts
 * ──────────
 * Off-chain relayer that monitors OrderAuthorized events on-chain,
 * checks timing constraints, quotes via Curve stable pool, and calls
 * executeOrder() when an order is due.
 *
 * Usage:
 *   npx tsx scripts/relayer.ts                   (one-shot scan)
 *   npx tsx scripts/relayer.ts --loop             (continuous polling)
 *   npx tsx scripts/relayer.ts --loop --interval 60  (poll every 60s)
 *
 * Requirements:
 *   1. Run setup_executor.ts first (registers relayer + route targets)
 *   2. PRIVATE_KEY in contracts/.env
 */

// ─── Config ──────────────────────────────────────────────────────────────────

const RPC_URL = process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY is required in contracts/.env");

const EXECUTOR = "0x884C8C2E3F4a2232797C54be029a8a87e31d75e4";
const CURVE_ROUTER = "0x2d84d79c852f6842abe0304b70bbaa1506add457";

const USDC = "0x3600000000000000000000000000000000000000";
const EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

// Curve pool coin indices for USDC/EURC stable pool
// Typical: USDC = 0, EURC = 1 (verify against the deployed pool)
const CURVE_COIN_INDEX: Record<string, number> = {
  [USDC.toLowerCase()]: 0,
  [EURC.toLowerCase()]: 1,
};

// Slippage tolerance: 0.5% (50 bps)
const SLIPPAGE_BPS = 50;

// Block where the new executor was deployed (Jul 31 2026)
const DEPLOYMENT_BLOCK = 54568200;

// ─── ABIs (minimal) ─────────────────────────────────────────────────────────

const EXECUTOR_ABI = [
  "event OrderAuthorized(bytes32 indexed orderId, address indexed user, address indexed tokenIn, address tokenOut, uint256 maxAmountIn, uint256 minInterval, uint256 validAfter, uint256 validUntil)",
  "event OrderCancelled(bytes32 indexed orderId, address indexed user)",
  "function orderAuthorizations(bytes32) view returns (address user, address tokenIn, address tokenOut, uint256 maxAmountIn, uint256 minInterval, uint256 validAfter, uint256 validUntil, uint256 lastExecutedAt, bool active)",
  "function executeOrder(bytes32 orderId, uint256 amountIn, uint256 minAmountOut, address routeTarget, address approvalSpender, bytes calldata routeCalldata) returns (uint256 amountOut)",
];

const CURVE_ABI = [
  "function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)",
  "function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) returns (uint256)",
];

const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
];

// ─── Provider & signer ──────────────────────────────────────────────────────

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const executor = new ethers.Contract(EXECUTOR, EXECUTOR_ABI, wallet);
const curve = new ethers.Contract(CURVE_ROUTER, CURVE_ABI, provider);

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface OrderAuth {
  user: string;
  tokenIn: string;
  tokenOut: string;
  maxAmountIn: bigint;
  minInterval: bigint;
  validAfter: bigint;
  validUntil: bigint;
  lastExecutedAt: bigint;
  active: boolean;
}

function parseAuth(raw: ethers.Result): OrderAuth {
  return {
    user: raw[0],
    tokenIn: raw[1],
    tokenOut: raw[2],
    maxAmountIn: BigInt(raw[3]),
    minInterval: BigInt(raw[4]),
    validAfter: BigInt(raw[5]),
    validUntil: BigInt(raw[6]),
    lastExecutedAt: BigInt(raw[7]),
    active: Boolean(raw[8]),
  };
}

function getCurveIndices(tokenIn: string, tokenOut: string): [number, number] | null {
  const i = CURVE_COIN_INDEX[tokenIn.toLowerCase()];
  const j = CURVE_COIN_INDEX[tokenOut.toLowerCase()];
  if (i === undefined || j === undefined) return null;
  return [i, j];
}

function applySlippage(amount: bigint, bps: number): bigint {
  return amount - (amount * BigInt(bps)) / 10_000n;
}

function fmt6(value: bigint): string {
  return ethers.formatUnits(value, 6);
}

// ─── Discover all order IDs from on-chain events ────────────────────────────

async function discoverOrderIds(): Promise<Set<string>> {
  const currentBlock = await provider.getBlockNumber();
  const orderIds = new Set<string>();

  console.log(`Scanning OrderAuthorized events from block ${DEPLOYMENT_BLOCK} to ${currentBlock}…`);

  // Scan in chunks of 2k blocks with delays to avoid RPC rate limits
  const CHUNK = 2_000;
  for (let from = DEPLOYMENT_BLOCK; from <= currentBlock; from += CHUNK) {
    const to = Math.min(from + CHUNK - 1, currentBlock);
    try {
      const filter = executor.filters.OrderAuthorized();
      const events = await executor.queryFilter(filter, from, to);
      for (const event of events) {
        const parsed = executor.interface.parseLog({
          topics: event.topics as string[],
          data: event.data,
        });
        if (parsed) {
          orderIds.add(parsed.args[0]); // orderId
        }
      }
    } catch (err) {
      console.log(`  ⚠️ Scan chunk ${from}-${to} failed, retrying…`);
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const filter = executor.filters.OrderAuthorized();
        const events = await executor.queryFilter(filter, from, to);
        for (const event of events) {
          const parsed = executor.interface.parseLog({
            topics: event.topics as string[],
            data: event.data,
          });
          if (parsed) {
            orderIds.add(parsed.args[0]);
          }
        }
      } catch {
        console.log(`  ❌ Chunk ${from}-${to} failed on retry, skipping.`);
      }
    }
    // Small delay between chunks to stay within rate limits
    if (from + CHUNK <= currentBlock) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  console.log(`Found ${orderIds.size} order(s) on-chain.\n`);
  return orderIds;
}

// ─── Check & execute a single order ─────────────────────────────────────────

async function tryExecuteOrder(orderId: string): Promise<boolean> {
  // Read on-chain state
  const raw = await executor.orderAuthorizations(orderId);
  const auth = parseAuth(raw);

  if (!auth.active) {
    return false; // Cancelled or never existed
  }

  const now = BigInt(Math.floor(Date.now() / 1000));

  // Check timing constraints
  if (now < auth.validAfter) {
    console.log(`  ⏳ Not valid yet (starts ${new Date(Number(auth.validAfter) * 1000).toISOString()})`);
    return false;
  }

  if (auth.validUntil > 0n && now > auth.validUntil) {
    console.log(`  ⏰ Expired (ended ${new Date(Number(auth.validUntil) * 1000).toISOString()})`);
    return false;
  }

  if (auth.lastExecutedAt > 0n && now < auth.lastExecutedAt + auth.minInterval) {
    const nextAt = auth.lastExecutedAt + auth.minInterval;
    console.log(`  ⏳ Too soon (next eligible at ${new Date(Number(nextAt) * 1000).toISOString()})`);
    return false;
  }

  // Check user has sufficient balance and allowance
  const tokenIn = new ethers.Contract(auth.tokenIn, ERC20_ABI, provider);
  const [balance, allowance] = await Promise.all([
    tokenIn.balanceOf(auth.user),
    tokenIn.allowance(auth.user, EXECUTOR),
  ]);

  const amountIn = auth.maxAmountIn;

  if (BigInt(balance) < amountIn) {
    console.log(`  ⚠️  Insufficient balance: ${fmt6(BigInt(balance))} < ${fmt6(amountIn)}`);
    return false;
  }

  if (BigInt(allowance) < amountIn) {
    console.log(`  ⚠️  Insufficient allowance: ${fmt6(BigInt(allowance))} < ${fmt6(amountIn)}`);
    return false;
  }

  // Get Curve indices for this token pair
  const indices = getCurveIndices(auth.tokenIn, auth.tokenOut);
  if (!indices) {
    console.log(`  ❌ No Curve route for ${auth.tokenIn} → ${auth.tokenOut}`);
    return false;
  }
  const [i, j] = indices;

  // Quote via Curve get_dy
  let expectedOut: bigint;
  try {
    expectedOut = BigInt(await curve.get_dy(i, j, amountIn));
  } catch (err) {
    console.log(`  ❌ Curve quote failed:`, (err as Error).message?.slice(0, 80));
    return false;
  }

  const minAmountOut = applySlippage(expectedOut, SLIPPAGE_BPS);

  console.log(`  📊 Quote: ${fmt6(amountIn)} → ${fmt6(expectedOut)} (min: ${fmt6(minAmountOut)})`);

  if (minAmountOut === 0n) {
    console.log(`  ❌ Min output is zero, skipping.`);
    return false;
  }

  // Encode Curve exchange() calldata
  const curveInterface = new ethers.Interface(CURVE_ABI);
  const routeCalldata = curveInterface.encodeFunctionData("exchange", [
    i,
    j,
    amountIn,
    minAmountOut,
  ]);

  // Execute the order
  console.log(`  🚀 Executing order…`);
  try {
    const tx: ContractTransactionResponse = await executor.executeOrder(
      orderId,
      amountIn,
      minAmountOut,
      CURVE_ROUTER,
      CURVE_ROUTER, // approvalSpender = same as routeTarget for Curve
      routeCalldata,
    );
    console.log(`  📤 Tx submitted: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`  ✅ Executed in block ${receipt?.blockNumber}. Gas used: ${receipt?.gasUsed?.toString()}`);
    return true;
  } catch (err) {
    const msg = (err as Error).message || String(err);
    // Extract revert reason if available
    if (msg.includes("execution reverted")) {
      console.log(`  ❌ Reverted:`, msg.slice(0, 200));
    } else {
      console.log(`  ❌ Failed:`, msg.slice(0, 200));
    }
    return false;
  }
}

// ─── Main loop ──────────────────────────────────────────────────────────────

async function runOnce() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Relayer scan at ${new Date().toISOString()}`);
  console.log(`Relayer address: ${wallet.address}`);
  console.log(`${"═".repeat(60)}\n`);

  const orderIds = await discoverOrderIds();

  let executed = 0;
  let skipped = 0;

  for (const orderId of orderIds) {
    const shortId = `${orderId.slice(0, 10)}…${orderId.slice(-6)}`;
    console.log(`Order ${shortId}:`);

    const didExecute = await tryExecuteOrder(orderId);
    if (didExecute) executed++;
    else skipped++;
  }

  console.log(`\nScan complete: ${executed} executed, ${skipped} skipped.\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const loopMode = args.includes("--loop");
  const intervalIndex = args.indexOf("--interval");
  const intervalSec = intervalIndex >= 0 ? parseInt(args[intervalIndex + 1], 10) : 30;

  if (loopMode) {
    console.log(`🔁 Running in loop mode (every ${intervalSec}s). Press Ctrl+C to stop.\n`);
    while (true) {
      try {
        await runOnce();
      } catch (err) {
        console.error("Scan error:", (err as Error).message);
      }
      await new Promise((r) => setTimeout(r, intervalSec * 1000));
    }
  } else {
    await runOnce();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
