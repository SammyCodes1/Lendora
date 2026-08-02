import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * prime_pyth_oracle.ts
 * ─────────────────────
 * One-time script to fetch initial price data from Pyth Hermes and call
 * PythPriceOracle.refreshPrice(), so the oracle has valid prices before
 * LendingPool is switched over.
 *
 * Usage:
 *   npx hardhat run scripts/prime_pyth_oracle.ts --network arc_testnet
 *
 * Optional env:
 *   PYTH_ORACLE_ADDRESS  — overrides deployments.json PythPriceOracle
 *   PYTH_HERMES_URL      — defaults to https://hermes.pyth.network
 */

// ── Confirmed from Pyth docs ──
const USDC_USD_FEED_ID = "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";
const EUR_USD_FEED_ID  = "0xa995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b";

// ArcLend asset addresses
const USDC_ASSET = "0x3600000000000000000000000000000000000000";
const EURC_ASSET = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

// Hermes endpoint (mainnet Hermes serves the same feed IDs used on Arc Testnet Pyth)
const HERMES_URL = process.env.PYTH_HERMES_URL || "https://hermes.pyth.network";

function resolveOracleAddress(): string {
  if (process.env.PYTH_ORACLE_ADDRESS) {
    return process.env.PYTH_ORACLE_ADDRESS;
  }

  const candidates = [
    path.resolve(__dirname, "../../frontend/constants/deployments.json"),
    path.resolve(__dirname, "../deployments/arc-testnet.json"),
  ];

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const deployments = JSON.parse(fs.readFileSync(file, "utf8"));
    if (deployments.PythPriceOracle) {
      return deployments.PythPriceOracle as string;
    }
  }

  throw new Error(
    "Set PYTH_ORACLE_ADDRESS or deploy first (scripts/15_deploy_pyth_oracle.ts) so deployments.json has PythPriceOracle",
  );
}

async function main() {
  const oracleAddress = resolveOracleAddress();

  const [signer] = await ethers.getSigners();
  console.log("Priming PythPriceOracle at:", oracleAddress);
  console.log("Signer:", signer.address);

  // ── Fetch latest price updates from Hermes ──────────────────────────────
  const feedIds = [
    USDC_USD_FEED_ID.replace("0x", ""),
    EUR_USD_FEED_ID.replace("0x", ""),
  ];

  const hermesUrl = `${HERMES_URL}/v2/updates/price/latest?` +
    feedIds.map(id => `ids[]=${id}`).join("&");

  console.log("\nFetching from Hermes:", hermesUrl);
  const response = await fetch(hermesUrl);
  if (!response.ok) {
    throw new Error(`Hermes API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const updateData: string[] = data.binary.data.map((d: string) => "0x" + d);
  console.log(`Received ${updateData.length} price update(s)`);

  // ── Get the oracle contract ─────────────────────────────────────────────
  const oracle = await ethers.getContractAt("PythPriceOracle", oracleAddress);

  // ── Calculate fee ───────────────────────────────────────────────────────
  const fee = await oracle.getRefreshFee(updateData);
  console.log("Update fee:", ethers.formatEther(fee), "native USDC (18 decimals)");

  // ── Submit price update ─────────────────────────────────────────────────
  console.log("\nSubmitting refreshPrice transaction…");
  const tx = await oracle.refreshPrice(updateData, { value: fee });
  const receipt = await tx.wait();
  console.log("✅ Price refresh tx:", tx.hash);
  console.log("   Gas used:", receipt?.gasUsed?.toString());

  // ── Verify prices ──────────────────────────────────────────────────────
  console.log("\n── Price Verification ──");

  try {
    const [usdcPrice, usdcDecimals] = await oracle.getPrice(USDC_ASSET);
    console.log(`  USDC/USD: ${ethers.formatUnits(usdcPrice, usdcDecimals)} (raw: ${usdcPrice}, decimals: ${usdcDecimals})`);
  } catch (e: any) {
    console.error("  ❌ USDC/USD getPrice failed:", e.message);
  }

  try {
    const [eurcPrice, eurcDecimals] = await oracle.getPrice(EURC_ASSET);
    console.log(`  EURC/USD: ${ethers.formatUnits(eurcPrice, eurcDecimals)} (raw: ${eurcPrice}, decimals: ${eurcDecimals})`);
  } catch (e: any) {
    console.error("  ❌ EURC/USD getPrice failed:", e.message);
  }

  console.log("\n══════════════════════════════════════════════════════════");
  console.log("Oracle is primed. Verify prices look sane before cutover.");
  console.log("══════════════════════════════════════════════════════════\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
