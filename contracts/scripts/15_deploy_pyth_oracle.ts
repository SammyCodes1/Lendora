import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * 15_deploy_pyth_oracle.ts
 * ────────────────────────
 * Deploys PythPriceOracle on Arc Testnet and registers USDC + EURC price feeds.
 * Does NOT switch LendingPool's oracle yet — that's script 16.
 *
 * Usage:
 *   npx hardhat run scripts/15_deploy_pyth_oracle.ts --network arc_testnet
 */

// ── Confirmed from Pyth docs (Arc Network Testnet)
// https://docs.pyth.network/price-feeds/core/contract-addresses/evm
// NOTE: Do NOT use 0x2880ab12030f82d2f6F2c24c885E33d45EC17b43 — that has no code on Arc.
const PYTH_ARC_TESTNET = "0x2880aB155794e7179c9eE2e38200202908C17B43";

// ── Confirmed from https://pyth.network/developers/price-feed-ids ──
const USDC_USD_FEED_ID = "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";
const EUR_USD_FEED_ID  = "0xa995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b";

// ── ArcLend deployed asset addresses ──
const USDC_ASSET = "0x3600000000000000000000000000000000000000";
const EURC_ASSET = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

async function main() {
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY is required — see contracts/.env");
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deploying PythPriceOracle with owner:", deployer.address);

  // ── Deploy ─────────────────────────────────────────────────────────────
  const Factory = await ethers.getContractFactory("PythPriceOracle");
  const oracle = await Factory.deploy(PYTH_ARC_TESTNET);
  await oracle.waitForDeployment();

  const oracleAddress = await oracle.getAddress();
  console.log("✅ PythPriceOracle deployed at:", oracleAddress);
  console.log("   Owner:", await oracle.owner());
  console.log("   Pyth contract:", await oracle.pyth());

  // ── Register price feeds ───────────────────────────────────────────────
  console.log("\n── Registering price feeds ──\n");

  console.log("[1/2] Registering USDC/USD feed…");
  const tx1 = await oracle.setPriceFeedId(USDC_ASSET, USDC_USD_FEED_ID);
  await tx1.wait();
  console.log("  ✓ tx:", tx1.hash);

  console.log("[2/2] Registering EURC → EUR/USD feed…");
  const tx2 = await oracle.setPriceFeedId(EURC_ASSET, EUR_USD_FEED_ID);
  await tx2.wait();
  console.log("  ✓ tx:", tx2.hash);

  // ── Verify registrations ───────────────────────────────────────────────
  console.log("\n── Verification ──");
  console.log("  priceFeedIds[USDC]:", await oracle.priceFeedIds(USDC_ASSET));
  console.log("  priceFeedIds[EURC]:", await oracle.priceFeedIds(EURC_ASSET));
  console.log("  maxStaleness:", (await oracle.maxStaleness()).toString(), "seconds");

  // ── Update deployments ─────────────────────────────────────────────────
  const deploymentsPath = path.resolve(__dirname, "../../frontend/constants/deployments.json");
  if (fs.existsSync(deploymentsPath)) {
    const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
    deployments.PythPriceOracle = oracleAddress;
    deployments.pythContract = PYTH_ARC_TESTNET;
    fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2) + "\n");
    console.log("\n✅ Updated frontend/constants/deployments.json");
  }

  const contractDeploymentsPath = path.resolve(__dirname, "../deployments/arc-testnet.json");
  if (fs.existsSync(contractDeploymentsPath)) {
    const deployments = JSON.parse(fs.readFileSync(contractDeploymentsPath, "utf8"));
    deployments.PythPriceOracle = oracleAddress;
    deployments.pythContract = PYTH_ARC_TESTNET;
    fs.writeFileSync(contractDeploymentsPath, JSON.stringify(deployments, null, 2) + "\n");
    console.log("✅ Updated contracts/deployments/arc-testnet.json");
  }

  console.log("\n══════════════════════════════════════════════════════════");
  console.log("⚠️  PythPriceOracle is deployed but NOT yet active.");
  console.log("    MockPriceOracle remains the active oracle.");
  console.log("    Next steps:");
  console.log("    1. Run prime_pyth_oracle.ts to seed initial prices");
  console.log("    2. Verify prices are sane");
  console.log("    3. Run 16_switch_to_pyth_oracle.ts to cut over");
  console.log(`  PythPriceOracle: ${oracleAddress}`);
  console.log("══════════════════════════════════════════════════════════\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
