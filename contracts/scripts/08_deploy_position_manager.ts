import { ethers } from "hardhat";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const deploymentPath = path.resolve(
  __dirname,
  "../deployments/arc-testnet.json",
);
const frontendDeploymentPath = path.resolve(
  __dirname,
  "../../frontend/constants/deployments.json",
);

type Deployment = {
  lendingPool: string;
  PositionNFT?: string;
  PositionManager?: string;
  [key: string]: unknown;
};

async function main() {
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY is required to deploy to Arc Testnet");
  }

  const deployment = JSON.parse(
    await readFile(deploymentPath, "utf8"),
  ) as Deployment;
  if (!deployment.lendingPool) {
    throw new Error("Existing LendingPool address is missing");
  }
  if (!deployment.PositionNFT) {
    throw new Error(
      "Deploy PositionNFT first with scripts/07_deploy_position_nft.ts",
    );
  }
  if (deployment.PositionManager) {
    throw new Error(
      `PositionManager is already recorded at ${deployment.PositionManager}`,
    );
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deploying PositionManager only with:", deployer.address);
  console.log("Existing LendingPool:", deployment.lendingPool);
  console.log("PositionNFT:", deployment.PositionNFT);

  const PositionManager = await ethers.getContractFactory(
    "PositionManager",
  );
  const positionManager = await PositionManager.deploy(
    deployment.lendingPool,
    deployment.PositionNFT,
  );
  await positionManager.waitForDeployment();
  const managerAddress = await positionManager.getAddress();

  const positionNFT = await ethers.getContractAt(
    "PositionNFT",
    deployment.PositionNFT,
  );
  const setMinterTx = await positionNFT.setMinter(managerAddress);
  await setMinterTx.wait();

  deployment.PositionManager = managerAddress;
  await writeFile(
    deploymentPath,
    `${JSON.stringify(deployment, null, 2)}\n`,
    "utf8",
  );
  await copyFile(deploymentPath, frontendDeploymentPath);

  console.log("PositionManager:", managerAddress);
  console.log("PositionNFT minter configured:", managerAddress);
  console.log(
    `Explorer: https://testnet.arcscan.app/address/${managerAddress}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
