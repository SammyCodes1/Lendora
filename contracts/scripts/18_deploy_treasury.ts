import { artifacts, ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * 18_deploy_treasury.ts
 * ─────────────────────
 * Deploys ArcLend Treasury — protocol-owned fee revenue collector.
 * Funds partner fee-shares, protocol development, and governance
 * allocations from FlashLoanPool and SwapPool fee splits.
 *
 * Usage:
 *   npx hardhat run scripts/18_deploy_treasury.ts --network arc_testnet
 */

function writeDeployment(key: string, address: string, blockNumber?: number) {
  const targets = [
    path.resolve(__dirname, "../deployments/arc-testnet.json"),
    path.resolve(__dirname, "../../constants/deployments.json"),
    path.resolve(__dirname, "../../frontend/constants/deployments.json"),
  ];

  for (const filePath of targets) {
    if (!fs.existsSync(filePath)) continue;
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    data[key] = address;
    if (blockNumber !== undefined) {
      data[`${key}DeploymentBlock`] = blockNumber;
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
  console.log("Deploying Treasury with owner:", deployer.address);

  const Factory = await ethers.getContractFactory("Treasury");
  const treasury = await Factory.deploy(deployer.address);
  await treasury.waitForDeployment();

  const address = await treasury.getAddress();
  const deployTx = treasury.deploymentTransaction();
  const receipt = deployTx ? await deployTx.wait() : null;
  const blockNumber = receipt?.blockNumber;

  console.log("✅ Treasury deployed at:", address);
  console.log("   owner:", await treasury.owner());
  if (blockNumber) console.log("   block:", blockNumber);

  writeDeployment("Treasury", address, blockNumber);

  // Export ABI
  const artifact = await artifacts.readArtifact("Treasury");
  const abiJson = `${JSON.stringify(artifact.abi, null, 2)}\n`;
  for (const dir of [
    path.resolve(__dirname, "../../constants/abis"),
    path.resolve(__dirname, "../../frontend/constants/abis"),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "Treasury.json"), abiJson, "utf8");
    console.log("  wrote ABI", path.join(dir, "Treasury.json"));
  }

  console.log("\n⚠️  REMINDER: Migrate Treasury ownership to a Gnosis Safe");
  console.log("   multi-sig before any real funds accumulate.");
  console.log("\nNext: deploy FlashLoanPool + SwapPool + LaaSRouter with");
  console.log("  npx hardhat run scripts/19_redeploy_flashloan_swap_with_treasury.ts --network arc_testnet");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
