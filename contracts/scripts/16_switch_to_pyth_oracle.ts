import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * 16_switch_to_pyth_oracle.ts
 * ────────────────────────────
 * Switches LendingPool's primary oracle from MockPriceOracle to PythPriceOracle.
 * Also demotes MockPriceOracle to fallback (if no fallback is already set).
 *
 * Prerequisites:
 *   1. PythPriceOracle is deployed (script 15)
 *   2. Oracle has been primed with initial prices (prime_pyth_oracle.ts)
 *   3. Keeper is running and prices are being refreshed
 *
 * Usage:
 *   npx hardhat run scripts/16_switch_to_pyth_oracle.ts --network arc_testnet
 */

async function main() {
  // Load current deployment addresses
  const deploymentsPath = path.resolve(__dirname, "../../frontend/constants/deployments.json");
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const pythOracleAddress =
    process.env.PYTH_ORACLE_ADDRESS || (deployments.PythPriceOracle as string | undefined);
  if (!pythOracleAddress) {
    throw new Error(
      "Set PYTH_ORACLE_ADDRESS or ensure deployments.json contains PythPriceOracle from script 15",
    );
  }

  const lendingPoolAddress = deployments.lendingPool;
  const currentOracleAddress = deployments.priceOracle;

  const [deployer] = await ethers.getSigners();
  console.log("Switching oracle with owner:", deployer.address);
  console.log("LendingPool:", lendingPoolAddress);
  console.log("Current oracle (MockPriceOracle):", currentOracleAddress);
  console.log("New oracle (PythPriceOracle):", pythOracleAddress);

  const lendingPool = await ethers.getContractAt("LendingPool", lendingPoolAddress);

  // ── Verify PythPriceOracle has valid prices before switching ────────────
  console.log("\n── Pre-flight price check ──");
  const pythOracle = await ethers.getContractAt("PythPriceOracle", pythOracleAddress);
  const usdc = deployments.markets.USDC.asset;
  const eurc = deployments.markets.EURC.asset;

  const [usdcPrice] = await pythOracle.getPrice(usdc);
  const [eurcPrice] = await pythOracle.getPrice(eurc);
  console.log("  USDC/USD:", ethers.formatUnits(usdcPrice, 8));
  console.log("  EURC/USD:", ethers.formatUnits(eurcPrice, 8));

  // Sanity: USDC should be ~$1, EURC should be ~$1.05-1.15
  if (usdcPrice < 95_000_000n || usdcPrice > 105_000_000n) {
    throw new Error(`USDC price ${usdcPrice} looks wrong — aborting`);
  }
  if (eurcPrice < 90_000_000n || eurcPrice > 125_000_000n) {
    throw new Error(`EURC price ${eurcPrice} looks wrong — aborting`);
  }
  console.log("  ✓ Prices look sane\n");

  // ── Switch primary oracle ──────────────────────────────────────────────
  console.log("[1/2] Setting PythPriceOracle as primary oracle…");
  const tx1 = await lendingPool.setPriceOracle(pythOracleAddress);
  await tx1.wait();
  console.log("  ✓ tx:", tx1.hash);

  // ── Set MockPriceOracle as fallback ────────────────────────────────────
  console.log("[2/2] Setting MockPriceOracle as fallback oracle…");
  try {
    const tx2 = await lendingPool.setFallbackPriceOracle(currentOracleAddress);
    await tx2.wait();
    console.log("  ✓ tx:", tx2.hash);
  } catch (e: any) {
    console.log("  ⚠️ Fallback already set or skipped:", e.message?.slice(0, 100));
  }

  // ── Verify ─────────────────────────────────────────────────────────────
  console.log("\n── Post-switch verification ──");
  const newOracle = await lendingPool.priceOracle();
  console.log("  LendingPool.priceOracle():", newOracle);
  console.log("  Expected:", pythOracleAddress);
  console.log("  Match:", newOracle.toLowerCase() === pythOracleAddress.toLowerCase() ? "✅" : "❌");

  // ── Update deployments ─────────────────────────────────────────────────
  deployments.priceOracle = pythOracleAddress;
  deployments.mockPriceOracle_deprecated = currentOracleAddress;
  deployments.fallbackPriceOracle = currentOracleAddress;
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2) + "\n");
  console.log("\n✅ Updated deployments.json");

  const contractDeploymentsPath = path.resolve(__dirname, "../deployments/arc-testnet.json");
  if (fs.existsSync(contractDeploymentsPath)) {
    const cdep = JSON.parse(fs.readFileSync(contractDeploymentsPath, "utf8"));
    cdep.priceOracle = pythOracleAddress;
    cdep.mockPriceOracle_deprecated = currentOracleAddress;
    cdep.fallbackPriceOracle = currentOracleAddress;
    fs.writeFileSync(contractDeploymentsPath, JSON.stringify(cdep, null, 2) + "\n");
    console.log("✅ Updated contracts/deployments/arc-testnet.json");
  }

  console.log("\n══════════════════════════════════════════════════════════");
  console.log("✅ CUTOVER COMPLETE");
  console.log("   Primary oracle: PythPriceOracle", pythOracleAddress);
  console.log("   Fallback oracle: MockPriceOracle", currentOracleAddress, "(deprecated)");
  console.log("   To revert: call LendingPool.setPriceOracle() with MockPriceOracle address");
  console.log("══════════════════════════════════════════════════════════\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
