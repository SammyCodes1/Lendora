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
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

type Deployment = {
  markets: {
    USDC: { asset: string };
    EURC: { asset: string };
  };
  earnVaults: {
    USDC: string;
    EURC: string;
  };
  EarnReferralController?: string;
  earnReferralControllerDeploymentBlock?: number;
  [key: string]: unknown;
};

function isDeployedAddress(address?: string) {
  return Boolean(address && address !== ZERO_ADDRESS);
}

async function main() {
  const deployment = JSON.parse(
    fs.readFileSync(DEPLOYMENT_PATH, "utf8"),
  ) as Deployment;
  const allowRedeploy = process.env.REDEPLOY_EARN_REFERRALS === "true";
  if (!isDeployedAddress(deployment.earnVaults?.USDC) || !isDeployedAddress(deployment.earnVaults?.EURC)) {
    throw new Error("USDC and EURC EarnVaults must be deployed first");
  }
  if (isDeployedAddress(deployment.EarnReferralController) && !allowRedeploy) {
    throw new Error(
      `EarnReferralController is already recorded at ${deployment.EarnReferralController}`,
    );
  }

  const [deployer] = await ethers.getSigners();
  if (allowRedeploy && isDeployedAddress(deployment.EarnReferralController)) {
    console.log("Replacing EarnReferralController:", deployment.EarnReferralController);
  }
  console.log("Deploying EarnReferralController with:", deployer.address);

  const Controller = await ethers.getContractFactory("EarnReferralController");
  const controller = await Controller.deploy(deployer.address);
  await controller.waitForDeployment();
  const controllerAddress = await controller.getAddress();

  await (
    await controller.configureVault(
      deployment.earnVaults.USDC,
      deployment.markets.USDC.asset,
      true,
    )
  ).wait();
  await (
    await controller.configureVault(
      deployment.earnVaults.EURC,
      deployment.markets.EURC.asset,
      true,
    )
  ).wait();

  const receipt = await controller.deploymentTransaction()?.wait();
  if (!receipt) {
    throw new Error("EarnReferralController deployment receipt is unavailable");
  }

  deployment.EarnReferralController = controllerAddress;
  deployment.earnReferralControllerDeploymentBlock = receipt.blockNumber;

  for (const outputPath of [DEPLOYMENT_PATH, FRONTEND_DEPLOYMENT_PATH]) {
    fs.writeFileSync(outputPath, JSON.stringify(deployment, null, 2) + "\n");
  }

  console.log("EarnReferralController:", controllerAddress);
  console.log("Deployment block:", receipt.blockNumber);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
