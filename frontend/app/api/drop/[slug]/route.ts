import { NextResponse } from "next/server";
import {
  createPublicClient,
  fallback,
  http,
  type Abi,
  type Address,
} from "viem";
import { arcTestnet } from "viem/chains";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { resolveDropSlug } from "@/lib/server/arcDrop";
import deployments from "@/constants/deployments.json";
import arcDropJson from "@/constants/abis/ArcDrop.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Viem public client (same pattern as payRequests.ts) ─────────────────────

const arcRpcUrls = Array.from(
  new Set(
    [
      process.env.ARC_TESTNET_RPC_URL,
      process.env.NEXT_PUBLIC_RPC_URL,
      ...arcTestnet.rpcUrls.default.http,
      "https://rpc.drpc.testnet.arc.network",
      "https://rpc.quicknode.testnet.arc.network",
      "https://rpc.blockdaemon.testnet.arc.network",
    ].filter((url): url is string => Boolean(url)),
  ),
);

const arcClient = createPublicClient({
  chain: arcTestnet,
  transport: fallback(
    arcRpcUrls.map((url) =>
      http(url, {
        retryCount: 0,
        timeout: 12_000,
      }),
    ),
    { retryCount: 1, retryDelay: 250 },
  ),
});

// ─── ArcDrop ABI ─────────────────────────────────────────────────────────────

const arcDropAbi = arcDropJson as Abi;

const arcDropAddress = (deployments as Record<string, unknown>).ArcDrop as
  | Address
  | undefined;

/**
 * GET /api/drop/[slug]
 *
 * Resolves a slug to a dropId, then reads the live on-chain Drop struct via
 * getDropStatus(dropId). Returns both the resolved dropId and the full drop
 * state so the claim page can render without an extra RPC call.
 *
 * The on-chain data is always the source of truth for balance and claim status.
 * Redis is only used for the slug → id lookup.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const limited = enforceRateLimit(request, {
    scope: "arcdrop-resolve-slug",
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { slug } = await params;

  const dropId = await resolveDropSlug(slug);
  if (dropId === null) {
    return NextResponse.json(
      { error: "Drop link not found." },
      { status: 404 },
    );
  }

  if (!arcDropAddress) {
    return NextResponse.json(
      { error: "ArcDrop contract not deployed yet." },
      { status: 503 },
    );
  }

  try {
    type DropTuple = {
      creator: `0x${string}`;
      asset: `0x${string}`;
      totalAmount: bigint;
      remainingAmount: bigint;
      mode: number;
      maxClaimants: bigint;
      claimantsCount: bigint;
      perClaimAmount: bigint;
      active: boolean;
      createdAt: bigint;
      expiresAt: bigint;
    };

    const dropRaw = (await arcClient.readContract({
      address: arcDropAddress,
      abi: arcDropAbi,
      functionName: "getDropStatus",
      args: [BigInt(dropId)],
    })) as DropTuple;

    // Serialise bigints to strings for JSON transport.
    const drop = {
      creator: dropRaw.creator,
      asset: dropRaw.asset,
      totalAmount: dropRaw.totalAmount.toString(),
      remainingAmount: dropRaw.remainingAmount.toString(),
      mode: Number(dropRaw.mode), // 0 = EQUAL_SPLIT, 1 = CLAIM_ALL
      maxClaimants: dropRaw.maxClaimants.toString(),
      claimantsCount: dropRaw.claimantsCount.toString(),
      perClaimAmount: dropRaw.perClaimAmount.toString(),
      active: dropRaw.active,
      createdAt: dropRaw.createdAt.toString(),
      expiresAt: dropRaw.expiresAt.toString(),
    };

    return NextResponse.json({ dropId, drop });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not read drop from chain.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
