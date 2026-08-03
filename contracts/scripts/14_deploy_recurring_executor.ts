import { ethers } from "hardhat";

/**
 * 14_deploy_recurring_executor.ts
 * ────────────────────────────────
 * Deploys a fresh RecurringOrderExecutor with the deployer as owner,
 * then runs the full admin setup (relayer + route targets + spenders).
 *
 * Usage:
 *   npx hardhat run scripts/14_deploy_recurring_executor.ts --network arc_testnet
 */

// DEX routers already live on Arc Testnet
const CURVE_ROUTER = "0x2d84d79c852f6842abe0304b70bbaa1506add457";
const SYNTHRA_V3_ROUTER = "0xA545bCB1Bd7985c59ea162aB1748A0803434C31b";

async function main() {
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY is required — see contracts/.env");
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deploying RecurringOrderExecutor with owner:", deployer.address);

  // ── Deploy ─────────────────────────────────────────────────────────────
  const Factory = await ethers.getContractFactory("RecurringOrderExecutor");
  const executor = await Factory.deploy(deployer.address);
  await executor.waitForDeployment();

  const address = await executor.getAddress();
  console.log("✅ RecurringOrderExecutor deployed at:", address);
  console.log("   Owner:", await executor.owner());

  // ── Admin setup ────────────────────────────────────────────────────────
  console.log("\n── Running admin setup ──\n");

  console.log("[1/5] Setting deployer as relayer…");
  const tx1 = await executor.setRelayer(deployer.address, true);
  await tx1.wait();
  console.log("  ✓ tx:", tx1.hash);

  console.log("[2/5] Whitelisting Curve as route target…");
  const tx2 = await executor.setRouteTarget(CURVE_ROUTER, true);
  await tx2.wait();
  console.log("  ✓ tx:", tx2.hash);

  console.log("[3/5] Whitelisting Curve as approval spender…");
  const tx3 = await executor.setApprovalSpender(CURVE_ROUTER, true);
  await tx3.wait();
  console.log("  ✓ tx:", tx3.hash);

  console.log("[4/5] Whitelisting Synthra V3 as route target…");
  const tx4 = await executor.setRouteTarget(SYNTHRA_V3_ROUTER, true);
  await tx4.wait();
  console.log("  ✓ tx:", tx4.hash);

  console.log("[5/5] Whitelisting Synthra V3 as approval spender…");
  const tx5 = await executor.setApprovalSpender(SYNTHRA_V3_ROUTER, true);
  await tx5.wait();
  console.log("  ✓ tx:", tx5.hash);

  // ── Verify ─────────────────────────────────────────────────────────────
  console.log("\n── Verification ──");
  console.log("  owner:", await executor.owner());
  console.log("  relayers[deployer]:", await executor.relayers(deployer.address));
  console.log("  routeTargets[curve]:", await executor.routeTargets(CURVE_ROUTER));
  console.log("  approvalSpenders[curve]:", await executor.approvalSpenders(CURVE_ROUTER));
  console.log("  routeTargets[v3]:", await executor.routeTargets(SYNTHRA_V3_ROUTER));
  console.log("  approvalSpenders[v3]:", await executor.approvalSpenders(SYNTHRA_V3_ROUTER));

  console.log("\n══════════════════════════════════════════════════════════");
  console.log("UPDATE these files with the new address:");
  console.log(`  constants/deployments.json  →  "RecurringOrderExecutor": "${address}"`);
  console.log("══════════════════════════════════════════════════════════\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
