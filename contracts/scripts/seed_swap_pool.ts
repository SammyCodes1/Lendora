import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * seed_swap_pool.ts
 * ─────────────────
 * Seeds initial USDC/EURC liquidity into the deployed SwapPool so the
 * ArcLend route has depth immediately after deploy.
 *
 * Env overrides:
 *   SEED_USDC  — USDC amount in whole tokens (default 1000)
 *   SEED_EURC  — EURC amount in whole tokens (default 920 ≈ 0.92 EUR/USD)
 *
 * Usage:
 *   npx hardhat run scripts/seed_swap_pool.ts --network arc_testnet
 */

const USDC = "0x3600000000000000000000000000000000000000";
const EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

function loadSwapPoolAddress(): string {
  if (process.env.SWAP_POOL_ADDRESS) return process.env.SWAP_POOL_ADDRESS;
  const candidates = [
    path.resolve(__dirname, "../deployments/arc-testnet.json"),
    path.resolve(__dirname, "../../constants/deployments.json"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (data.SwapPool) return data.SwapPool as string;
  }
  throw new Error("SwapPool address not found — deploy first or set SWAP_POOL_ADDRESS");
}

async function main() {
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY is required — see contracts/.env");
  }

  const [deployer] = await ethers.getSigners();
  const poolAddress = loadSwapPoolAddress();
  console.log("Seeding SwapPool", poolAddress);
  console.log("Deployer:", deployer.address);

  const pool = await ethers.getContractAt("SwapPool", poolAddress);
  const usdc = new ethers.Contract(USDC, ERC20_ABI, deployer);
  const eurc = new ethers.Contract(EURC, ERC20_ABI, deployer);

  const seedUsdcWhole = BigInt(process.env.SEED_USDC ?? "1000");
  const seedEurcWhole = BigInt(process.env.SEED_EURC ?? "920");
  const amountA = seedUsdcWhole * 10n ** 6n;
  const amountB = seedEurcWhole * 10n ** 6n;

  console.log("Target deposit:", seedUsdcWhole.toString(), "USDC +", seedEurcWhole.toString(), "EURC");

  const balA = await usdc.balanceOf(deployer.address);
  const balB = await eurc.balanceOf(deployer.address);
  console.log("Wallet USDC:", balA.toString());
  console.log("Wallet EURC:", balB.toString());
  if (balA < amountA || balB < amountB) {
    throw new Error(
      `Insufficient balances for seed. Need ${amountA} USDC and ${amountB} EURC.`,
    );
  }

  const allowanceA = await usdc.allowance(deployer.address, poolAddress);
  if (allowanceA < amountA) {
    console.log("Approving USDC…");
    await (await usdc.approve(poolAddress, amountA)).wait();
  }
  const allowanceB = await eurc.allowance(deployer.address, poolAddress);
  if (allowanceB < amountB) {
    console.log("Approving EURC…");
    await (await eurc.approve(poolAddress, amountB)).wait();
  }

  console.log("addLiquidity…");
  const tx = await pool.addLiquidity(amountA, amountB, 0n);
  const receipt = await tx.wait();
  console.log("✅ Seeded. tx:", receipt?.hash);

  console.log("reserveA:", (await pool.reserveA()).toString());
  console.log("reserveB:", (await pool.reserveB()).toString());
  console.log("LP balance:", (await pool.balanceOf(deployer.address)).toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
