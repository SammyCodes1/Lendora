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

function updateJson(filePath: string, updates: Record<string, string>) {
  try {
    let data = {};
    if (fs.existsSync(filePath)) {
      data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
    for (const key in updates) {
      (data as any)[key] = updates[key];
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`Updated ${filePath}`);
  } catch (e) {
    console.error(`Failed to update ${filePath}:`, e);
  }
}

async function main() {
  const deployPath = path.join(__dirname, "../../contracts/deployments/arc-mainnet.json");
  const data = JSON.parse(fs.readFileSync(deployPath, "utf-8"));
  
  const providerAddress = data.addressesProvider;
  const newOracleAddress = data.ChainlinkPriceOracle;
  
  if (!providerAddress || !newOracleAddress) {
    throw new Error("Missing addresses in deployment JSON");
  }

  const lendingPoolAddress = data.lendingPool;
  const OLD_ORACLE = "0xbee561CF55b5976213325EdBa41839b6277908de";

  console.log(`Switching priceOracle to ${newOracleAddress}...`);

  const providerAbi = ["function setPriceOracle(address) external"];
  const providerContract = await ethers.getContractAt(providerAbi, providerAddress);
  
  const poolAbi = ["function setPriceOracle(address) external", "function setFallbackPriceOracle(address) external"];
  const poolContract = await ethers.getContractAt(poolAbi, lendingPoolAddress);

  console.log("Setting price oracle on LendingPool...");
  const tx1 = await retry(() => poolContract.setPriceOracle(newOracleAddress));
  await retry(() => tx1.wait());

  console.log("Setting price oracle on AddressesProvider...");
  const tx2 = await retry(() => providerContract.setPriceOracle(newOracleAddress));
  await retry(() => tx2.wait());
  
  console.log("Setting fallback price oracle on LendingPool...");
  const tx3 = await retry(() => poolContract.setFallbackPriceOracle(OLD_ORACLE));
  await retry(() => tx3.wait());

  console.log("Successfully switched price oracle");

  const deploymentPaths = [
    path.join(__dirname, "../../contracts/deployments/arc-mainnet.json"),
    path.join(__dirname, "../../constants/deployments-mainnet.json"),
    path.join(__dirname, "../../frontend/constants/deployments-mainnet.json"),
    path.join(__dirname, "../../constants/deployments.json"),
    path.join(__dirname, "../../frontend/constants/deployments.json")
  ];

  for (const p of deploymentPaths) {
    updateJson(p, {
      priceOracle: newOracleAddress,
      fallbackPriceOracle: OLD_ORACLE
    });
  }
  
  console.log("Switch completed successfully.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
