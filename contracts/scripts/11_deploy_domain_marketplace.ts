import fs from "fs";
import path from "path";
import { ethers } from "hardhat";

const DEPLOYMENT_PATH = path.join(
  __dirname,
  "..",
  "deployments",
  "arc-testnet.json",
);
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

async function main() {
  const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, "utf8"));
  if (!deployment.WalletDomain) {
    throw new Error("WalletDomain address is missing from deployment file");
  }
  const usdc = deployment.markets?.USDC?.asset;
  if (!usdc) {
    throw new Error("USDC address is missing from deployment file");
  }

  const DomainMarketplace = await ethers.getContractFactory("DomainMarketplace");
  const marketplace = await DomainMarketplace.deploy(deployment.WalletDomain, usdc);
  await marketplace.waitForDeployment();

  const address = await marketplace.getAddress();
  const receipt = await marketplace.deploymentTransaction()?.wait();
  if (!receipt) {
    throw new Error("DomainMarketplace deployment receipt is unavailable");
  }

  deployment.DomainMarketplace = address;
  deployment.domainMarketplaceDeploymentBlock = receipt.blockNumber;

  for (const outputPath of [DEPLOYMENT_PATH, FRONTEND_DEPLOYMENT_PATH, ROOT_DEPLOYMENT_PATH]) {
    fs.writeFileSync(outputPath, JSON.stringify(deployment, null, 2) + "\n");
  }

  console.log("DomainMarketplace deployed to:", address);
  console.log("DomainMarketplace deployment block:", receipt.blockNumber);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
