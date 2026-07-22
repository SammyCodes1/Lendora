import { ethers } from "hardhat";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const deploymentPath = path.resolve(
  __dirname,
  "../deployments/arc-testnet.json",
);

async function main() {
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY is required to deploy to Arc Testnet");
  }

  const deployment = JSON.parse(
    await readFile(deploymentPath, "utf8"),
  ) as Record<string, unknown>;
  if (typeof deployment.PositionNFT === "string") {
    throw new Error(
      `PositionNFT is already recorded at ${deployment.PositionNFT}`,
    );
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deploying PositionNFT only with:", deployer.address);

  const PositionNFT = await ethers.getContractFactory("PositionNFT");
  const positionNFT = await PositionNFT.deploy();
  await positionNFT.waitForDeployment();
  const address = await positionNFT.getAddress();

  deployment.PositionNFT = address;
  await writeFile(
    deploymentPath,
    `${JSON.stringify(deployment, null, 2)}\n`,
    "utf8",
  );

  console.log("PositionNFT:", address);
  console.log(`Explorer: https://testnet.arcscan.app/address/${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
