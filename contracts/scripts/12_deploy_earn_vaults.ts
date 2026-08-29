import fs from "fs";
import path from "path";
import { ethers } from "hardhat";

const DEPLOYMENT_PATH = path.join(
  __dirname,
  "..",
  "deployments",
  "arc-testnet.json",
);
const ROOT_DEPLOYMENT_PATH = path.join(
  __dirname,
  "..",
  "..",
  "constants",
  "deployments.json",
);
const FRONTEND_DEPLOYMENT_PATH = path.join(
  __dirname,
  "..",
  "..",
  "frontend",
  "constants",
  "deployments.json",
);

type Deployment = {
  lendingPool: string;
  markets: {
    USDC: { asset: string };
    EURC: { asset: string };
  };
  earnVaults?: {
    USDC?: string;
    EURC?: string;
  };
  earnVaultDeploymentBlock?: number;
  [key: string]: unknown;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function isDeployedAddress(address?: string) {
  return Boolean(address && address !== ZERO_ADDRESS);
}

async function deployVault(
  asset: string,
  lendingPool: string,
  name: string,
  symbol: string,
  owner: string,
) {
  const EarnVault = await ethers.getContractFactory("EarnVault");
  const vault = await EarnVault.deploy(asset, lendingPool, name, symbol, owner);
  await vault.waitForDeployment();
  return vault;
}

async function main() {
  const deployment = JSON.parse(
    fs.readFileSync(DEPLOYMENT_PATH, "utf8"),
  ) as Deployment;
  if (!deployment.lendingPool) {
    throw new Error("LendingPool address is missing from deployment file");
  }
  if (!deployment.markets?.USDC?.asset || !deployment.markets?.EURC?.asset) {
    throw new Error("USDC and EURC market assets are required");
  }
  const forceRedeploy = process.env.FORCE_REDEPLOY === "1";
  if (
    !forceRedeploy &&
    (isDeployedAddress(deployment.earnVaults?.USDC) ||
      isDeployedAddress(deployment.earnVaults?.EURC))
  ) {
    throw new Error("Earn vaults are already recorded in deployment file");
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deploying EarnVaults with:", deployer.address);
  console.log("Existing LendingPool:", deployment.lendingPool);

  const usdcVault = await deployVault(
    deployment.markets.USDC.asset,
    deployment.lendingPool,
    "Lendora Earn Vault USDC",
    "evUSDC",
    deployer.address,
  );
  const eurcVault = await deployVault(
    deployment.markets.EURC.asset,
    deployment.lendingPool,
    "Lendora Earn Vault EURC",
    "evEURC",
    deployer.address,
  );

  const usdcReceipt = await usdcVault.deploymentTransaction()?.wait();
  const eurcReceipt = await eurcVault.deploymentTransaction()?.wait();
  if (!usdcReceipt || !eurcReceipt) {
    throw new Error("EarnVault deployment receipts are unavailable");
  }

  deployment.earnVaults = {
    USDC: await usdcVault.getAddress(),
    EURC: await eurcVault.getAddress(),
  };
  deployment.earnVaultDeploymentBlock = Math.min(
    usdcReceipt.blockNumber,
    eurcReceipt.blockNumber,
  );

  for (const outputPath of [
    DEPLOYMENT_PATH,
    ROOT_DEPLOYMENT_PATH,
    FRONTEND_DEPLOYMENT_PATH,
  ]) {
    if (!fs.existsSync(outputPath)) continue;
    const existing = JSON.parse(fs.readFileSync(outputPath, "utf8")) as Deployment;
    existing.earnVaults = deployment.earnVaults;
    existing.earnVaultDeploymentBlock = deployment.earnVaultDeploymentBlock;
    fs.writeFileSync(outputPath, JSON.stringify(existing, null, 2) + "\n");
  }

  console.log("USDC EarnVault:", deployment.earnVaults.USDC);
  console.log("EURC EarnVault:", deployment.earnVaults.EURC);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
