import { artifacts, ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * 19_redeploy_flashloan_swap_with_treasury.ts
 * ──────────────────────────────────────────
 * Deploys / redeploys FlashLoanPool, SwapPool, and LaaSRouter wired to
 * the protocol Treasury so fee revenue is split between LPs and the
 * protocol. This closes the LaaSRouter partner-payout gap: partner
 * fee-shares are now paid from real, accounted Treasury funds.
 *
 * PREREQUISITE: Treasury must already be deployed (script 18).
 *
 * ⚠️  IMPORTANT — ONE-TIME MIGRATION COST
 * FlashLoanPool and SwapPool are independent of LendingPool, so
 * redeploying them does NOT affect lending market liquidity. However,
 * any liquidity already seeded in OLD instances of FlashLoanPool or
 * SwapPool must be withdrawn by LPs before the old contracts are
 * abandoned, or migrated manually to the new instances.
 *
 * Usage:
 *   npx hardhat run scripts/19_redeploy_flashloan_swap_with_treasury.ts --network arc_testnet
 */

const USDC = "0x3600000000000000000000000000000000000000";
const EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

function loadDeployments(): Record<string, any> {
  const filePath = path.resolve(__dirname, "../deployments/arc-testnet.json");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeDeployment(key: string, address: string, blockNumber?: number) {
  const targets = [
    path.resolve(__dirname, "../deployments/arc-testnet.json"),
    path.resolve(__dirname, "../../constants/deployments.json"),
    path.resolve(__dirname, "../../frontend/constants/deployments.json"),
  ];

  for (const filePath of targets) {
    if (!fs.existsSync(filePath)) continue;
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    data[key] = address;
    if (blockNumber !== undefined) {
      data[`${key}DeploymentBlock`] = blockNumber;
    }
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    console.log("  updated", filePath);
  }
}

async function exportAbi(name: string) {
  const artifact = await artifacts.readArtifact(name);
  const abiJson = `${JSON.stringify(artifact.abi, null, 2)}\n`;
  for (const dir of [
    path.resolve(__dirname, "../../constants/abis"),
    path.resolve(__dirname, "../../frontend/constants/abis"),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.json`), abiJson, "utf8");
    console.log("  wrote ABI", path.join(dir, `${name}.json`));
  }
}

async function main() {
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY is required — see contracts/.env");
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // ─── Resolve Treasury ───────────────────────────────────────────────
  const deployments = loadDeployments();
  let treasuryAddr: string;

  if (deployments.Treasury) {
    treasuryAddr = deployments.Treasury;
    console.log("Using existing Treasury at:", treasuryAddr);
  } else {
    console.log("Treasury not found — deploying first...");
    const TreasuryFactory = await ethers.getContractFactory("Treasury");
    const treasury = await TreasuryFactory.deploy(deployer.address);
    await treasury.waitForDeployment();
    treasuryAddr = await treasury.getAddress();
    const deployTx = treasury.deploymentTransaction();
    const receipt = deployTx ? await deployTx.wait() : null;
    writeDeployment("Treasury", treasuryAddr, receipt?.blockNumber);
    await exportAbi("Treasury");
    console.log("✅ Treasury deployed at:", treasuryAddr);
  }

  // ─── 1. Deploy FlashLoanPool ───────────────────────────────────────
  console.log("\nDeploying FlashLoanPool...");
  const FlashLoanFactory = await ethers.getContractFactory("FlashLoanPool");
  const flashLoanPool = await FlashLoanFactory.deploy(deployer.address);
  await flashLoanPool.waitForDeployment();
  const flashLoanAddr = await flashLoanPool.getAddress();
  let deployTx = flashLoanPool.deploymentTransaction();
  let receipt = deployTx ? await deployTx.wait() : null;
  console.log("✅ FlashLoanPool at:", flashLoanAddr);
  console.log("   feeBps:", (await flashLoanPool.feeBps()).toString());
  console.log("   treasuryShareBps:", (await flashLoanPool.treasuryShareBps()).toString());

  // Allow USDC and EURC as flash loan assets.
  const tx1 = await flashLoanPool.setAllowedAsset(USDC, true);
  await tx1.wait();
  const tx2 = await flashLoanPool.setAllowedAsset(EURC, true);
  await tx2.wait();
  console.log("   allowed assets: USDC, EURC");

  writeDeployment("FlashLoanPool", flashLoanAddr, receipt?.blockNumber);
  await exportAbi("FlashLoanPool");

  // ─── 2. Deploy SwapPool ────────────────────────────────────────────
  console.log("\nDeploying SwapPool...");
  const SwapFactory = await ethers.getContractFactory("SwapPool");
  const swapPool = await SwapFactory.deploy(USDC, EURC, deployer.address);
  await swapPool.waitForDeployment();
  const swapAddr = await swapPool.getAddress();
  deployTx = swapPool.deploymentTransaction();
  receipt = deployTx ? await deployTx.wait() : null;
  console.log("✅ SwapPool at:", swapAddr);
  console.log("   feeBps:", (await swapPool.feeBps()).toString());
  console.log("   treasuryShareBps:", (await swapPool.treasuryShareBps()).toString());

  writeDeployment("SwapPool", swapAddr, receipt?.blockNumber);
  await exportAbi("SwapPool");

  // ─── 3. Deploy LaaSRouter ──────────────────────────────────────────
  console.log("\nDeploying LaaSRouter...");
  const RouterFactory = await ethers.getContractFactory("LaaSRouter");
  const router = await RouterFactory.deploy(deployer.address);
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();
  deployTx = router.deploymentTransaction();
  receipt = deployTx ? await deployTx.wait() : null;
  console.log("✅ LaaSRouter at:", routerAddr);

  writeDeployment("LaaSRouter", routerAddr, receipt?.blockNumber);
  await exportAbi("LaaSRouter");

  // ─── 4. Wire contracts together ────────────────────────────────────
  console.log("\nWiring contracts to Treasury...");

  // FlashLoanPool → Treasury
  const txSetFLTreasury = await flashLoanPool.setTreasury(treasuryAddr);
  await txSetFLTreasury.wait();
  console.log("  FlashLoanPool.treasury →", treasuryAddr);

  // SwapPool → Treasury
  const txSetSwapTreasury = await swapPool.setTreasury(treasuryAddr);
  await txSetSwapTreasury.wait();
  console.log("  SwapPool.treasury →", treasuryAddr);

  // LaaSRouter → FlashLoanPool
  const txSetFLP = await router.setFlashLoanPool(flashLoanAddr);
  await txSetFLP.wait();
  console.log("  LaaSRouter.flashLoanPool →", flashLoanAddr);

  // LaaSRouter → Treasury
  const txSetRouterTreasury = await router.setTreasury(treasuryAddr);
  await txSetRouterTreasury.wait();
  console.log("  LaaSRouter.treasury →", treasuryAddr);

  // Authorize LaaSRouter as spender on Treasury so it can call
  // withdraw() for automated partner payouts.
  const treasury = await ethers.getContractAt("Treasury", treasuryAddr);
  const txAuth = await treasury.setAuthorizedSpender(routerAddr, true);
  await txAuth.wait();
  console.log("  Treasury.authorizedSpenders[LaaSRouter] = true");

  // ─── 5. Summary ────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════");
  console.log("DEPLOYMENT COMPLETE");
  console.log("══════════════════════════════════════════════");
  console.log("Treasury:     ", treasuryAddr);
  console.log("FlashLoanPool:", flashLoanAddr);
  console.log("SwapPool:     ", swapAddr);
  console.log("LaaSRouter:   ", routerAddr);
  console.log("Owner:        ", deployer.address);
  console.log("══════════════════════════════════════════════");

  console.log("\n🧪 Verification commands:");
  console.log(`  npx hardhat verify --network arc_testnet ${treasuryAddr} "${deployer.address}"`);
  console.log(`  npx hardhat verify --network arc_testnet ${flashLoanAddr} "${deployer.address}"`);
  console.log(`  npx hardhat verify --network arc_testnet ${swapAddr} "${USDC}" "${EURC}" "${deployer.address}"`);
  console.log(`  npx hardhat verify --network arc_testnet ${routerAddr} "${deployer.address}"`);

  console.log("\n⚠️  REMINDER: Migrate Treasury ownership to Gnosis Safe.");
  console.log("⚠️  Old SwapPool LPs must withdraw before switching to new pool.");
  console.log("⚠️  Register LaaS partners via LaaSRouter.registerPartner().");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
