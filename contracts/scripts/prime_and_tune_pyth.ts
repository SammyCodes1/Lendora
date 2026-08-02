import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Raises maxStaleness (FX feeds can lag over weekends), re-primes from Hermes,
 * and prints sanity-checked prices for USDC + EURC.
 *
 * Usage:
 *   npx hardhat run scripts/prime_and_tune_pyth.ts --network arc_testnet
 */

const USDC_USD_FEED_ID =
  "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";
const EUR_USD_FEED_ID =
  "0xa995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b";
const USDC_ASSET = "0x3600000000000000000000000000000000000000";
const EURC_ASSET = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
const HERMES_URL = process.env.PYTH_HERMES_URL || "https://hermes.pyth.network";
// Align with protocol primaryMaxPriceAge (1d) + weekend FX buffer
const TARGET_STALENESS = Number(process.env.PYTH_MAX_STALENESS || 3 * 24 * 60 * 60);

function resolveOracleAddress(): string {
  if (process.env.PYTH_ORACLE_ADDRESS) return process.env.PYTH_ORACLE_ADDRESS;
  const file = path.resolve(__dirname, "../../frontend/constants/deployments.json");
  const deployments = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!deployments.PythPriceOracle) {
    throw new Error("PythPriceOracle missing from deployments.json");
  }
  return deployments.PythPriceOracle as string;
}

async function main() {
  const oracleAddress = resolveOracleAddress();
  const [signer] = await ethers.getSigners();
  console.log("Oracle:", oracleAddress);
  console.log("Signer:", signer.address);

  const oracle = await ethers.getContractAt("PythPriceOracle", oracleAddress);

  const current = await oracle.maxStaleness();
  console.log("maxStaleness current:", current.toString());
  if (current < BigInt(TARGET_STALENESS)) {
    const tx = await oracle.setMaxStaleness(TARGET_STALENESS);
    await tx.wait();
    console.log("✅ setMaxStaleness →", TARGET_STALENESS, "tx:", tx.hash);
  }

  const feedIds = [USDC_USD_FEED_ID.replace("0x", ""), EUR_USD_FEED_ID.replace("0x", "")];
  const hermesUrl =
    `${HERMES_URL}/v2/updates/price/latest?` + feedIds.map((id) => `ids[]=${id}`).join("&");
  console.log("Hermes:", hermesUrl);

  const response = await fetch(hermesUrl);
  if (!response.ok) {
    throw new Error(`Hermes API error: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as {
    binary: { data: string[] };
    parsed?: Array<{
      id: string;
      price: { price: string; expo: number; publish_time: number };
    }>;
  };

  const now = Math.floor(Date.now() / 1000);
  for (const p of data.parsed ?? []) {
    console.log(
      `  hermes ${p.id.slice(0, 12)}… price=${p.price.price} expo=${p.price.expo} age=${now - p.price.publish_time}s`,
    );
  }

  const updateData: string[] = data.binary.data.map((d) => "0x" + d);
  const fee = await oracle.getRefreshFee(updateData);
  console.log("Update fee:", fee.toString(), "wei");

  const refreshTx = await oracle.refreshPrice(updateData, {
    value: fee > 0n ? fee : 2n,
  });
  const receipt = await refreshTx.wait();
  console.log("✅ refreshPrice:", refreshTx.hash, "gas:", receipt?.gasUsed?.toString());

  console.log("\n── Oracle prices ──");
  for (const [label, asset] of [
    ["USDC", USDC_ASSET],
    ["EURC", EURC_ASSET],
  ] as const) {
    try {
      const [price, decimals] = await oracle.getPrice(asset);
      const human = ethers.formatUnits(price, decimals);
      console.log(`  ${label}: ${human} (raw ${price}, decimals ${decimals})`);
      if (label === "USDC" && (price < 95_000_000n || price > 105_000_000n)) {
        throw new Error(`USDC price ${human} out of sanity range`);
      }
      if (label === "EURC" && (price < 90_000_000n || price > 130_000_000n)) {
        throw new Error(`EURC price ${human} out of sanity range`);
      }
    } catch (e: any) {
      console.error(`  ❌ ${label}:`, e.shortMessage || e.message);
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
