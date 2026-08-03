import { ethers } from "hardhat";

/**
 * setup_executor.ts
 * ─────────────────
 * One-time admin setup for RecurringOrderExecutor on Arc Testnet.
 *
 * Registers:
 *   1. The deployer address as an approved relayer
 *   2. Curve stable pool as an approved route target
 *   3. Curve stable pool as an approved approval spender
 *
 * Usage:
 *   npx hardhat run scripts/setup_executor.ts --network arc_testnet
 */

const EXECUTOR = "0x884C8C2E3F4a2232797C54be029a8a87e31d75e4";

// DEX routers already live on Arc Testnet (from lib/arcDex.ts)
const CURVE_ROUTER = "0x2d84d79c852f6842abe0304b70bbaa1506add457";
const SYNTHRA_V3_ROUTER = "0xA545bCB1Bd7985c59ea162aB1748A0803434C31b";

async function main() {
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY is required — see contracts/.env");
  }

  const [deployer] = await ethers.getSigners();
  console.log("Setting up RecurringOrderExecutor with:", deployer.address);
  console.log("Executor address:", EXECUTOR);

  const executor = await ethers.getContractAt(
    "RecurringOrderExecutor",
    EXECUTOR,
    deployer,
  );

  // ── 1. Register deployer as a relayer ──────────────────────────────────
  console.log("\n[1/4] Setting deployer as relayer…");
  const tx1 = await executor.setRelayer(deployer.address, true);
  await tx1.wait();
  console.log("  ✓ Relayer set:", deployer.address, "tx:", tx1.hash);

  // ── 2. Whitelist Curve as route target ─────────────────────────────────
  console.log("[2/4] Whitelisting Curve stable pool as route target…");
  const tx2 = await executor.setRouteTarget(CURVE_ROUTER, true);
  await tx2.wait();
  console.log("  ✓ Route target set:", CURVE_ROUTER, "tx:", tx2.hash);

  // ── 3. Whitelist Curve as approval spender ─────────────────────────────
  console.log("[3/4] Whitelisting Curve stable pool as approval spender…");
  const tx3 = await executor.setApprovalSpender(CURVE_ROUTER, true);
  await tx3.wait();
  console.log("  ✓ Approval spender set:", CURVE_ROUTER, "tx:", tx3.hash);

  // ── 4. (Optional) Also whitelist Synthra V3 ────────────────────────────
  console.log("[4/4] Whitelisting Synthra V3 router as route target & spender…");
  const tx4 = await executor.setRouteTarget(SYNTHRA_V3_ROUTER, true);
  await tx4.wait();
  console.log("  ✓ V3 route target set:", SYNTHRA_V3_ROUTER, "tx:", tx4.hash);

  const tx5 = await executor.setApprovalSpender(SYNTHRA_V3_ROUTER, true);
  await tx5.wait();
  console.log("  ✓ V3 approval spender set:", SYNTHRA_V3_ROUTER, "tx:", tx5.hash);

  // ── Verify ─────────────────────────────────────────────────────────────
  console.log("\n── Verification ──");
  console.log("  relayers[deployer]:", await executor.relayers(deployer.address));
  console.log("  routeTargets[curve]:", await executor.routeTargets(CURVE_ROUTER));
  console.log("  approvalSpenders[curve]:", await executor.approvalSpenders(CURVE_ROUTER));
  console.log("  routeTargets[v3]:", await executor.routeTargets(SYNTHRA_V3_ROUTER));
  console.log("  approvalSpenders[v3]:", await executor.approvalSpenders(SYNTHRA_V3_ROUTER));

  console.log("\n✅ Executor setup complete. You can now run the relayer.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
