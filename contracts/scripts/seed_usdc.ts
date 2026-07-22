import { ethers } from "hardhat";
import deployment from "../deployments/arc-testnet.json";

const ARC_TESTNET_CHAIN_ID = 5_042_002n;
const SEED_AMOUNT = ethers.parseUnits("10", 6);

async function main() {
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== ARC_TESTNET_CHAIN_ID) {
    throw new Error(`Expected Arc Testnet ${ARC_TESTNET_CHAIN_ID}, received ${network.chainId}`);
  }

  const [signer] = await ethers.getSigners();
  const address = await signer.getAddress();
  const usdc = await ethers.getContractAt("IERC20", deployment.markets.USDC.asset, signer);
  const pool = await ethers.getContractAt("LendingPool", deployment.lendingPool, signer);
  const aToken = await ethers.getContractAt("AToken", deployment.markets.USDC.aToken, signer);

  const [walletBalance, suppliedBalance] = await Promise.all([
    usdc.balanceOf(address),
    aToken.balanceOf(address),
  ]);

  if (suppliedBalance !== 0n) {
    throw new Error(
      `Seed position already exists: ${ethers.formatUnits(suppliedBalance, 6)} USDC`,
    );
  }
  if (walletBalance < SEED_AMOUNT) {
    throw new Error(`Insufficient USDC: ${ethers.formatUnits(walletBalance, 6)}`);
  }

  const approval = await usdc.approve(deployment.lendingPool, SEED_AMOUNT);
  console.log(`Approve 10 USDC: ${approval.hash}`);
  await approval.wait();

  const supply = await pool.supply(deployment.markets.USDC.asset, SEED_AMOUNT, address);
  console.log(`Supply 10 USDC: ${supply.hash}`);
  await supply.wait();

  const [endingWalletBalance, endingSuppliedBalance, reserve, allowance] = await Promise.all([
    usdc.balanceOf(address),
    aToken.balanceOf(address),
    pool.getReserveData(deployment.markets.USDC.asset),
    usdc.allowance(address, deployment.lendingPool),
  ]);

  if (endingSuppliedBalance < SEED_AMOUNT) {
    throw new Error(
      `Seed verification failed: ${ethers.formatUnits(endingSuppliedBalance, 6)} aUSDC`,
    );
  }

  console.log(
    JSON.stringify(
      {
        account: address,
        walletUsdc: ethers.formatUnits(endingWalletBalance, 6),
        suppliedUsdc: ethers.formatUnits(endingSuppliedBalance, 6),
        poolLiquidity: ethers.formatUnits(reserve.totalLiquidity, 6),
        poolBorrowed: ethers.formatUnits(reserve.totalBorrowed, 6),
        remainingAllowance: ethers.formatUnits(allowance, 6),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
