import hre, { artifacts, ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Resume after 23_redeploy_lendora_market_tokens.ts lost the RPC mid-run.
 * The Lendora-named aTokens, debt tokens, Position NFT, and new pool already
 * exist and are reserve-wired. This finishes PositionManager, vaults,
 * SpokenPay, the addresses provider, deployment files, and verification.
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

const POOL = "0x9dCA5E8185c21fF958c9e7e1f4BbD8e0AfFEf61E";
const A_USDC = "0x848B0c56bAd3177FA1b9613c5DD2550e7F500da9";
const A_EURC = "0xFd60F777558053601e315D578Ab0efcBd0D4C5b9";
const D_USDC = "0x4AFda16D11EF44658356f6912b613A2423a6a868";
const D_EURC = "0xB0b81b427BE53d396ca323eDBfcaaF225f2af3af";
const NFT = "0x11Dd45863614C7D69B50083ac4E16A7a41F531E3";

function readDeployment() {
  return JSON.parse(fs.readFileSync(DEPLOYMENT_PATHS[0], "utf8")) as Record<string, unknown> & {
    lendingPool: string;
    addressesProvider: string;
    markets: { USDC: { asset: string }; EURC: { asset: string } };
    PositionNFT?: string;
    PositionManager?: string;
    WalletDomain?: string;
    SpokenPay?: string;
    earnVaultDeploymentBlock?: number;
    deploymentBlock?: number;
  };
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
    await hre.run("verify:verify", { address, constructorArguments });
    console.log("  verified", address);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already verified/i.test(message)) {
      console.log("  already verified", address);
      return;
    }
    console.warn("  verify failed", address, message.slice(0, 500));
  }
}

const same = (left: string, right: string) =>
  ethers.getAddress(left) === ethers.getAddress(right);

async function main() {
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY is required to deploy to Arc Testnet");
  }

  const deployment = readDeployment();
  const [deployer] = await ethers.getSigners();
  const usdc = deployment.markets.USDC.asset;
  const eurc = deployment.markets.EURC.asset;
  console.log("Finishing Lendora market wiring with:", deployer.address);

  const pool = await ethers.getContractAt("LendingPool", POOL);
  const positionNFT = await ethers.getContractAt("PositionNFT", NFT);
  const priceOracle = await pool.priceOracle();
  const rateModel = await pool.interestRateModel();

  const PositionManager = await ethers.getContractFactory("PositionManager");
  const positionManager = await PositionManager.deploy(POOL, NFT);
  await positionManager.waitForDeployment();
  const managerAddress = await positionManager.getAddress();
  console.log("PositionManager:", managerAddress);

  const currentMinter = await positionNFT.minter();
  if (currentMinter === ethers.ZeroAddress) {
    await (await positionNFT.setMinter(managerAddress)).wait();
  } else if (!same(currentMinter, managerAddress)) {
    throw new Error(`PositionNFT minter already set to ${currentMinter}`);
  }
  await (await pool.setBorrowDelegate(managerAddress, true)).wait();

  const EarnVault = await ethers.getContractFactory("EarnVault");
  const usdcVault = await EarnVault.deploy(
    usdc,
    POOL,
    "Lendora Earn Vault USDC",
    "evUSDC",
    deployer.address,
  );
  await usdcVault.waitForDeployment();
  const eurcVault = await EarnVault.deploy(
    eurc,
    POOL,
    "Lendora Earn Vault EURC",
    "evEURC",
    deployer.address,
  );
  await eurcVault.waitForDeployment();
  const usdcVaultAddress = await usdcVault.getAddress();
  const eurcVaultAddress = await eurcVault.getAddress();
  const usdcVaultReceipt = await usdcVault.deploymentTransaction()?.wait();
  console.log("EarnVault USDC:", usdcVaultAddress);
  console.log("EarnVault EURC:", eurcVaultAddress);

  let spokenPayAddress = deployment.SpokenPay as string | undefined;
  let spokenPayBlock: number | undefined;
  if (deployment.WalletDomain) {
    const SpokenPay = await ethers.getContractFactory("SpokenPay");
    const spokenPay = await SpokenPay.deploy(
      POOL,
      deployment.WalletDomain,
      deployer.address,
    );
    await spokenPay.waitForDeployment();
    spokenPayAddress = await spokenPay.getAddress();
    spokenPayBlock = (await spokenPay.deploymentTransaction()?.wait())?.blockNumber;
    console.log("SpokenPay:", spokenPayAddress);
  }

  const provider = await ethers.getContractAt(
    "LendingPoolAddressesProvider",
    deployment.addressesProvider,
  );
  await (await provider.setLendingPool(POOL)).wait();

  const wiredUsdc = await pool.getReserveData(usdc);
  const wiredEurc = await pool.getReserveData(eurc);
  if (!same(wiredUsdc.aToken, A_USDC) || !same(wiredUsdc.debtToken, D_USDC)) {
    throw new Error("USDC reserve is not wired to the new Lendora tokens");
  }
  if (!same(wiredEurc.aToken, A_EURC) || !same(wiredEurc.debtToken, D_EURC)) {
    throw new Error("EURC reserve is not wired to the new Lendora tokens");
  }
  if (!same(await positionNFT.minter(), managerAddress)) {
    throw new Error("PositionNFT minter is not the new PositionManager");
  }
  if (!same(await positionManager.lendingPool(), POOL) || !same(await positionManager.positionNFT(), NFT)) {
    throw new Error("PositionManager is not wired to the new pool and NFT");
  }
  if (!same(await provider.getLendingPool(), POOL)) {
    throw new Error("AddressesProvider still points at the previous pool");
  }

  writeAbi("AToken");
  writeAbi("DebtToken");
  writeAbi("PositionNFT");
  writeAbi("PositionManager");
  writeAbi("LendingPool");

  const poolBlock = await ethers.provider.getTransactionCount(POOL).then(async () => {
    const history = await ethers.provider.getBlockNumber();
    return history;
  });

  writeDeployment({
    legacyLendingPool: deployment.lendingPool,
    legacyPositionNFT: deployment.PositionNFT,
    legacyPositionManager: deployment.PositionManager,
    lendingPool: POOL,
    priceOracle,
    fallbackPriceOracle: await pool.fallbackPriceOracle(),
    interestRateModel: rateModel,
    markets: {
      USDC: { asset: usdc, aToken: A_USDC, debtToken: D_USDC },
      EURC: { asset: eurc, aToken: A_EURC, debtToken: D_EURC },
    },
    PositionNFT: NFT,
    PositionManager: managerAddress,
    earnVaults: { USDC: usdcVaultAddress, EURC: eurcVaultAddress },
    earnVaultDeploymentBlock: usdcVaultReceipt?.blockNumber ?? deployment.earnVaultDeploymentBlock,
    SpokenPay: spokenPayAddress,
    ...(spokenPayBlock ? { spokenPayDeploymentBlock: spokenPayBlock } : {}),
    marketTokenDeploymentBlock: poolBlock,
  });

  console.log("\nWaiting for Arcscan to index before verify...");
  await new Promise((resolve) => setTimeout(resolve, 20_000));

  await verify(A_USDC, [usdc, POOL]);
  await verify(A_EURC, [eurc, POOL]);
  await verify(D_USDC, [usdc, POOL]);
  await verify(D_EURC, [eurc, POOL]);
  await verify(NFT, []);
  await verify(managerAddress, [POOL, NFT]);
  await verify(POOL, [priceOracle, rateModel]);
  await verify(usdcVaultAddress, [usdc, POOL, "Lendora Earn Vault USDC", "evUSDC", deployer.address]);
  await verify(eurcVaultAddress, [eurc, POOL, "Lendora Earn Vault EURC", "evEURC", deployer.address]);
  if (spokenPayAddress && deployment.WalletDomain) {
    await verify(spokenPayAddress, [POOL, deployment.WalletDomain, deployer.address]);
  }

  console.log("\nDone.");
  console.log("aUSDC", A_USDC);
  console.log("aEURC", A_EURC);
  console.log("dUSDC", D_USDC);
  console.log("dEURC", D_EURC);
  console.log("PositionNFT", NFT);
  console.log("PositionManager", managerAddress);
  console.log("LendingPool", POOL);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
