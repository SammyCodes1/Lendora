import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function retry<T>(fn: () => Promise<T>, retries = 5, delay = 2000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      console.warn(`Retry ${i + 1}/${retries} failed: ${e.message}`);
      if (i === retries - 1) throw e;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error("Unreachable");
}

async function main() {
  const deployPath = path.join(__dirname, "../../contracts/deployments/arc-mainnet.json");
  if (!fs.existsSync(deployPath)) {
    throw new Error(`Deployment file not found at ${deployPath}`);
  }

  const data = JSON.parse(fs.readFileSync(deployPath, "utf-8"));
  const oracleAddress = data.ChainlinkPriceOracle;
  if (!oracleAddress) {
    throw new Error("ChainlinkPriceOracle address not found in deployment JSON");
  }

  console.log(`Verifying ChainlinkPriceOracle at ${oracleAddress}`);

  const oracle = await ethers.getContractAt("ChainlinkPriceOracle", oracleAddress);

  const USDC = "0x3600000000000000000000000000000000000000";
  const EURC = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1";

  try {
    const usdcRes = await retry(() => oracle.getPrice(USDC));
    console.log(`USDC Price: ${usdcRes.price.toString()} (Decimals: ${usdcRes.decimals}) - Expecting ~$1.00 (100000000 in 8 decimals)`);
  } catch (e: any) {
    console.error(`Failed to get USDC price:`, e.message);
  }

  try {
    const eurcRes = await retry(() => oracle.getPrice(EURC));
    console.log(`EURC Price: ${eurcRes.price.toString()} (Decimals: ${eurcRes.decimals}) - Expecting ~$1.08`);
  } catch (e: any) {
    console.error(`Failed to get EURC price:`, e.message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
