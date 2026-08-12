import { artifacts, ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * 20_deploy_multisend.ts
 * ──────────────────────
 * Deploys ArcLend MultiSend — batch send USDC and/or EURC to many
 * recipients in a single transaction.
 *
 * Usage:
 *   npx hardhat run scripts/20_deploy_multisend.ts --network arc_testnet
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
  console.log("Deploying MultiSend with deployer:", deployer.address);

  const Factory = await ethers.getContractFactory("MultiSend");
  const multiSend = await Factory.deploy();
  await multiSend.waitForDeployment();

  const address = await multiSend.getAddress();
  const deployTx = multiSend.deploymentTransaction();
  const receipt = deployTx ? await deployTx.wait() : null;
  const blockNumber = receipt?.blockNumber;

  console.log("✅ MultiSend deployed at:", address);
  console.log("   MAX_RECIPIENTS:", Number(await multiSend.MAX_RECIPIENTS()));
  if (blockNumber) console.log("   block:", blockNumber);

  writeDeployment("MultiSend", address, blockNumber);

  // Export ABI
  const artifact = await artifacts.readArtifact("MultiSend");
  const abiJson = `${JSON.stringify(artifact.abi, null, 2)}\n`;
  for (const dir of [
    path.resolve(__dirname, "../../constants/abis"),
    path.resolve(__dirname, "../../frontend/constants/abis"),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "MultiSend.json"), abiJson, "utf8");
    console.log("  wrote ABI", path.join(dir, "MultiSend.json"));
  }

  console.log("\nNext: integrate MultiSend frontend at /multisend");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
