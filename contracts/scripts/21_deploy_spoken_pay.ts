import { ethers } from "hardhat";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import dotenv from "dotenv";

dotenv.config({
  path: path.join(__dirname, "..", "..", "frontend", ".env.local"),
});

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
  for (const filePath of [
    CONTRACT_DEPLOYMENT_PATH,
    FRONTEND_DEPLOYMENT_PATH,
    ROOT_DEPLOYMENT_PATH,
  ]) {
    const deployment = JSON.parse(await readFile(filePath, "utf8"));
    deployment.SpokenPay = address;
    deployment.spokenPayDeploymentBlock = deploymentBlock;
    await writeFile(filePath, `${JSON.stringify(deployment, null, 2)}\n`);
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployment = JSON.parse(await readFile(CONTRACT_DEPLOYMENT_PATH, "utf8"));
  if (!deployment.lendingPool || !deployment.WalletDomain) {
    throw new Error("lendingPool and WalletDomain must exist before SpokenPay");
  }

  console.log("Deploying SpokenPay with:", deployer.address);
  const Factory = await ethers.getContractFactory("SpokenPay");
  const spokenPay = await Factory.deploy(
    deployment.lendingPool,
    deployment.WalletDomain,
    deployer.address,
  );
  await spokenPay.waitForDeployment();
  const receipt = await spokenPay.deploymentTransaction()?.wait();
  if (!receipt) {
    throw new Error("SpokenPay deployment receipt is unavailable");
  }

  const address = await spokenPay.getAddress();
  const keeperKey = process.env.KEEPER_PRIVATE_KEY;
  if (keeperKey) {
    const normalized = keeperKey.startsWith("0x") ? keeperKey : `0x${keeperKey}`;
    const keeper = new ethers.Wallet(normalized).address;
    if (keeper.toLowerCase() !== deployer.address.toLowerCase()) {
      const tx = await spokenPay.setRelayer(keeper, true);
      await tx.wait();
      console.log("SpokenPay extra relayer:", keeper);
    }
  }
  await updateDeployment(address, receipt.blockNumber);
  console.log("SpokenPay deployed to:", address);
  console.log("SpokenPay deployment block:", receipt.blockNumber);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
