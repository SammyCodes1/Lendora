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

function updateJson(filePath: string, key: string, value: string) {
  try {
    let data = {};
    if (fs.existsSync(filePath)) {
      data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
    (data as any)[key] = value;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`Updated ${filePath}`);
  } catch (e) {
    console.error(`Failed to update ${filePath}:`, e);
  }
}

async function main() {
  console.log("Deploying ChainlinkPriceOracle...");
  
  const OracleFactory = await ethers.getContractFactory("ChainlinkPriceOracle");
  const oracle = await retry(() => OracleFactory.deploy());
  await retry(() => oracle.waitForDeployment());
  const oracleAddress = await oracle.getAddress();
  
  console.log(`Deployed ChainlinkPriceOracle to: ${oracleAddress}`);

  const USDC = "0x3600000000000000000000000000000000000000";
  const USDC_FEED = "0x84EA90AC252Dc437031461836DB5164219147905";
  
  const EURC = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1";
  const EURC_FEED = "0x361b95c10b76Ca3f35C686d423e43A951755Bf23";

  console.log("Setting price feeds...");
  let tx1 = await retry(() => oracle.setPriceFeed(USDC, USDC_FEED));
  await retry(() => tx1.wait());
  console.log(`Set USDC feed`);

  let tx2 = await retry(() => oracle.setPriceFeed(EURC, EURC_FEED));
  await retry(() => tx2.wait());
  console.log(`Set EURC feed`);

  const deploymentPaths = [
    path.join(__dirname, "../../contracts/deployments/arc-mainnet.json"),
    path.join(__dirname, "../../constants/deployments-mainnet.json"),
    path.join(__dirname, "../../frontend/constants/deployments-mainnet.json")
  ];

  for (const p of deploymentPaths) {
    updateJson(p, "ChainlinkPriceOracle", oracleAddress);
  }
  
  console.log("NOTE: 'priceOracle' field will be updated in the switch script. For frontend deployments.json, manual update or separate process may be needed to point to correct oracle after switch.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
