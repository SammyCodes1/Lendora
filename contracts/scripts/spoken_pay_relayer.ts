import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";
import { readFileSync } from "fs";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const RPC_URL = process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY is required in contracts/.env");

const deployment = JSON.parse(
  readFileSync(path.resolve(__dirname, "../deployments/arc-testnet.json"), "utf8"),
) as { SpokenPay?: string };

const SPOKEN_PAY = deployment.SpokenPay;
if (!SPOKEN_PAY) throw new Error("SpokenPay address missing from deployments");

const ABI = [
  "function nextPlanId() view returns (uint256)",
  "function plans(uint256) view returns (address user, address token, address recipient, string domainName, uint128 amount, uint64 interval, uint64 nextRunAt, uint64 minHealthFactorWad, bool fromYieldOnly, bool active)",
  "function executePlan(uint256 planId)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const spokenPay = new ethers.Contract(SPOKEN_PAY, ABI, wallet);
  const nextId = Number(await spokenPay.nextPlanId());
  const now = Math.floor(Date.now() / 1000);
  console.log("SpokenPay", SPOKEN_PAY, "plans", nextId - 1, "signer", wallet.address);

  for (let id = 1; id < nextId; id++) {
    const plan = await spokenPay.plans(id);
    if (!plan.active) continue;
    if (Number(plan.nextRunAt) > now) {
      console.log(`#${id} not due until ${plan.nextRunAt}`);
      continue;
    }
    try {
      const tx = await spokenPay.executePlan(id);
      console.log(`#${id} executing`, tx.hash);
      await tx.wait();
      console.log(`#${id} done`);
    } catch (error) {
      console.log(`#${id} skipped`, error instanceof Error ? error.message : error);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
