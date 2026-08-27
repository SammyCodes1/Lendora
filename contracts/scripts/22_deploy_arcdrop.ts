import { artifacts, ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * 22_deploy_arcdrop.ts
 * ────────────────────
 * Deploys ArcDrop — an escrow-based claim-link feature for USDC and EURC.
 *
 * Usage:
 *   npx hardhat run scripts/22_deploy_arcdrop.ts --network arc_testnet
 *
 * After deployment:
 *   - Address is appended to deployments/arc-testnet.json under "ArcDrop"
 *   - Also written to ../../constants/deployments.json
 *   - Also written to ../../frontend/constants/deployments.json
 *   - ABI exported to ../../constants/abis/ArcDrop.json
 *   - ABI exported to ../../frontend/constants/abis/ArcDrop.json
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
  console.log("Deploying ArcDrop with deployer:", deployer.address);

  const Factory = await ethers.getContractFactory("ArcDrop");
  const arcDrop = await Factory.deploy();
  await arcDrop.waitForDeployment();

  const address = await arcDrop.getAddress();
  const deployTx = arcDrop.deploymentTransaction();
  const receipt = deployTx ? await deployTx.wait() : null;
  const blockNumber = receipt?.blockNumber;

  console.log("✅ ArcDrop deployed at:", address);
  if (blockNumber) console.log("   block:", blockNumber);

  // Verify initial state
  const nextDropId = await arcDrop.nextDropId();
  console.log("   nextDropId:", nextDropId.toString(), "(expected: 1)");

  writeDeployment("ArcDrop", address, blockNumber);

  // Export ABI to all target directories
  const artifact = await artifacts.readArtifact("ArcDrop");
  const abiJson = `${JSON.stringify(artifact.abi, null, 2)}\n`;
  for (const dir of [
    path.resolve(__dirname, "../../constants/abis"),
    path.resolve(__dirname, "../../frontend/constants/abis"),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "ArcDrop.json"), abiJson, "utf8");
    console.log("  wrote ABI", path.join(dir, "ArcDrop.json"));
  }

  console.log("\nNext steps:");
  console.log("  1. POST /api/drop/create-link with { dropId, creatorWallet }");
  console.log("  2. Share the returned URL: arclend.cv/drop/<slug>");
  console.log("  3. Recipient opens the link and calls claim(dropId)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
