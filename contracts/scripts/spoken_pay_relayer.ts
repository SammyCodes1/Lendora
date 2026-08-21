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
  "function previewPlan(uint256 planId) view returns (bool due, bool active, bytes32 blocker, address payTo, uint256 walletBalance, uint256 healthFactor)",
  "function lastOutcome(uint256 planId) view returns (bytes32)",
  "function executePlan(uint256 planId) returns (bytes32)",
];

function bytes32ToLabel(value: string) {
  let out = "";
  for (let i = 2; i < value.length; i += 2) {
    const code = Number.parseInt(value.slice(i, i + 2), 16);
    if (!code) break;
    out += String.fromCharCode(code);
  }
  return out;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const spokenPay = new ethers.Contract(SPOKEN_PAY, ABI, wallet);
  const nextId = Number(await spokenPay.nextPlanId());
  console.log("SpokenPay", SPOKEN_PAY, "plans", nextId - 1, "signer", wallet.address);

  for (let id = 1; id < nextId; id++) {
    const preview = await spokenPay.previewPlan(id);
    if (!preview.active || !preview.due) {
      console.log(`#${id} ${bytes32ToLabel(preview.blocker) || "idle"}`);
      continue;
    }
    try {
      const tx = await spokenPay.executePlan(id);
      console.log(`#${id} executing`, tx.hash);
      await tx.wait();
      console.log(`#${id} ${bytes32ToLabel(await spokenPay.lastOutcome(id))}`);
    } catch (error) {
      console.log(`#${id} skipped`, error instanceof Error ? error.message : error);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
