import hre, { artifacts, ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Redeploy aUSDC, aEURC, dUSDC, dEURC, and Position NFT with Lendora on-chain
 * names, then wire them the same way the previous market tokens were wired:
 *   aToken/debtToken.pool = LendingPool
 *   LendingPool.initReserve(asset, aToken, debtToken, risk params)
 *   PositionNFT.setMinter(PositionManager)
 *   PositionManager(lendingPool, positionNFT)
 *
 * The live LendingPool cannot retarget reserve tokens (initReserve is one-shot
 * and there is no setter). A new pool is deployed with the same oracles, rate
 * model, caps, and risk params so the app can use the Lendora-named tokens.
 *
 * Usage:
 *   npx hardhat run scripts/23_redeploy_lendora_market_tokens.ts --network arc_testnet
 */

const DEPLOYMENT_PATHS = [
  path.resolve(__dirname, "../deployments/arc-testnet.json"),
  path.resolve(__dirname, "../../constants/deployments.json"),
  path.resolve(__dirname, "../../frontend/constants/deployments.json"),
];

const ABI_DIRS = [
  path.resolve(__dirname, "../../constants/abis"),
  path.resolve(__dirname, "../../frontend/constants/abis"),
];

type MarketConfig = {
  asset: string;
  aToken: string;
  debtToken: string;
};

type Deployment = {
  lendingPool: string;
  priceOracle: string;
  fallbackPriceOracle?: string;
  interestRateModel: string;
  addressesProvider: string;
  markets: { USDC: MarketConfig; EURC: MarketConfig };
  riskConfiguration?: {
    USDC: { ltv: number; liquidationThreshold: number; liquidationBonus: number; supplyCap: string; borrowCap: string };
    EURC: { ltv: number; liquidationThreshold: number; liquidationBonus: number; supplyCap: string; borrowCap: string };
  };
  PositionNFT?: string;
  PositionManager?: string;
  WalletDomain?: string;
  earnVaults?: { USDC?: string; EURC?: string };
  SpokenPay?: string;
  [key: string]: unknown;
};

function readDeployment(): Deployment {
  return JSON.parse(fs.readFileSync(DEPLOYMENT_PATHS[0], "utf8")) as Deployment;
}

function writeDeployment(patch: Record<string, unknown>) {
  for (const filePath of DEPLOYMENT_PATHS) {
    if (!fs.existsSync(filePath)) continue;
    const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    Object.assign(data, patch);
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    console.log("  updated", filePath);
  }
}

function writeAbi(name: string) {
  const artifact = artifacts.readArtifactSync(name);
  const json = `${JSON.stringify(artifact.abi, null, 2)}\n`;
  for (const dir of ABI_DIRS) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.json`), json, "utf8");
  }
}

async function verify(address: string, constructorArguments: unknown[]) {
  try {
    await hre.run("verify:verify", {
      address,
      constructorArguments,
    });
    console.log("  verified", address);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already verified/i.test(message)) {
      console.log("  already verified", address);
      return;
    }
    console.warn("  verify failed", address, message.slice(0, 400));
  }
}

async function main() {
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY is required to deploy to Arc Testnet");
  }

  const deployment = readDeployment();
  const [deployer] = await ethers.getSigners();
  const usdc = deployment.markets.USDC.asset;
  const eurc = deployment.markets.EURC.asset;

  console.log("Deployer:", deployer.address);
  console.log("Previous LendingPool:", deployment.lendingPool);

  const oldPool = await ethers.getContractAt("LendingPool", deployment.lendingPool);
  const priceOracle = await oldPool.priceOracle();
  const fallbackOracle = await oldPool.fallbackPriceOracle();
  const rateModel = await oldPool.interestRateModel();
  const usdcReserve = await oldPool.getReserveData(usdc);
  const eurcReserve = await oldPool.getReserveData(eurc);
  const usdcSupplyCap = await oldPool.supplyCaps(usdc);
  const usdcBorrowCap = await oldPool.borrowCaps(usdc);
  const eurcSupplyCap = await oldPool.supplyCaps(eurc);
  const eurcBorrowCap = await oldPool.borrowCaps(eurc);

  const LendingPool = await ethers.getContractFactory("LendingPool");
  const pool = await LendingPool.deploy(priceOracle, rateModel);
  await pool.waitForDeployment();
  const poolAddress = await pool.getAddress();
  const poolReceipt = await pool.deploymentTransaction()?.wait();
  console.log("LendingPool:", poolAddress);

  if (fallbackOracle && fallbackOracle !== ethers.ZeroAddress) {
    await (await pool.setFallbackPriceOracle(fallbackOracle)).wait();
  }

  const AToken = await ethers.getContractFactory("AToken");
  const DebtToken = await ethers.getContractFactory("DebtToken");

  const aUsdc = await AToken.deploy(usdc, poolAddress);
  await aUsdc.waitForDeployment();
  const aEurc = await AToken.deploy(eurc, poolAddress);
  await aEurc.waitForDeployment();
  const dUsdc = await DebtToken.deploy(usdc, poolAddress);
  await dUsdc.waitForDeployment();
  const dEurc = await DebtToken.deploy(eurc, poolAddress);
  await dEurc.waitForDeployment();

  const aUsdcAddress = await aUsdc.getAddress();
  const aEurcAddress = await aEurc.getAddress();
  const dUsdcAddress = await dUsdc.getAddress();
  const dEurcAddress = await dEurc.getAddress();
  console.log("aUSDC:", aUsdcAddress, await aUsdc.name(), await aUsdc.symbol());
  console.log("aEURC:", aEurcAddress, await aEurc.name(), await aEurc.symbol());
  console.log("dUSDC:", dUsdcAddress, await dUsdc.name(), await dUsdc.symbol());
  console.log("dEURC:", dEurcAddress, await dEurc.name(), await dEurc.symbol());

  await (
    await pool.initReserve(
      usdc,
      aUsdcAddress,
      dUsdcAddress,
      usdcReserve.ltv,
      usdcReserve.liquidationThreshold,
      usdcReserve.liquidationBonus,
    )
  ).wait();
  await (
    await pool.initReserve(
      eurc,
      aEurcAddress,
      dEurcAddress,
      eurcReserve.ltv,
      eurcReserve.liquidationThreshold,
      eurcReserve.liquidationBonus,
    )
  ).wait();
  await (await pool.setReserveCaps(usdc, usdcSupplyCap, usdcBorrowCap)).wait();
  await (await pool.setReserveCaps(eurc, eurcSupplyCap, eurcBorrowCap)).wait();

  const PositionNFT = await ethers.getContractFactory("PositionNFT");
  const positionNFT = await PositionNFT.deploy();
  await positionNFT.waitForDeployment();
  const nftAddress = await positionNFT.getAddress();
  console.log("PositionNFT:", nftAddress, await positionNFT.name(), await positionNFT.symbol());

  const PositionManager = await ethers.getContractFactory("PositionManager");
  const positionManager = await PositionManager.deploy(poolAddress, nftAddress);
  await positionManager.waitForDeployment();
  const managerAddress = await positionManager.getAddress();
  await (await positionNFT.setMinter(managerAddress)).wait();
  await (await pool.setBorrowDelegate(managerAddress, true)).wait();
  console.log("PositionManager:", managerAddress);

  const EarnVault = await ethers.getContractFactory("EarnVault");
  const usdcVault = await EarnVault.deploy(
    usdc,
    poolAddress,
    "Lendora Earn Vault USDC",
    "evUSDC",
    deployer.address,
  );
  await usdcVault.waitForDeployment();
  const eurcVault = await EarnVault.deploy(
    eurc,
    poolAddress,
    "Lendora Earn Vault EURC",
    "evEURC",
    deployer.address,
  );
  await eurcVault.waitForDeployment();
  const usdcVaultAddress = await usdcVault.getAddress();
  const eurcVaultAddress = await eurcVault.getAddress();
  console.log("EarnVault USDC:", usdcVaultAddress);
  console.log("EarnVault EURC:", eurcVaultAddress);

  let spokenPayAddress = deployment.SpokenPay;
  if (deployment.WalletDomain) {
    const SpokenPay = await ethers.getContractFactory("SpokenPay");
    const spokenPay = await SpokenPay.deploy(
      poolAddress,
      deployment.WalletDomain,
      deployer.address,
    );
    await spokenPay.waitForDeployment();
    spokenPayAddress = await spokenPay.getAddress();
    const spokenReceipt = await spokenPay.deploymentTransaction()?.wait();
    console.log("SpokenPay:", spokenPayAddress);
    if (spokenReceipt) {
      writeDeployment({
        SpokenPay: spokenPayAddress,
        spokenPayDeploymentBlock: spokenReceipt.blockNumber,
      });
    }
  }

  const provider = await ethers.getContractAt(
    "LendingPoolAddressesProvider",
    deployment.addressesProvider,
  );
  await (await provider.setLendingPool(poolAddress)).wait();

  const wiredUsdc = await pool.getReserveData(usdc);
  const wiredEurc = await pool.getReserveData(eurc);
  const same = (left: string, right: string) =>
    ethers.getAddress(left) === ethers.getAddress(right);
  if (!same(wiredUsdc.aToken, aUsdcAddress) || !same(wiredUsdc.debtToken, dUsdcAddress)) {
    throw new Error("USDC reserve is not wired to the new Lendora tokens");
  }
  if (!same(wiredEurc.aToken, aEurcAddress) || !same(wiredEurc.debtToken, dEurcAddress)) {
    throw new Error("EURC reserve is not wired to the new Lendora tokens");
  }
  if (!same(await positionNFT.minter(), managerAddress)) {
    throw new Error("PositionNFT minter is not the new PositionManager");
  }
  if (!same(await positionManager.lendingPool(), poolAddress)) {
    throw new Error("PositionManager is not wired to the new LendingPool");
  }
  if (!same(await provider.getLendingPool(), poolAddress)) {
    throw new Error("AddressesProvider still points at the previous pool");
  }

  writeAbi("AToken");
  writeAbi("DebtToken");
  writeAbi("PositionNFT");
  writeAbi("PositionManager");
  writeAbi("LendingPool");

  writeDeployment({
    legacyLendingPool: deployment.lendingPool,
    legacyPositionNFT: deployment.PositionNFT,
    legacyPositionManager: deployment.PositionManager,
    lendingPool: poolAddress,
    deploymentBlock: poolReceipt?.blockNumber ?? deployment.deploymentBlock,
    priceOracle,
    fallbackPriceOracle: fallbackOracle,
    interestRateModel: rateModel,
    markets: {
      USDC: { asset: usdc, aToken: aUsdcAddress, debtToken: dUsdcAddress },
      EURC: { asset: eurc, aToken: aEurcAddress, debtToken: dEurcAddress },
    },
    PositionNFT: nftAddress,
    PositionManager: managerAddress,
    earnVaults: { USDC: usdcVaultAddress, EURC: eurcVaultAddress },
    earnVaultDeploymentBlock:
      (await usdcVault.deploymentTransaction()?.wait())?.blockNumber ??
      deployment.earnVaultDeploymentBlock,
    SpokenPay: spokenPayAddress,
  });

  console.log("\nWaiting for Arcscan to index before verify...");
  await new Promise((resolve) => setTimeout(resolve, 20_000));

  await verify(aUsdcAddress, [usdc, poolAddress]);
  await verify(aEurcAddress, [eurc, poolAddress]);
  await verify(dUsdcAddress, [usdc, poolAddress]);
  await verify(dEurcAddress, [eurc, poolAddress]);
  await verify(nftAddress, []);
  await verify(managerAddress, [poolAddress, nftAddress]);
  await verify(poolAddress, [priceOracle, rateModel]);
  await verify(usdcVaultAddress, [
    usdc,
    poolAddress,
    "Lendora Earn Vault USDC",
    "evUSDC",
    deployer.address,
  ]);
  await verify(eurcVaultAddress, [
    eurc,
    poolAddress,
    "Lendora Earn Vault EURC",
    "evEURC",
    deployer.address,
  ]);
  if (spokenPayAddress && deployment.WalletDomain) {
    await verify(spokenPayAddress, [
      poolAddress,
      deployment.WalletDomain,
      deployer.address,
    ]);
  }

  console.log("\nDone.");
  console.log("aUSDC", aUsdcAddress);
  console.log("aEURC", aEurcAddress);
  console.log("dUSDC", dUsdcAddress);
  console.log("dEURC", dEurcAddress);
  console.log("PositionNFT", nftAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
