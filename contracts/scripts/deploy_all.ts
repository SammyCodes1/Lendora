import { ethers } from "hardhat";
import { ARC_TESTNET_ADDRESSES } from "../constants/addresses";

async function deployReserveTokens(asset: string, pool: string) {
  const AToken = await ethers.getContractFactory("AToken");
  const aToken = await AToken.deploy(asset, pool);
  await aToken.waitForDeployment();

  const DebtToken = await ethers.getContractFactory("DebtToken");
  const debtToken = await DebtToken.deploy(asset, pool);
  await debtToken.waitForDeployment();

  return {
    aToken: await aToken.getAddress(),
    debtToken: await debtToken.getAddress(),
  };
}

async function main() {
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY is required to deploy to Arc Testnet");
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deploying ArcLend with:", deployer.address);
  console.log("Fund this address with Arc Testnet USDC: https://faucet.circle.com");

  const AddressesProvider = await ethers.getContractFactory("LendingPoolAddressesProvider");
  const addressesProvider = await AddressesProvider.deploy();
  await addressesProvider.waitForDeployment();

  const InterestRateModel = await ethers.getContractFactory("InterestRateModel");
  const interestRateModel = await InterestRateModel.deploy();
  await interestRateModel.waitForDeployment();

  const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
  const priceOracle = await MockPriceOracle.deploy(
    ARC_TESTNET_ADDRESSES.USDC,
    ARC_TESTNET_ADDRESSES.EURC,
  );
  await priceOracle.waitForDeployment();

  const LendingPool = await ethers.getContractFactory("LendingPool");
  const lendingPool = await LendingPool.deploy(
    await priceOracle.getAddress(),
    await interestRateModel.getAddress(),
  );
  await lendingPool.waitForDeployment();
  const lendingPoolAddress = await lendingPool.getAddress();

  const usdc = await deployReserveTokens(ARC_TESTNET_ADDRESSES.USDC, lendingPoolAddress);
  const eurc = await deployReserveTokens(ARC_TESTNET_ADDRESSES.EURC, lendingPoolAddress);

  await (
    await lendingPool.initReserve(
      ARC_TESTNET_ADDRESSES.USDC,
      usdc.aToken,
      usdc.debtToken,
      7500,
      8000,
      500,
    )
  ).wait();
  await (
    await lendingPool.initReserve(
      ARC_TESTNET_ADDRESSES.EURC,
      eurc.aToken,
      eurc.debtToken,
      7000,
      7800,
      600,
    )
  ).wait();

  await (await addressesProvider.setLendingPool(lendingPoolAddress)).wait();
  await (await addressesProvider.setPriceOracle(await priceOracle.getAddress())).wait();
  await (
    await addressesProvider.setInterestRateModel(await interestRateModel.getAddress())
  ).wait();

  const deployment = {
    chainId: 5042002,
    addressesProvider: await addressesProvider.getAddress(),
    lendingPool: lendingPoolAddress,
    priceOracle: await priceOracle.getAddress(),
    interestRateModel: await interestRateModel.getAddress(),
    markets: {
      USDC: { asset: ARC_TESTNET_ADDRESSES.USDC, ...usdc },
      EURC: { asset: ARC_TESTNET_ADDRESSES.EURC, ...eurc },
    },
  };

  console.log(JSON.stringify(deployment, null, 2));
  console.log(`Explorer: https://testnet.arcscan.app/address/${lendingPoolAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
