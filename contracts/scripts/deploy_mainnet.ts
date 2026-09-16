import fs from "node:fs";
import path from "node:path";
import { artifacts, ethers } from "hardhat";

const CHAIN_ID = 5_042n; // Arc Mainnet
const TOKEN_UNIT = 10n ** 6n;
const SUPPLY_CAP = 1_000_000n * TOKEN_UNIT;
const BORROW_CAP = 700_000n * TOKEN_UNIT;
const PRIMARY_MAX_PRICE_AGE = 24n * 60n * 60n;
const FALLBACK_MAX_PRICE_AGE = 7n * 24n * 60n * 60n;

// Mainnet verified system tokens
const ARC_MAINNET_USDC = "0x3600000000000000000000000000000000000000";
const ARC_MAINNET_EURC = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1";

const DEPLOYMENT_PATHS = [
  path.join(__dirname, "..", "deployments", "arc-mainnet.json"),
  path.join(__dirname, "..", "..", "constants", "deployments-mainnet.json"),
  path.join(__dirname, "..", "..", "frontend", "constants", "deployments-mainnet.json"),
];

async function deploy(
  name: string,
  ...args: unknown[]
): Promise<{ contract: any; address: string; blockNumber: number; gasUsed: bigint }> {
  const factory = await ethers.getContractFactory(name);
  const contract = await factory.deploy(...args);
  const receipt = await contract.deploymentTransaction()?.wait();
  if (!receipt) throw new Error(`${name} deployment receipt unavailable`);
  const address = await contract.getAddress();
  console.log(`✓ ${name.padEnd(28)} -> ${address} (block ${receipt.blockNumber}, gas: ${receipt.gasUsed})`);
  return { contract, address, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed };
}

async function runtimeHash(name: string) {
  const artifact = await artifacts.readArtifact(name);
  return ethers.keccak256(artifact.deployedBytecode as `0x${string}`);
}

async function main() {
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY is required in contracts/.env");
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== CHAIN_ID) {
    throw new Error(`Refusing deployment to chain ${network.chainId}; expected ${CHAIN_ID} (Arc Mainnet)`);
  }

  const [deployer] = await ethers.getSigners();
  const gasBalance = await ethers.provider.getBalance(deployer.address);
  console.log("==================================================");
  console.log("ARC MAINNET DEPLOYMENT");
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Native Gas Balance: ${ethers.formatEther(gasBalance)} USDC`);
  console.log("==================================================");

  if (gasBalance < 800000000000000000n) {
    console.warn("⚠️ WARNING: Balance is below 0.8 USDC. Full deployment requires ~0.85-1.1 USDC.");
  }

  let totalGas = 0n;

  // 1. Core Addresses Provider & Rate Model
  const addressesProvider = await deploy("LendingPoolAddressesProvider");
  totalGas += addressesProvider.gasUsed;

  const interestRateModel = await deploy("InterestRateModel");
  totalGas += interestRateModel.gasUsed;

  // 2. Price Oracle
  const primaryOracle = await deploy("MockPriceOracle", ARC_MAINNET_USDC, ARC_MAINNET_EURC);
  totalGas += primaryOracle.gasUsed;

  const fallbackOracle = await deploy("MockPriceOracle", ARC_MAINNET_USDC, ARC_MAINNET_EURC);
  totalGas += fallbackOracle.gasUsed;

  // 3. Lending Pool
  const lendingPool = await deploy("LendingPool", primaryOracle.address, interestRateModel.address);
  totalGas += lendingPool.gasUsed;

  // 4. Reserve Tokens (USDC & EURC)
  const aUsdc = await deploy("AToken", ARC_MAINNET_USDC, lendingPool.address);
  totalGas += aUsdc.gasUsed;
  const debtUsdc = await deploy("DebtToken", ARC_MAINNET_USDC, lendingPool.address);
  totalGas += debtUsdc.gasUsed;

  const aEurc = await deploy("AToken", ARC_MAINNET_EURC, lendingPool.address);
  totalGas += aEurc.gasUsed;
  const debtEurc = await deploy("DebtToken", ARC_MAINNET_EURC, lendingPool.address);
  totalGas += debtEurc.gasUsed;

  // 5. Initialize Reserves & Caps
  const pool = lendingPool.contract;
  console.log("Initializing reserves and configuration...");
  const txInitUsdc = await pool.initReserve(ARC_MAINNET_USDC, aUsdc.address, debtUsdc.address, 7_500, 8_000, 500);
  await txInitUsdc.wait();
  const txInitEurc = await pool.initReserve(ARC_MAINNET_EURC, aEurc.address, debtEurc.address, 7_000, 7_800, 600);
  await txInitEurc.wait();

  const txFallback = await pool.setFallbackPriceOracle(fallbackOracle.address);
  await txFallback.wait();

  const txCapsUsdc = await pool.setReserveCaps(ARC_MAINNET_USDC, SUPPLY_CAP, BORROW_CAP);
  await txCapsUsdc.wait();
  const txCapsEurc = await pool.setReserveCaps(ARC_MAINNET_EURC, SUPPLY_CAP, BORROW_CAP);
  await txCapsEurc.wait();

  const txAge1 = await primaryOracle.contract.setMaxPriceAge(PRIMARY_MAX_PRICE_AGE);
  await txAge1.wait();
  const txAge2 = await fallbackOracle.contract.setMaxPriceAge(FALLBACK_MAX_PRICE_AGE);
  await txAge2.wait();

  // Renounce residual authority on tokens
  await (await aUsdc.contract.renounceOwnership()).wait();
  await (await debtUsdc.contract.renounceOwnership()).wait();
  await (await aEurc.contract.renounceOwnership()).wait();
  await (await debtEurc.contract.renounceOwnership()).wait();

  // Wire addresses provider
  await (await addressesProvider.contract.setLendingPool(lendingPool.address)).wait();
  await (await addressesProvider.contract.setPriceOracle(primaryOracle.address)).wait();
  await (await addressesProvider.contract.setInterestRateModel(interestRateModel.address)).wait();

  // 6. Position NFT & Manager
  const positionNft = await deploy("PositionNFT");
  totalGas += positionNft.gasUsed;

  const positionManager = await deploy("PositionManager", lendingPool.address, positionNft.address);
  totalGas += positionManager.gasUsed;
  await (await positionNft.contract.setMinter(positionManager.address)).wait();

  // 7. Domains & Marketplace
  const walletDomain = await deploy("WalletDomain");
  totalGas += walletDomain.gasUsed;

  const domainMarketplace = await deploy("DomainMarketplace", walletDomain.address, ARC_MAINNET_USDC);
  totalGas += domainMarketplace.gasUsed;

  // 8. Earn Vaults
  const usdcVault = await deploy(
    "EarnVault",
    ARC_MAINNET_USDC,
    lendingPool.address,
    "Lendora Earn Vault USDC",
    "evUSDC",
    deployer.address,
  );
  totalGas += usdcVault.gasUsed;

  const eurcVault = await deploy(
    "EarnVault",
    ARC_MAINNET_EURC,
    lendingPool.address,
    "Lendora Earn Vault EURC",
    "evEURC",
    deployer.address,
  );
  totalGas += eurcVault.gasUsed;

  // 9. Peripherals (Swap, MultiSend, SpokenPay, Lendrop, RecurringExecutor)
  const swapPool = await deploy("SwapPool", ARC_MAINNET_USDC, ARC_MAINNET_EURC, deployer.address);
  totalGas += swapPool.gasUsed;

  const multiSend = await deploy("MultiSend");
  totalGas += multiSend.gasUsed;

  const spokenPay = await deploy("SpokenPay", lendingPool.address, walletDomain.address, deployer.address);
  totalGas += spokenPay.gasUsed;

  const lendrop = await deploy("Lendrop");
  totalGas += lendrop.gasUsed;

  const recurringExecutor = await deploy("RecurringOrderExecutor", deployer.address);
  totalGas += recurringExecutor.gasUsed;

  const deploymentBlock = Math.min(
    addressesProvider.blockNumber,
    interestRateModel.blockNumber,
    primaryOracle.blockNumber,
    lendingPool.blockNumber,
  );

  const deployment = {
    chainId: 5042,
    deploymentBlock,
    deployer: deployer.address,
    addressesProvider: addressesProvider.address,
    lendingPool: lendingPool.address,
    priceOracle: primaryOracle.address,
    fallbackPriceOracle: fallbackOracle.address,
    interestRateModel: interestRateModel.address,
    markets: {
      USDC: { asset: ARC_MAINNET_USDC, aToken: aUsdc.address, debtToken: debtUsdc.address },
      EURC: { asset: ARC_MAINNET_EURC, aToken: aEurc.address, debtToken: debtEurc.address },
    },
    riskConfiguration: {
      USDC: {
        ltv: 7_500,
        liquidationThreshold: 8_000,
        liquidationBonus: 500,
        supplyCap: SUPPLY_CAP.toString(),
        borrowCap: BORROW_CAP.toString(),
      },
      EURC: {
        ltv: 7_000,
        liquidationThreshold: 7_800,
        liquidationBonus: 600,
        supplyCap: SUPPLY_CAP.toString(),
        borrowCap: BORROW_CAP.toString(),
      },
      primaryMaxPriceAge: PRIMARY_MAX_PRICE_AGE.toString(),
      fallbackMaxPriceAge: FALLBACK_MAX_PRICE_AGE.toString(),
    },
    PositionNFT: positionNft.address,
    PositionManager: positionManager.address,
    WalletDomain: walletDomain.address,
    walletDomainDeploymentBlock: walletDomain.blockNumber,
    DomainMarketplace: domainMarketplace.address,
    domainMarketplaceDeploymentBlock: domainMarketplace.blockNumber,
    earnVaults: { USDC: usdcVault.address, EURC: eurcVault.address },
    earnVaultDeploymentBlock: Math.min(usdcVault.blockNumber, eurcVault.blockNumber),
    SwapPool: swapPool.address,
    swapPoolDeploymentBlock: swapPool.blockNumber,
    MultiSend: multiSend.address,
    MultiSendDeploymentBlock: multiSend.blockNumber,
    SpokenPay: spokenPay.address,
    spokenPayDeploymentBlock: spokenPay.blockNumber,
    ArcDrop: lendrop.address,
    ArcDropDeploymentBlock: lendrop.blockNumber,
    RecurringOrderExecutor: recurringExecutor.address,
    artifactRuntimeHashes: {
      LendingPool: await runtimeHash("LendingPool"),
      MockPriceOracle: await runtimeHash("MockPriceOracle"),
      InterestRateModel: await runtimeHash("InterestRateModel"),
      LendingPoolAddressesProvider: await runtimeHash("LendingPoolAddressesProvider"),
    },
  };

  const serialized = JSON.stringify(deployment, null, 2) + "\n";
  for (const p of DEPLOYMENT_PATHS) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, serialized);
    console.log(`Manifest written to ${p}`);
  }

  console.log("==================================================");
  console.log("ARC MAINNET DEPLOYMENT SUCCESSFUL");
  console.log("LendingPool:", lendingPool.address);
  console.log("PositionManager:", positionManager.address);
  console.log("Explorer: https://arcscan.app/address/" + lendingPool.address);
  console.log("==================================================");
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exitCode = 1;
});
