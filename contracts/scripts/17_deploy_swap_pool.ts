import { artifacts, ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * 17_deploy_swap_pool.ts
 * ──────────────────────
 * Deploys ArcLend SwapPool (constant-product USDC/EURC AMM).
 * Completely independent of LendingPool.
 *
 * Usage:
 *   npx hardhat run scripts/17_deploy_swap_pool.ts --network arc_testnet
 */

const USDC = "0x3600000000000000000000000000000000000000";
const EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

function writeDeployment(address: string, blockNumber?: number) {
  const targets = [
    path.resolve(__dirname, "../deployments/arc-testnet.json"),
    path.resolve(__dirname, "../../constants/deployments.json"),
    path.resolve(__dirname, "../../frontend/constants/deployments.json"),
  ];

  for (const filePath of targets) {
    if (!fs.existsSync(filePath)) continue;
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    data.SwapPool = address;
    if (blockNumber !== undefined) {
      data.swapPoolDeploymentBlock = blockNumber;
    }
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    console.log("  updated", filePath);
  }
}

async function main() {
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY is required — see contracts/.env");
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deploying SwapPool with owner:", deployer.address);

  const Factory = await ethers.getContractFactory("SwapPool");
  const pool = await Factory.deploy(USDC, EURC, deployer.address);
  await pool.waitForDeployment();

  const address = await pool.getAddress();
  const deployTx = pool.deploymentTransaction();
  const receipt = deployTx ? await deployTx.wait() : null;
  const blockNumber = receipt?.blockNumber;

  console.log("✅ SwapPool deployed at:", address);
  console.log("   tokenA (USDC):", await pool.tokenA());
  console.log("   tokenB (EURC):", await pool.tokenB());
  console.log("   feeBps:", (await pool.feeBps()).toString());
  console.log("   owner:", await pool.owner());
  if (blockNumber) console.log("   block:", blockNumber);

  writeDeployment(address, blockNumber);

  // Export ABI to both frontend and root constants
  const artifact = await artifacts.readArtifact("SwapPool");
  const abiJson = `${JSON.stringify(artifact.abi, null, 2)}\n`;
  for (const dir of [
    path.resolve(__dirname, "../../constants/abis"),
    path.resolve(__dirname, "../../frontend/constants/abis"),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SwapPool.json"), abiJson, "utf8");
    console.log("  wrote ABI", path.join(dir, "SwapPool.json"));
  }

  console.log("\nNext: seed liquidity with");
  console.log("  npx hardhat run scripts/seed_swap_pool.ts --network arc_testnet");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
