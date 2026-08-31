import "server-only";

import {
  createPublicClient,
  fallback,
  http,
  parseAbiItem,
  type Address,
} from "viem";
import { arcTestnet } from "viem/chains";
import deployments from "@/constants/deployments.json";
import type { DropClaim } from "@/lib/arcDrop";

const dropClaimedEvent = parseAbiItem(
  "event DropClaimed(uint256 indexed dropId, address indexed claimant, uint256 amount, uint256 claimantsCount)",
);

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

const arcDropAddress = (deployments as Record<string, unknown>).ArcDrop as
  | Address
  | undefined;

const legacyArcDropAddress = (deployments as Record<string, unknown>)
  .legacyArcDrop as Address | undefined;

const fromBlock = BigInt(
  typeof (deployments as Record<string, unknown>).ArcDropDeploymentBlock ===
    "number"
    ? ((deployments as Record<string, unknown>).ArcDropDeploymentBlock as number)
    : 0,
);

const legacyFromBlock = BigInt(
  typeof (deployments as Record<string, unknown>)
    .legacyArcDropDeploymentBlock === "number"
    ? ((deployments as Record<string, unknown>)
        .legacyArcDropDeploymentBlock as number)
    : 0,
);

export function getArcDropAddress() {
  return arcDropAddress;
}

export function getLegacyArcDropAddress() {
  return legacyArcDropAddress;
}

export function fromBlockForDropContract(contract: Address) {
  if (
    legacyArcDropAddress &&
    contract.toLowerCase() === legacyArcDropAddress.toLowerCase()
  ) {
    return legacyFromBlock;
  }
  return fromBlock;
}

export function dropContractsToTry(preferred?: string | null): Address[] {
  const out: Address[] = [];
  const add = (value?: string | null) => {
    if (!value) return;
    const lower = value.toLowerCase();
    if (out.some((item) => item.toLowerCase() === lower)) return;
    out.push(value as Address);
  };
  add(preferred);
  add(arcDropAddress);
  add(legacyArcDropAddress);
  return out;
}

export async function fetchDropClaims(
  dropId: number,
  contract: Address = arcDropAddress as Address,
): Promise<DropClaim[]> {
  if (!contract || !Number.isInteger(dropId) || dropId < 1) return [];

  const logs = await arcClient.getLogs({
    address: contract,
    event: dropClaimedEvent,
    args: { dropId: BigInt(dropId) },
    fromBlock: fromBlockForDropContract(contract),
    toBlock: "latest",
  });

  return logs.map((log) => ({
    claimant: (log.args.claimant ??
      "0x0000000000000000000000000000000000000000") as string,
    amount: (log.args.amount ?? 0n).toString(),
    claimantsCount: (log.args.claimantsCount ?? 0n).toString(),
    txHash: log.transactionHash,
    blockNumber: log.blockNumber.toString(),
  }));
}
