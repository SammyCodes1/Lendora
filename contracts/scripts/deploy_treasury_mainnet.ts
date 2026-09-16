import fs from "node:fs";
import path from "node:path";
import { artifacts, ethers } from "hardhat";

const CHAIN_ID = 5_042n; // Arc Mainnet

const MANIFEST_PATHS = [
  path.join(__dirname, "..", "deployments", "arc-mainnet.json"),
  path.join(__dirname, "..", "..", "constants", "deployments-mainnet.json"),
  path.join(__dirname, "..", "..", "frontend", "constants", "deployments-mainnet.json"),
];

async function main() {
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY is required in contracts/.env");
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== CHAIN_ID) {
    throw new Error(`Refusing deployment to chain ${network.chainId}; expected ${CHAIN_ID} (Arc Mainnet)`);
  }

  const [deployer] = await ethers.getSigners();
  const gasBalance = await ethers.provider.getBalance(deployer.address);
  console.log("==================================================");
  console.log("ARC MAINNET TREASURY DEPLOYMENT");
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Native Gas Balance: ${ethers.formatEther(gasBalance)} USDC`);
  console.log("==================================================");

  // Load existing mainnet deployment
  const mainnetManifestPath = MANIFEST_PATHS[0];
  const deployment = JSON.parse(fs.readFileSync(mainnetManifestPath, "utf8"));
  if (!deployment.SwapPool) {
    throw new Error("SwapPool is missing from mainnet deployment manifest");
  }

  // 1. Deploy Treasury
  console.log("\n[1/3] Deploying Treasury contract...");
  const TreasuryFactory = await ethers.getContractFactory("Treasury");
  const treasury = await TreasuryFactory.deploy(deployer.address);
  await treasury.waitForDeployment();
  const treasuryAddress = await treasury.getAddress();
  const receipt = await treasury.deploymentTransaction()?.wait();
  console.log(`✓ Treasury deployed at: ${treasuryAddress} (block ${receipt?.blockNumber}, gas: ${receipt?.gasUsed})`);

  // 2. Wire SwapPool to Treasury
  console.log("\n[2/3] Wiring SwapPool to Treasury...");
  const swapPool = await ethers.getContractAt("SwapPool", deployment.SwapPool, deployer);
  const currentTreasury = await swapPool.treasury();
  console.log(`  Current SwapPool.treasury: ${currentTreasury}`);

  const txSet = await swapPool.setTreasury(treasuryAddress);
  const setReceipt = await txSet.wait();
  console.log(`✓ SwapPool.setTreasury tx: ${txSet.hash} (gas: ${setReceipt?.gasUsed})`);

  // 3. Verify on-chain
  console.log("\n[3/3] Verifying on-chain wiring...");
  const verifiedTreasury = await swapPool.treasury();
  const verifiedOwner = await treasury.owner();
  console.log(`  SwapPool.treasury() on-chain: ${verifiedTreasury}`);
  console.log(`  Treasury.owner() on-chain:    ${verifiedOwner}`);

  if (verifiedTreasury.toLowerCase() !== treasuryAddress.toLowerCase()) {
    throw new Error("FATAL: SwapPool.treasury does not match deployed Treasury address!");
  }
  if (verifiedOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error("FATAL: Treasury owner is not the deployer address!");
  }

  // Update manifests
  deployment.Treasury = treasuryAddress;
  if (receipt?.blockNumber) {
    deployment.treasuryDeploymentBlock = receipt.blockNumber;
  }

  const serialized = JSON.stringify(deployment, null, 2) + "\n";
  for (const p of MANIFEST_PATHS) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, serialized);
    console.log(`Manifest updated: ${p}`);
  }

  // Export ABI
  const artifact = await artifacts.readArtifact("Treasury");
  const abiJson = `${JSON.stringify(artifact.abi, null, 2)}\n`;
  for (const dir of [
    path.resolve(__dirname, "../../constants/abis"),
    path.resolve(__dirname, "../../frontend/constants/abis"),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "Treasury.json"), abiJson, "utf8");
    console.log(`ABI exported: ${path.join(dir, "Treasury.json")}`);
  }

  console.log("\n==================================================");
  console.log("TREASURY DEPLOYED & WIRED SUCCESSFULLY");
  console.log(`Treasury Address: ${treasuryAddress}`);
  console.log(`Explorer: https://arcscan.app/address/${treasuryAddress}`);
  console.log("==================================================");
}

main().catch((error) => {
  console.error("Treasury deployment failed:", error);
  process.exitCode = 1;
});
