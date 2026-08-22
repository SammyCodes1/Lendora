import fs from "node:fs";
import path from "node:path";
import { artifacts, ethers } from "hardhat";
import { ARC_TESTNET_ADDRESSES } from "../constants/addresses";

const CHAIN_ID = 5_042_002n;
const TOKEN_UNIT = 10n ** 6n;
const SUPPLY_CAP = 1_000_000n * TOKEN_UNIT;
const BORROW_CAP = 700_000n * TOKEN_UNIT;
const PRIMARY_MAX_PRICE_AGE = 24n * 60n * 60n;
const FALLBACK_MAX_PRICE_AGE = 7n * 24n * 60n * 60n;

const DEPLOYMENT_PATH = path.join(__dirname, "..", "deployments", "arc-testnet.json");
const FRONTEND_DEPLOYMENT_PATH = path.join(
  __dirname,
  "..",
  "..",
  "frontend",
  "constants",
  "deployments.json",
);

async function deploy(
  name: string,
  ...args: unknown[]
): Promise<{ contract: any; address: string; blockNumber: number }> {
  const factory = await ethers.getContractFactory(name);
  const contract = await factory.deploy(...args);
  const receipt = await contract.deploymentTransaction()?.wait();
  if (!receipt) throw new Error(`${name} deployment receipt unavailable`);
  const address = await contract.getAddress();
  console.log(`${name}: ${address} (block ${receipt.blockNumber})`);
  return { contract, address, blockNumber: receipt.blockNumber };
}

async function runtimeHash(name: string) {
  const artifact = await artifacts.readArtifact(name);
  return ethers.keccak256(artifact.deployedBytecode as `0x${string}`);
}

async function main() {
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY is required");
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== CHAIN_ID) {
    throw new Error(`Refusing deployment to chain ${network.chainId}; expected ${CHAIN_ID}`);
  }

  const [deployer] = await ethers.getSigners();
  const gasBalance = await ethers.provider.getBalance(deployer.address);
  if (gasBalance === 0n) throw new Error("Deployer has no Arc Testnet gas balance");
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Arc Testnet gas balance: ${ethers.formatEther(gasBalance)}`);

  const addressesProvider = await deploy("LendingPoolAddressesProvider");
  const interestRateModel = await deploy("InterestRateModel");
  const primaryOracle = await deploy(
    "MockPriceOracle",
    ARC_TESTNET_ADDRESSES.USDC,
    ARC_TESTNET_ADDRESSES.EURC,
  );
  const fallbackOracle = await deploy(
    "MockPriceOracle",
    ARC_TESTNET_ADDRESSES.USDC,
    ARC_TESTNET_ADDRESSES.EURC,
  );
  const lendingPool = await deploy(
    "LendingPool",
    primaryOracle.address,
    interestRateModel.address,
  );

  const aUsdc = await deploy("AToken", ARC_TESTNET_ADDRESSES.USDC, lendingPool.address);
  const debtUsdc = await deploy("DebtToken", ARC_TESTNET_ADDRESSES.USDC, lendingPool.address);
  const aEurc = await deploy("AToken", ARC_TESTNET_ADDRESSES.EURC, lendingPool.address);
  const debtEurc = await deploy("DebtToken", ARC_TESTNET_ADDRESSES.EURC, lendingPool.address);

  const pool = lendingPool.contract;
  // Risk buffers: wider LTV–LT gap; EURC LTV reduced further (correlated-stable risk).
  // USDC max-borrow HF ≈ 80/70 = 1.14; EURC ≈ 78/60 = 1.30
  await (await pool.initReserve(
    ARC_TESTNET_ADDRESSES.USDC, aUsdc.address, debtUsdc.address, 7_000, 8_000, 500,
  )).wait();
  await (await pool.initReserve(
    ARC_TESTNET_ADDRESSES.EURC, aEurc.address, debtEurc.address, 6_000, 7_800, 600,
  )).wait();
  await (await pool.setFallbackPriceOracle(fallbackOracle.address)).wait();
  await (await pool.setReserveCaps(ARC_TESTNET_ADDRESSES.USDC, SUPPLY_CAP, BORROW_CAP)).wait();
  await (await pool.setReserveCaps(ARC_TESTNET_ADDRESSES.EURC, SUPPLY_CAP, BORROW_CAP)).wait();
  await (await primaryOracle.contract.setMaxPriceAge(PRIMARY_MAX_PRICE_AGE)).wait();
  await (await fallbackOracle.contract.setMaxPriceAge(FALLBACK_MAX_PRICE_AGE)).wait();

  // L-1: aToken/DebtToken Ownable is unused after deploy; renounce residual authority.
  await (await aUsdc.contract.renounceOwnership()).wait();
  await (await debtUsdc.contract.renounceOwnership()).wait();
  await (await aEurc.contract.renounceOwnership()).wait();
  await (await debtEurc.contract.renounceOwnership()).wait();

  await (await addressesProvider.contract.setLendingPool(lendingPool.address)).wait();
  await (await addressesProvider.contract.setPriceOracle(primaryOracle.address)).wait();
  await (await addressesProvider.contract.setInterestRateModel(interestRateModel.address)).wait();

  const positionNft = await deploy("PositionNFT");
  const positionManager = await deploy("PositionManager", lendingPool.address, positionNft.address);
  await (await positionNft.contract.setMinter(positionManager.address)).wait();

  const walletDomain = await deploy("WalletDomain");
  const domainMarketplace = await deploy(
    "DomainMarketplace", walletDomain.address, ARC_TESTNET_ADDRESSES.USDC,
  );
  const usdcVault = await deploy(
    "EarnVault", ARC_TESTNET_ADDRESSES.USDC, lendingPool.address,
    "ArcLend Earn Vault USDC", "evUSDC", deployer.address,
  );
  const eurcVault = await deploy(
    "EarnVault", ARC_TESTNET_ADDRESSES.EURC, lendingPool.address,
    "ArcLend Earn Vault EURC", "evEURC", deployer.address,
  );

  const deploymentBlock = Math.min(
    addressesProvider.blockNumber,
    interestRateModel.blockNumber,
    primaryOracle.blockNumber,
    fallbackOracle.blockNumber,
    lendingPool.blockNumber,
  );
  const deployment = {
    chainId: Number(CHAIN_ID),
    deploymentBlock,
    deployer: deployer.address,
    addressesProvider: addressesProvider.address,
    lendingPool: lendingPool.address,
    priceOracle: primaryOracle.address,
    fallbackPriceOracle: fallbackOracle.address,
    interestRateModel: interestRateModel.address,
    markets: {
      USDC: { asset: ARC_TESTNET_ADDRESSES.USDC, aToken: aUsdc.address, debtToken: debtUsdc.address },
      EURC: { asset: ARC_TESTNET_ADDRESSES.EURC, aToken: aEurc.address, debtToken: debtEurc.address },
    },
    riskConfiguration: {
      USDC: { ltv: 7_000, liquidationThreshold: 8_000, liquidationBonus: 500, supplyCap: SUPPLY_CAP.toString(), borrowCap: BORROW_CAP.toString() },
      EURC: { ltv: 6_000, liquidationThreshold: 7_800, liquidationBonus: 600, supplyCap: SUPPLY_CAP.toString(), borrowCap: BORROW_CAP.toString() },
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
    artifactRuntimeHashes: {
      LendingPool: await runtimeHash("LendingPool"),
      MockPriceOracle: await runtimeHash("MockPriceOracle"),
      InterestRateModel: await runtimeHash("InterestRateModel"),
      LendingPoolAddressesProvider: await runtimeHash("LendingPoolAddressesProvider"),
    },
  };

  const serialized = JSON.stringify(deployment, null, 2) + "\n";
  fs.writeFileSync(DEPLOYMENT_PATH, serialized);
  fs.writeFileSync(FRONTEND_DEPLOYMENT_PATH, serialized);
  console.log(`Manifest written to ${DEPLOYMENT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
