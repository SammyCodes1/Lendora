/**
 * Applies post-audit risk parameter updates on a live LendingPool.
 *
 * H-1: Widen USDC LTV–LT buffer (75%→70% LTV, LT 80%).
 * H-3: Lower EURC LTV further (70%→60% LTV, LT 78%).
 *
 * Usage (from contracts/):
 *   $env:PRIVATE_KEY="0x..."; npx hardhat run scripts/update_risk_params.ts --network arc_testnet
 */
import { ethers } from "hardhat";
import { ARC_TESTNET_ADDRESSES } from "../constants/addresses";
import deployment from "../deployments/arc-testnet.json";

const USDC_LTV = 7_000;
const USDC_LT = 8_000;
const USDC_BONUS = 500;
const EURC_LTV = 6_000;
const EURC_LT = 7_800;
const EURC_BONUS = 600;

async function main() {
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY is required");
  }

  const [signer] = await ethers.getSigners();
  const pool = await ethers.getContractAt("LendingPool", deployment.lendingPool);
  const owner = await pool.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Signer ${signer.address} is not pool owner ${owner}`);
  }

  console.log(`Updating risk params on ${deployment.lendingPool}`);
  console.log(`  USDC: LTV ${USDC_LTV} LT ${USDC_LT} bonus ${USDC_BONUS}`);
  console.log(`  EURC: LTV ${EURC_LTV} LT ${EURC_LT} bonus ${EURC_BONUS}`);

  await (
    await pool.setReserveRiskParameters(
      ARC_TESTNET_ADDRESSES.USDC,
      USDC_LTV,
      USDC_LT,
      USDC_BONUS,
    )
  ).wait();
  await (
    await pool.setReserveRiskParameters(
      ARC_TESTNET_ADDRESSES.EURC,
      EURC_LTV,
      EURC_LT,
      EURC_BONUS,
    )
  ).wait();

  const usdc = await pool.getReserveData(ARC_TESTNET_ADDRESSES.USDC);
  const eurc = await pool.getReserveData(ARC_TESTNET_ADDRESSES.EURC);
  console.log("Applied:");
  console.log(`  USDC ltv=${usdc.ltv} lt=${usdc.liquidationThreshold} bonus=${usdc.liquidationBonus}`);
  console.log(`  EURC ltv=${eurc.ltv} lt=${eurc.liquidationThreshold} bonus=${eurc.liquidationBonus}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
