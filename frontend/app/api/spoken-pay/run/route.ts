import { NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import deployments from "@/constants/deployments.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const spokenPayAddress = (
  deployments as typeof deployments & { SpokenPay?: Address }
).SpokenPay;

const spokenPayAbi = parseAbi([
  "function nextPlanId() view returns (uint256)",
  "function previewPlan(uint256 planId) view returns (bool due, bool active, bytes32 blocker, address payTo, uint256 walletBalance, uint256 healthFactor)",
  "function lastOutcome(uint256 planId) view returns (bytes32)",
  "function executePlan(uint256 planId) returns (bytes32)",
]);

function bytes32ToLabel(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("0x")) return "";
  let out = "";
  for (let i = 2; i < value.length; i += 2) {
    const code = Number.parseInt(value.slice(i, i + 2), 16);
    if (!code) break;
    out += String.fromCharCode(code);
  }
  return out;
}

const RPC_URL =
  process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!spokenPayAddress) {
    return NextResponse.json(
      { error: "SpokenPay is not deployed." },
      { status: 500 },
    );
  }

  const keeperKey = process.env.KEEPER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!keeperKey) {
    return NextResponse.json(
      { error: "KEEPER_PRIVATE_KEY is not configured." },
      { status: 500 },
    );
  }

  const account = privateKeyToAccount(
    keeperKey.startsWith("0x")
      ? (keeperKey as `0x${string}`)
      : (`0x${keeperKey}` as `0x${string}`),
  );
  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(RPC_URL),
  });
  const walletClient = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(RPC_URL),
  });

  const nextPlanId = Number(
    await publicClient.readContract({
      address: spokenPayAddress,
      abi: spokenPayAbi,
      functionName: "nextPlanId",
    }),
  );

  const results: Array<{ id: number; outcome: string; hash?: string }> = [];
  for (let id = 1; id < nextPlanId; id++) {
    const preview = await publicClient.readContract({
      address: spokenPayAddress,
      abi: spokenPayAbi,
      functionName: "previewPlan",
      args: [BigInt(id)],
    });
    const due = Boolean(preview[0]);
    const active = Boolean(preview[1]);
    if (!due || !active) continue;
    try {
      const hash = await walletClient.writeContract({
        address: spokenPayAddress,
        abi: spokenPayAbi,
        functionName: "executePlan",
        args: [BigInt(id)],
        gas: 400_000n,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const outcome = bytes32ToLabel(
        await publicClient.readContract({
          address: spokenPayAddress,
          abi: spokenPayAbi,
          functionName: "lastOutcome",
          args: [BigInt(id)],
        }),
      );
      results.push({
        id,
        outcome:
          receipt.status === "success" ? outcome || "executed" : "reverted",
        hash,
      });
    } catch (error) {
      results.push({
        id,
        outcome:
          error instanceof Error ? error.message.slice(0, 180) : "failed",
      });
    }
  }

  return NextResponse.json({
    relayer: account.address,
    scanned: nextPlanId - 1,
    ran: results,
    blockersSample: results.length === 0 ? "none due" : undefined,
  });
}

export async function POST(request: Request) {
  return GET(request);
}
