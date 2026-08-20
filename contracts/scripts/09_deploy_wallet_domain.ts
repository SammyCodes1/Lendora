import { ethers } from "hardhat";
import { readFile, writeFile } from "fs/promises";
import path from "path";

const CONTRACT_DEPLOYMENT_PATH = path.join(__dirname, "..", "deployments", "arc-testnet.json");
const FRONTEND_DEPLOYMENT_PATH = path.join(
  __dirname,
  "..",
  "..",
  "frontend",
  "constants",
  "deployments.json",
);
const ROOT_DEPLOYMENT_PATH = path.join(
  __dirname,
  "..",
  "..",
  "constants",
  "deployments.json",
);

async function updateDeployment(address: string, deploymentBlock: number) {
  for (const filePath of [CONTRACT_DEPLOYMENT_PATH, FRONTEND_DEPLOYMENT_PATH, ROOT_DEPLOYMENT_PATH]) {
    const deployment = JSON.parse(await readFile(filePath, "utf8"));
    deployment.WalletDomain = address;
    deployment.walletDomainDeploymentBlock = deploymentBlock;
    await writeFile(filePath, `${JSON.stringify(deployment, null, 2)}\n`);
  }
}

async function main() {
  console.log("Deploying WalletDomain contract...");

  const WalletDomain = await ethers.getContractFactory("WalletDomain");
  const walletDomain = await WalletDomain.deploy();

  await walletDomain.waitForDeployment();
  const receipt = await walletDomain.deploymentTransaction()?.wait();
  if (!receipt) {
    throw new Error("WalletDomain deployment receipt is unavailable");
  }

  const address = await walletDomain.getAddress();
  await updateDeployment(address, receipt.blockNumber);

  console.log("WalletDomain deployed to:", address);
  console.log("WalletDomain deployment block:", receipt.blockNumber);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
