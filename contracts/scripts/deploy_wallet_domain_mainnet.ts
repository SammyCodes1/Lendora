import { ethers } from "hardhat";
import { readFile, writeFile } from "fs/promises";
import path from "path";

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
  const [deployer] = await ethers.getSigners();
  console.log("Deploying WalletDomain with 0.1 USDC 3-character fee on Arc Mainnet...");
  console.log("Deployer:", deployer.address);

  const deployment = JSON.parse(await readFile(ROOT_DEPLOYMENT_PATH, "utf8"));
  const usdc = deployment.markets?.USDC?.asset || "0x3600000000000000000000000000000000000000";
  const treasury = deployment.Treasury || "0x59eA806D4F33c48C68C400392D8D5754621Ea5dd";

  console.log("USDC Address:", usdc);
  console.log("Treasury Address:", treasury);

  // 1. Deploy WalletDomain
  const WalletDomain = await ethers.getContractFactory("WalletDomain");
  const walletDomain = await WalletDomain.deploy(usdc, treasury);
  await walletDomain.waitForDeployment();
  const walletDomainAddress = await walletDomain.getAddress();
  const walletDomainReceipt = await walletDomain.deploymentTransaction()?.wait();
  const walletDomainBlock = walletDomainReceipt?.blockNumber ?? (await ethers.provider.getBlockNumber());

  console.log("WalletDomain deployed to:", walletDomainAddress);
  console.log("WalletDomain block:", walletDomainBlock);

  // 2. Deploy DomainMarketplace pointing to new WalletDomain
  const DomainMarketplace = await ethers.getContractFactory("DomainMarketplace");
  const marketplace = await DomainMarketplace.deploy(walletDomainAddress, usdc);
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();
  const marketplaceReceipt = await marketplace.deploymentTransaction()?.wait();
  const marketplaceBlock = marketplaceReceipt?.blockNumber ?? (await ethers.provider.getBlockNumber());

  console.log("DomainMarketplace deployed to:", marketplaceAddress);
  console.log("DomainMarketplace block:", marketplaceBlock);

  // 3. Migrate existing 2 domains: 'sam' and '001'
  console.log("Migrating existing domains ('sam' and '001')...");
  const migrateTx = await walletDomain.batchMintLegacy(
    ["sam", "001"],
    ["0x2EF3e601B1f607836BB25951D27b01Ff6D289DE2", deployer.address],
  );
  await migrateTx.wait();
  console.log("Migrated existing domains. Tx:", migrateTx.hash);

  // 4. Update deployment files
  for (const filePath of [FRONTEND_DEPLOYMENT_PATH, ROOT_DEPLOYMENT_PATH]) {
    const dep = JSON.parse(await readFile(filePath, "utf8"));
    dep.WalletDomain = walletDomainAddress;
    dep.walletDomainDeploymentBlock = walletDomainBlock;
    dep.DomainMarketplace = marketplaceAddress;
    dep.domainMarketplaceDeploymentBlock = marketplaceBlock;
    await writeFile(filePath, `${JSON.stringify(dep, null, 2)}\n`);
    console.log("Updated", filePath);
  }

  console.log("Deployment and migration complete!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
