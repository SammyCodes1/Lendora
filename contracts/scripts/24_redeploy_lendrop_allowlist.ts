import { artifacts, ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * 24_redeploy_lendrop_allowlist.ts
 * ────────────────────────────────
 * Redeploys Lendrop with on-chain allowlists. The previous ArcDrop address
 * is preserved as legacyArcDrop so existing claim links still resolve.
 *
 *   npx hardhat run scripts/24_redeploy_lendrop_allowlist.ts --network arc_testnet
 */

function writeDeployment(
  key: string,
  address: string,
  blockNumber?: number,
  extras?: Record<string, unknown>,
) {
  const targets = [
    path.resolve(__dirname, "../deployments/arc-testnet.json"),
    path.resolve(__dirname, "../../constants/deployments.json"),
    path.resolve(__dirname, "../../frontend/constants/deployments.json"),
  ];

  for (const filePath of targets) {
    if (!fs.existsSync(filePath)) continue;
    const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<
      string,
      unknown
    >;
    if (!data.legacyArcDrop && data.ArcDrop) {
      data.legacyArcDrop = data.ArcDrop;
      if (data.ArcDropDeploymentBlock !== undefined) {
        data.legacyArcDropDeploymentBlock = data.ArcDropDeploymentBlock;
      }
    }
    data[key] = address;
    if (blockNumber !== undefined) {
      data[`${key}DeploymentBlock`] = blockNumber;
    }
    if (extras) {
      Object.assign(data, extras);
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
  console.log("Redeploying Lendrop (allowlist) with deployer:", deployer.address);

  const Factory = await ethers.getContractFactory("Lendrop");
  const arcDrop = await Factory.deploy();
  await arcDrop.waitForDeployment();

  const address = await arcDrop.getAddress();
  const deployTx = arcDrop.deploymentTransaction();
  const receipt = deployTx ? await deployTx.wait() : null;
  const blockNumber = receipt?.blockNumber;

  console.log("✅ Lendrop deployed at:", address);
  if (blockNumber) console.log("   block:", blockNumber);

  const nextDropId = await arcDrop.nextDropId();
  const maxAllowlist = await arcDrop.MAX_ALLOWLIST();
  console.log("   nextDropId:", nextDropId.toString(), "(expected: 1)");
  console.log("   MAX_ALLOWLIST:", maxAllowlist.toString());

  writeDeployment("ArcDrop", address, blockNumber);

  const artifact = await artifacts.readArtifact("Lendrop");
  const abiJson = `${JSON.stringify(artifact.abi, null, 2)}\n`;
  for (const dir of [
    path.resolve(__dirname, "../../constants/abis"),
    path.resolve(__dirname, "../../frontend/constants/abis"),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "ArcDrop.json"), abiJson, "utf8");
    console.log("  wrote ABI", path.join(dir, "ArcDrop.json"));
  }

  console.log("\nVerify:");
  console.log(
    `  npx hardhat verify --network arc_testnet ${address}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
