import fs from "node:fs";
import path from "node:path";
import { artifacts, ethers } from "hardhat";
import { ARC_TESTNET_ADDRESSES } from "../constants/addresses";

const A = {
  addressesProvider: "0xC48674acd3CafDd5746A94B5144eA57672592bF3",
  interestRateModel: "0x635C19a64bbcd09E5D70eFFE06484eb1E4D70190",
  priceOracle: "0x5D401B38686245B57Efb682828877a3124d36653",
  fallbackPriceOracle: "0x39f74EB42C061E7eCA04232063DeE66E7CD1358B",
  lendingPool: "0x1D1d19F958cDB6FA2e6C7E5DC16F0a39fe066c9f",
  aUsdc: "0x6BAD029528233595D856f03D31f19F9dC10B68D1",
  debtUsdc: "0xfd9Bb99809eA2d6d8F06381EA90a5B195EC93cF9",
  aEurc: "0xA97374A23f9D18422446c9cBF53D06c986091b61",
  debtEurc: "0xa45792794d8CfB8dCF8EE78713596513155bA51f",
  positionNft: "0xf0d0713609171173616c4167732a05Bf3982F8a9",
  positionManager: "0xa5CA2C82D5DC01E067E0F0337c8f73454C74a93F",
  walletDomain: "0x29850FCb158C7f27Df180d7844e5B0D51Da9D20C",
  domainMarketplace: "0xFeEebE745101BBE3CBf2f983Ba1606Bc86c541C6",
  usdcVault: "0xAA127DEB9c3f72f8D5364B49458f6b14F0540D5b",
  eurcVault: "0x57FA5403192657ed5B950C1CD4F06f361F38B14A",
  referralController: "0xc9D5aD567a2ca40697161823eFC49Fef193A25EC",
};

const BLOCKS = {
  deployment: 52_118_513,
  walletDomain: 52_118_852,
  domainMarketplace: 52_118_867,
  earnVault: 52_118_878,
};

async function codeHash(address: string) {
  const code = await ethers.provider.getCode(address);
  if (code === "0x") throw new Error(`No contract code at ${address}`);
  return ethers.keccak256(code as `0x${string}`);
}

async function runtimeHash(name: string) {
  const artifact = await artifacts.readArtifact(name);
  return ethers.keccak256(artifact.deployedBytecode as `0x${string}`);
}

async function main() {
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 5_042_002n) throw new Error(`Wrong chain ${network.chainId}`);
  const [deployer] = await ethers.getSigners();

  for (const address of Object.values(A)) await codeHash(address);

  const pool: any = await ethers.getContractAt("LendingPool", A.lendingPool);
  const provider: any = await ethers.getContractAt("LendingPoolAddressesProvider", A.addressesProvider);
  const primary: any = await ethers.getContractAt("MockPriceOracle", A.priceOracle);
  const fallback: any = await ethers.getContractAt("MockPriceOracle", A.fallbackPriceOracle);
  const positionNft: any = await ethers.getContractAt("PositionNFT", A.positionNft);
  const controller: any = await ethers.getContractAt("EarnReferralController", A.referralController);

  if ((await pool.fallbackPriceOracle()) !== ethers.getAddress(A.fallbackPriceOracle)) throw new Error("Fallback oracle mismatch");
  if ((await pool.supplyCaps(ARC_TESTNET_ADDRESSES.USDC)) !== 1_000_000n * 10n ** 6n) throw new Error("USDC supply cap mismatch");
  if ((await pool.borrowCaps(ARC_TESTNET_ADDRESSES.USDC)) !== 700_000n * 10n ** 6n) throw new Error("USDC borrow cap mismatch");
  if ((await pool.supplyCaps(ARC_TESTNET_ADDRESSES.EURC)) !== 1_000_000n * 10n ** 6n) throw new Error("EURC supply cap mismatch");
  if ((await pool.borrowCaps(ARC_TESTNET_ADDRESSES.EURC)) !== 700_000n * 10n ** 6n) throw new Error("EURC borrow cap mismatch");
  if ((await primary.maxPriceAge()) !== 86_400n) throw new Error("Primary oracle age mismatch");
  if ((await fallback.maxPriceAge()) !== 604_800n) throw new Error("Fallback oracle age mismatch");
  if ((await provider.getLendingPool()) !== ethers.getAddress(A.lendingPool)) throw new Error("Provider pool mismatch");
  if ((await positionNft.minter()) !== ethers.getAddress(A.positionManager)) throw new Error("Position minter mismatch");

  for (const [vault, asset] of [
    [A.usdcVault, ARC_TESTNET_ADDRESSES.USDC],
    [A.eurcVault, ARC_TESTNET_ADDRESSES.EURC],
  ]) {
    const config = await controller.vaultConfigs(vault);
    if (!config.enabled) {
      await (await controller.configureVault(vault, asset, true)).wait();
    }
  }

  const referralTx = await ethers.provider.getTransactionReceipt(
    "0x7229a0dc022057d863b9a886428b5ad88aa8f4c21ab58d0ce4bd06160c24899f",
  );
  if (!referralTx) throw new Error("Referral deployment receipt unavailable");

  const deployment = {
    chainId: 5_042_002,
    deploymentBlock: BLOCKS.deployment,
    deployer: deployer.address,
    addressesProvider: A.addressesProvider,
    lendingPool: A.lendingPool,
    priceOracle: A.priceOracle,
    fallbackPriceOracle: A.fallbackPriceOracle,
    interestRateModel: A.interestRateModel,
    markets: {
      USDC: { asset: ARC_TESTNET_ADDRESSES.USDC, aToken: A.aUsdc, debtToken: A.debtUsdc },
      EURC: { asset: ARC_TESTNET_ADDRESSES.EURC, aToken: A.aEurc, debtToken: A.debtEurc },
    },
    riskConfiguration: {
      USDC: { ltv: 7_000, liquidationThreshold: 8_000, liquidationBonus: 500, supplyCap: "1000000000000", borrowCap: "700000000000" },
      EURC: { ltv: 6_000, liquidationThreshold: 7_800, liquidationBonus: 600, supplyCap: "1000000000000", borrowCap: "700000000000" },
      primaryMaxPriceAge: "86400",
      fallbackMaxPriceAge: "604800",
    },
    PositionNFT: A.positionNft,
    PositionManager: A.positionManager,
    WalletDomain: A.walletDomain,
    walletDomainDeploymentBlock: BLOCKS.walletDomain,
    DomainMarketplace: A.domainMarketplace,
    domainMarketplaceDeploymentBlock: BLOCKS.domainMarketplace,
    earnVaults: { USDC: A.usdcVault, EURC: A.eurcVault },
    earnVaultDeploymentBlock: BLOCKS.earnVault,
    EarnReferralController: A.referralController,
    earnReferralControllerDeploymentBlock: referralTx.blockNumber,
    artifactRuntimeHashes: {
      LendingPool: await runtimeHash("LendingPool"),
      MockPriceOracle: await runtimeHash("MockPriceOracle"),
      InterestRateModel: await runtimeHash("InterestRateModel"),
      LendingPoolAddressesProvider: await runtimeHash("LendingPoolAddressesProvider"),
    },
  };

  const serialized = JSON.stringify(deployment, null, 2) + "\n";
  fs.writeFileSync(path.join(__dirname, "..", "deployments", "arc-testnet.json"), serialized);
  fs.writeFileSync(path.join(__dirname, "..", "..", "frontend", "constants", "deployments.json"), serialized);
  console.log(`Finalized ArcLend deployment at ${A.lendingPool}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
