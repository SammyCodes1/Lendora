import { ethers } from "hardhat";
import deployment from "../deployments/arc-testnet.json";

const ARC_TESTNET_CHAIN_ID = 5_042_002n;
const SUPPLY_AMOUNT = ethers.parseUnits("10", 6);
const BORROW_AMOUNT = ethers.parseUnits("5", 6);
const REPAY_ALLOWANCE = ethers.parseUnits("6", 6);

async function waitFor(label: string, transaction: { hash: string; wait: () => Promise<unknown> }) {
  console.log(`${label}: ${transaction.hash}`);
  await transaction.wait();
}

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
  const debtToken = await ethers.getContractAt(
    "DebtToken",
    deployment.markets.USDC.debtToken,
    signer,
  );

  const startingUsdc = await usdc.balanceOf(address);
  const startingAToken = await aToken.balanceOf(address);
  const startingDebt = await debtToken.balanceOf(address);

  if (startingUsdc < SUPPLY_AMOUNT) {
    throw new Error(`Insufficient USDC: ${ethers.formatUnits(startingUsdc, 6)}`);
  }
  if (startingAToken !== 0n || startingDebt !== 0n) {
    throw new Error("Smoke test requires no existing USDC supply or debt position");
  }

  await waitFor("Approve 10 USDC supply", await usdc.approve(deployment.lendingPool, SUPPLY_AMOUNT));
  await waitFor(
    "Supply 10 USDC",
    await pool.supply(deployment.markets.USDC.asset, SUPPLY_AMOUNT, address),
  );

  await waitFor(
    "Borrow 5 USDC",
    await pool.borrow(deployment.markets.USDC.asset, BORROW_AMOUNT, address),
  );

  await waitFor(
    "Approve up to 6 USDC repayment",
    await usdc.approve(deployment.lendingPool, REPAY_ALLOWANCE),
  );
  await waitFor(
    "Repay full USDC debt",
    await pool.repay(deployment.markets.USDC.asset, ethers.MaxUint256, address),
  );

  const suppliedBalance = await aToken.balanceOf(address);
  await waitFor(
    "Withdraw full USDC supply",
    await pool.withdraw(deployment.markets.USDC.asset, suppliedBalance, address),
  );

  await waitFor("Reset USDC allowance", await usdc.approve(deployment.lendingPool, 0));

  const [endingUsdc, endingAToken, endingDebt, accountData, reserve] = await Promise.all([
    usdc.balanceOf(address),
    aToken.balanceOf(address),
    debtToken.balanceOf(address),
    pool.getUserAccountData(address),
    pool.getReserveData(deployment.markets.USDC.asset),
  ]);

  if (endingAToken !== 0n || endingDebt !== 0n) {
    throw new Error(
      `Position not closed: aToken=${endingAToken.toString()} debt=${endingDebt.toString()}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        account: address,
        startingUsdc: ethers.formatUnits(startingUsdc, 6),
        endingUsdc: ethers.formatUnits(endingUsdc, 6),
        suppliedUsdc: ethers.formatUnits(SUPPLY_AMOUNT, 6),
        borrowedUsdc: ethers.formatUnits(BORROW_AMOUNT, 6),
        remainingAToken: ethers.formatUnits(endingAToken, 6),
        remainingDebt: ethers.formatUnits(endingDebt, 6),
        healthFactor: accountData.healthFactor.toString(),
        poolLiquidity: ethers.formatUnits(reserve.totalLiquidity, 6),
        poolBorrowed: ethers.formatUnits(reserve.totalBorrowed, 6),
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
