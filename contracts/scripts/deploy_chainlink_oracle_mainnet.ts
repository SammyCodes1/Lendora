import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * deploy_chainlink_oracle_mainnet.ts
 * ─────────────────────────────────
 * Deploys ChainlinkPriceOracle on Arc Mainnet (Chain ID 5042)
 * and switches LendingPool's primary oracle to ChainlinkPriceOracle.
 *
 * Arc Mainnet uses Chainlink Data Feeds directly (no API keys, zero keeper cost).
 *
 * Usage:
 *   npx hardhat run scripts/deploy_chainlink_oracle_mainnet.ts --network arc_mainnet
 */

const LENDING_POOL_ADDRESS = "0x3Fa2817A41F8a00583A7c73DaB4Ab2DB7237266A";
const USDC_ASSET = "0x3600000000000000000000000000000000000000";
const EURC_ASSET = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1";
const FALLBACK_ORACLE = "0x13b607B33F034c14B401da60a9df1A69E4C4AA56";

async function main() {
  const [deployer] = await ethers.getSigners();
  const provider = ethers.provider;
  const balance = await provider.getBalance(deployer.address);
  const network = await provider.getNetwork();

  console.log("==================================================");
  console.log("   Deploying ChainlinkPriceOracle on Arc Mainnet  ");
  console.log("==================================================");
  console.log("Network Chain ID :", network.chainId.toString());
  console.log("Deployer Address :", deployer.address);
  console.log("Deployer Balance :", ethers.formatUnits(balance, 18), "native USDC");

  if (balance === 0n) {
    throw new Error("Deployer balance is 0. Please fund deployer account.");
  }

  // 1. Deploy ChainlinkPriceOracle
  console.log("\n[1/4] Deploying ChainlinkPriceOracle contract...");
  const Factory = await ethers.getContractFactory("ChainlinkPriceOracle");
  const oracle = await Factory.deploy(USDC_ASSET, EURC_ASSET);
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log("  ✅ ChainlinkPriceOracle deployed at:", oracleAddress);
  console.log("     Tx hash:", oracle.deploymentTransaction()?.hash);

  // 2. Verify baseline prices from the new oracle
  console.log("\n[2/4] Verifying price queries from ChainlinkPriceOracle...");
  const [usdcPrice, usdcDecimals] = await oracle.getPrice(USDC_ASSET);
  const [eurcPrice, eurcDecimals] = await oracle.getPrice(EURC_ASSET);

  console.log(`  USDC: ${ethers.formatUnits(usdcPrice, usdcDecimals)} USD (${usdcPrice} raw, ${usdcDecimals} decimals)`);
  console.log(`  EURC: ${ethers.formatUnits(eurcPrice, eurcDecimals)} USD (${eurcPrice} raw, ${eurcDecimals} decimals)`);

  if (usdcPrice < 90_000_000n || usdcPrice > 110_000_000n) {
    throw new Error(`Sanity check failed for USDC price: ${usdcPrice}`);
  }
  if (eurcPrice < 90_000_000n || eurcPrice > 130_000_000n) {
    throw new Error(`Sanity check failed for EURC price: ${eurcPrice}`);
  }
  console.log("  ✅ Price sanity checks passed.");

  // 3. Connect to LendingPool and switch primary price oracle
  console.log("\n[3/4] Connecting to LendingPool...");
  const lendingPool = await ethers.getContractAt("LendingPool", LENDING_POOL_ADDRESS);
  const currentPoolOracle = await lendingPool.priceOracle();
  const currentFallback = await lendingPool.fallbackPriceOracle();
  console.log("  Current LendingPool oracle         :", currentPoolOracle);
  console.log("  Current LendingPool fallback oracle:", currentFallback);

  console.log("  Setting LendingPool primary oracle to ChainlinkPriceOracle...");
  const setOracleTx = await lendingPool.setPriceOracle(oracleAddress);
  const setOracleReceipt = await setOracleTx.wait();
  console.log("  ✅ Primary oracle updated. Tx:", setOracleReceipt?.hash);

  // Ensure fallback oracle is configured for backup resilience
  if (currentFallback.toLowerCase() === "0x0000000000000000000000000000000000000000") {
    console.log("  Setting fallback oracle to:", FALLBACK_ORACLE);
    const setFallbackTx = await lendingPool.setFallbackPriceOracle(FALLBACK_ORACLE);
    await setFallbackTx.wait();
    console.log("  ✅ Fallback oracle set.");
  }

  // Verify switch
  const updatedOracle = await lendingPool.priceOracle();
  console.log("  Verified LendingPool.priceOracle() :", updatedOracle);
  if (updatedOracle.toLowerCase() !== oracleAddress.toLowerCase()) {
    throw new Error("Mismatch between deployed oracle and LendingPool.priceOracle()!");
  }
  console.log("  ✅ LendingPool is now successfully wired to ChainlinkPriceOracle!");

  // 4. Update deployment files across repo
  console.log("\n[4/4] Updating deployment manifest files...");
  const filesToUpdate = [
    path.resolve(__dirname, "../deployments/arc-mainnet.json"),
    path.resolve(__dirname, "../../constants/deployments-mainnet.json"),
    path.resolve(__dirname, "../../constants/deployments.json"),
    path.resolve(__dirname, "../../frontend/constants/deployments-mainnet.json"),
    path.resolve(__dirname, "../../frontend/constants/deployments.json"),
  ];

  for (const filePath of filesToUpdate) {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      data.priceOracle = oracleAddress;
      data.ChainlinkPriceOracle = oracleAddress;
      if (!data.fallbackPriceOracle || data.fallbackPriceOracle === "0x0000000000000000000000000000000000000000") {
        data.fallbackPriceOracle = FALLBACK_ORACLE;
      }
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
      console.log(`  Updated: ${filePath}`);
    } else {
      console.log(`  Skipped (not found): ${filePath}`);
    }
  }

  console.log("\n==================================================");
  console.log("🎉 SUCCESS: Chainlink Price Oracle live on Arc Mainnet!");
  console.log("   Contract Address:", oracleAddress);
  console.log("   LendingPool     :", LENDING_POOL_ADDRESS);
  console.log("==================================================\n");
}

main().catch((error) => {
  console.error("\n❌ Deployment failed:", error);
  process.exitCode = 1;
});
