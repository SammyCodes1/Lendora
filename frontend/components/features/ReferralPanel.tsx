"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Gift,
  Loader2,
  Users,
} from "lucide-react";
import {
  formatUnits,
  isAddress,
  parseAbi,
  parseAbiItem,
  type Address,
  type Hash,
} from "viem";
import {
  useChainId,
  usePublicClient,
  useSwitchChain,
} from "wagmi";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { ARCLEND_PROTOCOL_CONTRACTS } from "@/constants/contracts";
import deployments from "@/constants/deployments.json";
import {
  EARN_REFERRAL_CONTROLLER_ADDRESS,
  useEarnVaultAction,
  type EarnReferralSummary,
  type EarnVaultMarket,
} from "@/hooks/useEarnVaults";
import { showToast } from "@/lib/toast";
import {
  ARCSCAN_TX,
  formatTokenAmount,
} from "@/components/modals/modalUtils";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const DOMAIN_SUFFIX_PATTERN = /\.(?:arclend|arc)$/;
const DOMAIN_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;
const walletDomainAbi = parseAbi([
  "function resolveDomain(string name) view returns (address)",
]);
const referrerRegisteredEvent = parseAbiItem(
  "event ReferrerRegistered(address indexed user, address indexed referrer)",
);
const referralDepositEvent = parseAbiItem(
  "event ReferralDeposit(address indexed vault, address indexed user, address indexed referrer, address asset, uint256 assets, uint256 reward, uint256 points)",
);
const LOG_CHUNK_SIZE = 9_000n;
const LOG_REQUEST_TIMEOUT_MS = 10_000;

type ReferredUserVolume = {
  user: Address;
  totalVolume: bigint;
  volumes: Record<string, bigint>;
  swapVolumes: Record<string, bigint>;
};

type ProfileVolumeResponse = {
  volume?: Record<string, { outgoing?: string }>;
};

function normalizeDomainInput(value: string) {
  return value.trim().toLowerCase().replace(DOMAIN_SUFFIX_PATTERN, "");
}

export function ReferralPanel({
  referral,
  markets,
  onRefresh,
}: {
  referral: EarnReferralSummary;
  markets: EarnVaultMarket[];
  onRefresh: () => Promise<unknown>;
}) {
  const [referrerInput, setReferrerInput] = useState("");
  const [lastHash, setLastHash] = useState<Hash | null>(null);
  const { address, source } = useArcLendAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: 5042002 });
  const referralAction = useEarnVaultAction();
  const [referredUsers, setReferredUsers] = useState<ReferredUserVolume[]>([]);
  const [isLoadingReferredUsers, setIsLoadingReferredUsers] = useState(false);
  const [referredUsersError, setReferredUsersError] = useState<string | null>(null);
  const referralLink =
    typeof window !== "undefined" && address
      ? `${window.location.origin}/earn?ref=${address}`
      : "";
  const normalizedLevel = Math.min(Math.max(referral.level, 1), 5);
  const assetSymbolByAddress = useMemo(
    () =>
      new Map(
        markets.map((market) => [market.asset.toLowerCase(), market.symbol]),
      ),
    [markets],
  );

  const ensureArc = useCallback(async () => {
    if (!address) {
      throw new Error("Connect your wallet first.");
    }
    if (!publicClient) {
      throw new Error("Arc client is unavailable.");
    }
    if (source !== "email" && chainId !== 5042002) {
      await switchChainAsync({ chainId: 5042002 });
    }
  }, [address, chainId, publicClient, source, switchChainAsync]);

  const resolveReferrer = useCallback(
    async (value: string): Promise<Address> => {
      const candidate = value.trim();
      if (isAddress(candidate)) {
        return candidate as Address;
      }

      const domainName = normalizeDomainInput(candidate);
      if (!DOMAIN_NAME_PATTERN.test(domainName)) {
        throw new Error("Enter a valid wallet address or .arclend domain.");
      }

      const resolved = (await publicClient!.readContract({
        address: ARCLEND_PROTOCOL_CONTRACTS.WALLET_DOMAIN as Address,
        abi: walletDomainAbi,
        functionName: "resolveDomain",
        args: [domainName],
      })) as Address;

      if (resolved === ZERO_ADDRESS) {
        throw new Error(`${domainName}.arclend is not registered.`);
      }

      return resolved;
    },
    [publicClient],
  );

  const registerReferrer = useCallback(async () => {
    if (!referrerInput.trim()) {
      showToast("error", "Enter a referrer wallet address or .arclend domain.");
      return;
    }
    try {
      await ensureArc();
      const referrer = await resolveReferrer(referrerInput);
      if (address && referrer.toLowerCase() === address.toLowerCase()) {
        throw new Error("You cannot register yourself as your referrer.");
      }

      const hash = await referralAction.registerReferrer(referrer);
      if (hash) {
        await publicClient!.waitForTransactionReceipt({ hash });
      }
      setLastHash(hash ?? null);
      setReferrerInput("");
      showToast("success", "Referrer registered");
      await onRefresh();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Could not register referrer",
      );
    }
  }, [
    address,
    ensureArc,
    onRefresh,
    publicClient,
    referralAction,
    referrerInput,
    resolveReferrer,
  ]);

  const claim = useCallback(
    async (market: EarnVaultMarket) => {
      if (!address || market.pendingReferralRewards === 0n) return;
      try {
        await ensureArc();
        const hash = await referralAction.claimReferralRewards(
          market.asset,
          address as Address,
        );
        if (hash) {
          await publicClient!.waitForTransactionReceipt({ hash });
        }
        setLastHash(hash ?? null);
        showToast(
          "success",
          `${formatUnits(market.pendingReferralRewards, 6)} ${market.symbol} referral rewards claimed`,
        );
        await onRefresh();
      } catch (error) {
        showToast(
          "error",
          error instanceof Error
            ? error.message
            : `Could not claim ${market.symbol} rewards`,
        );
      }
    },
    [address, ensureArc, onRefresh, publicClient, referralAction],
  );

  const claimPoints = useCallback(async () => {
    if (!address || referral.pendingPoints === 0n) return;
    try {
      await ensureArc();
      const hash = await referralAction.claimReferralPoints();
      if (hash) {
        await publicClient!.waitForTransactionReceipt({ hash });
      }
      setLastHash(hash ?? null);
      showToast(
        "success",
        `${referral.pendingPoints.toLocaleString()} referral points claimed`,
      );
      await onRefresh();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Could not claim points",
      );
    }
  }, [
    address,
    ensureArc,
    onRefresh,
    publicClient,
    referral.pendingPoints,
    referralAction,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadReferredUsers() {
      if (!address || !publicClient || EARN_REFERRAL_CONTROLLER_ADDRESS === ZERO_ADDRESS) {
        setReferredUsers([]);
        setIsLoadingReferredUsers(false);
        return;
      }

      setIsLoadingReferredUsers(true);
      setReferredUsersError(null);
      let referralEventsLoaded = false;
      try {
        const latestBlock = await publicClient.getBlockNumber();
        let fromBlock = BigInt(deployments.earnReferralControllerDeploymentBlock);
        let partialWarning: string | null = null;
        const volumesByUser = new Map<string, ReferredUserVolume>();
        const emptyReferredUser = (user: Address): ReferredUserVolume => ({
          user,
          totalVolume: 0n,
          volumes: {},
          swapVolumes: {},
        });
        const withTimeout = async <T,>(
          promise: Promise<T>,
          label: string,
        ): Promise<T> => {
          let timeoutId: number | undefined;
          try {
            return await Promise.race([
              promise,
              new Promise<never>((_, reject) => {
                timeoutId = window.setTimeout(
                  () => reject(new Error(`${label} timed out`)),
                  LOG_REQUEST_TIMEOUT_MS,
                );
              }),
            ]);
          } finally {
            if (timeoutId !== undefined) {
              window.clearTimeout(timeoutId);
            }
          }
        };

        while (fromBlock <= latestBlock) {
          const toBlock =
            fromBlock + LOG_CHUNK_SIZE > latestBlock
              ? latestBlock
              : fromBlock + LOG_CHUNK_SIZE;
          const [logsResult, registrationsResult] = await Promise.allSettled([
            withTimeout(
              publicClient.getLogs({
                address: EARN_REFERRAL_CONTROLLER_ADDRESS,
                event: referralDepositEvent,
                args: { referrer: address as Address },
                fromBlock,
                toBlock,
              }),
              "Referral deposits request",
            ),
            withTimeout(
              publicClient.getLogs({
                address: EARN_REFERRAL_CONTROLLER_ADDRESS,
                event: referrerRegisteredEvent,
                args: { referrer: address as Address },
                fromBlock,
                toBlock,
              }),
              "Referral registrations request",
            ),
          ]);

          if (logsResult.status === "rejected" || registrationsResult.status === "rejected") {
            partialWarning = "Referral history is taking too long to load. Showing partial results.";
            break;
          }

          const logs = logsResult.value;
          const registrations = registrationsResult.value;

          for (const log of registrations) {
            const user = log.args.user as Address | undefined;
            if (!user) continue;

            const key = user.toLowerCase();
            if (!volumesByUser.has(key)) {
              volumesByUser.set(key, emptyReferredUser(user));
            }
          }

          for (const log of logs) {
            const user = log.args.user as Address | undefined;
            const asset = log.args.asset as Address | undefined;
            const assets = log.args.assets;
            if (!user || !asset || typeof assets !== "bigint") continue;

            const key = user.toLowerCase();
            const symbol = assetSymbolByAddress.get(asset.toLowerCase()) ?? "Asset";
            const existing =
              volumesByUser.get(key) ??
              emptyReferredUser(user);

            existing.totalVolume += assets;
            existing.volumes[symbol] = (existing.volumes[symbol] ?? 0n) + assets;
            volumesByUser.set(key, existing);
          }

          fromBlock = toBlock + 1n;
        }

        const sortEntries = (entriesToSort: ReferredUserVolume[]) =>
          [...entriesToSort].sort((a, b) =>
            a.totalVolume === b.totalVolume ? 0 : a.totalVolume > b.totalVolume ? -1 : 1,
          );
        const entries = sortEntries(Array.from(volumesByUser.values()));
        if (!cancelled) {
          setReferredUsers(entries);
          setReferredUsersError(partialWarning);
          setIsLoadingReferredUsers(false);
          referralEventsLoaded = true;
        }

        await Promise.allSettled(
          entries.map(async (entry) => {
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), 12_000);
            const response = await fetch(`/api/profile/${entry.user}`, {
              cache: "no-store",
              signal: controller.signal,
            });
            window.clearTimeout(timeout);
            if (!response.ok) return;

            const profile = (await response.json()) as ProfileVolumeResponse;
            for (const market of markets) {
              const rawOutgoing = profile.volume?.[market.symbol]?.outgoing;
              if (rawOutgoing && /^\d+$/.test(rawOutgoing)) {
                entry.swapVolumes[market.symbol] = BigInt(rawOutgoing);
              }
            }
          }),
        );

        if (!cancelled) {
          setReferredUsers(sortEntries(entries));
        }
      } catch (error) {
        if (!cancelled) {
          setReferredUsersError(
            error instanceof Error ? error.message : "Could not load referred users",
          );
        }
      } finally {
        if (!cancelled && !referralEventsLoaded) {
          setIsLoadingReferredUsers(false);
        }
      }
    }

    void loadReferredUsers();

    return () => {
      cancelled = true;
    };
  }, [address, assetSymbolByAddress, markets, publicClient, referral.referredUsers]);

  return (
    <GlassCard className="p-5">
      <div className="flex items-center gap-3">
        <div className="rounded-md border border-emerald-200/15 bg-emerald-200/[0.06] p-2 text-emerald-100">
          <Gift className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">Referrals</h2>
          <p className="mt-1 text-sm text-white/45">
            Earn USDC/EURC rewards and points when referred users deposit.
          </p>
        </div>
      </div>

      {!referral.deployed ? (
        <div className="mt-4 rounded-md border border-amber-200/15 bg-amber-200/[0.06] px-3 py-2 text-sm text-amber-100/80">
          Referral controller deployment pending.
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <div className="rounded-md border border-white/[0.08] bg-black/15 p-3">
          <p className="text-xs text-white/40">Level</p>
          <p className="mt-1 font-mono text-lg text-white">{normalizedLevel} / 5</p>
        </div>
        <div className="rounded-md border border-white/[0.08] bg-black/15 p-3">
          <p className="text-xs text-white/40">Pending points</p>
          <p className="mt-1 font-mono text-lg text-white">
            {referral.pendingPoints.toLocaleString()}
          </p>
        </div>
        <div className="rounded-md border border-white/[0.08] bg-black/15 p-3">
          <p className="text-xs text-white/40">Claimed points</p>
          <p className="mt-1 font-mono text-lg text-white">
            {referral.claimedPoints.toLocaleString()}
          </p>
        </div>
        <div className="rounded-md border border-white/[0.08] bg-black/15 p-3">
          <p className="text-xs text-white/40">Users referred</p>
          <p className="mt-1 font-mono text-lg text-white">
            {referral.referredUsers.toString()}
          </p>
        </div>
      </div>

      <GlassButton
        type="button"
        variant="primary"
        className="mt-4 w-full"
        disabled={
          !referral.deployed ||
          referral.pendingPoints === 0n ||
          referralAction.isPending
        }
        onClick={() => void claimPoints()}
      >
        {referralAction.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
        Claim Points
      </GlassButton>

      <div className="mt-4 rounded-md border border-white/[0.08] bg-white/[0.04] p-3">
        <p className="text-xs text-white/40">Your referral link</p>
        <div className="mt-2 flex gap-2">
          <input
            value={referralLink}
            readOnly
            placeholder="Connect wallet to generate link"
            className="min-w-0 flex-1 bg-transparent font-mono text-xs text-white outline-none placeholder:text-white/25"
          />
          <GlassButton
            type="button"
            variant="ghost"
            className="px-3"
            disabled={!referralLink}
            onClick={() => {
              void navigator.clipboard.writeText(referralLink);
              showToast("success", "Referral link copied");
            }}
          >
            <Copy className="h-4 w-4" />
          </GlassButton>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-white/[0.08] bg-white/[0.04] p-3">
        <p className="text-xs text-white/40">Register a referrer</p>
        <div className="mt-2 flex gap-2">
          <input
            value={referrerInput}
            onChange={(event) => setReferrerInput(event.target.value)}
            placeholder="0x... or name.arclend"
            className="min-w-0 flex-1 bg-transparent font-mono text-sm text-white outline-none placeholder:text-white/25"
          />
          <GlassButton
            type="button"
            variant="primary"
            className="px-3"
            disabled={!referral.deployed || referralAction.isPending}
            onClick={() => void registerReferrer()}
          >
            {referralAction.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
            Save
          </GlassButton>
        </div>
        {referral.referrer !== ZERO_ADDRESS ? (
          <p className="mt-2 break-all text-xs text-white/35">
            Current referrer: <span className="font-mono text-white/60">{referral.referrer}</span>
          </p>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3">
        {markets.map((market) => (
          <div
            key={market.symbol}
            className="rounded-md border border-white/[0.08] bg-black/15 p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-white">{market.symbol} rewards</span>
              <GlassButton
                type="button"
                variant="ghost"
                className="px-3 py-2"
                disabled={
                  !referral.deployed ||
                  market.pendingReferralRewards === 0n ||
                  referralAction.isPending
                }
                onClick={() => void claim(market)}
              >
                Claim
              </GlassButton>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-white/50">
              <div>
                <p>Claimable</p>
                <p className="mt-1 font-mono text-white">
                  {formatTokenAmount(market.pendingReferralRewards, 6)} {market.symbol}
                </p>
              </div>
              <div>
                <p>Referred deposits</p>
                <p className="mt-1 font-mono text-white">
                  {formatTokenAmount(market.referredVolume, 2)} {market.symbol}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-md border border-white/[0.08] bg-white/[0.04] p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-white">Referred users</p>
          {isLoadingReferredUsers ? (
            <Loader2 className="h-4 w-4 animate-spin text-white/45" />
          ) : null}
        </div>
        {referredUsersError ? (
          <p className="mt-3 rounded-md border border-amber-200/15 bg-amber-200/[0.06] px-3 py-2 text-sm text-amber-100/80">
            {referredUsersError}
          </p>
        ) : null}
        {referredUsers.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs text-white/35">
                <tr>
                  <th className="pb-2 font-medium">Wallet address</th>
                  {markets.map((market) => (
                    <th key={market.symbol} className="pb-2 text-right font-medium">
                      {market.symbol} volume
                    </th>
                  ))}
                  <th className="pb-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.08]">
                {referredUsers.map((entry) => {
                  const combinedTotal = markets.reduce(
                    (sum, market) =>
                      sum +
                      (entry.volumes[market.symbol] ?? 0n) +
                      (entry.swapVolumes[market.symbol] ?? 0n),
                    0n,
                  );

                  return (
                    <tr key={entry.user}>
                      <td className="max-w-[280px] break-all py-3 font-mono text-xs text-white/65">
                        {entry.user}
                      </td>
                      {markets.map((market) => {
                        const combinedVolume =
                          (entry.volumes[market.symbol] ?? 0n) +
                          (entry.swapVolumes[market.symbol] ?? 0n);

                        return (
                          <td key={market.symbol} className="py-3 text-right font-mono text-white/75">
                            {formatTokenAmount(combinedVolume, 2)}
                          </td>
                        );
                      })}
                      <td className="py-3 text-right font-mono text-white">
                        {formatTokenAmount(combinedTotal, 2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : !isLoadingReferredUsers ? (
          <p className="mt-3 text-sm text-white/40">
            No referred users found yet.
          </p>
        ) : null}
      </div>

      {lastHash ? (
        <a
          className="mt-3 flex items-center gap-2 rounded-md border border-emerald-200/15 bg-emerald-200/[0.06] p-3 text-sm text-emerald-100"
          href={`${ARCSCAN_TX}${lastHash}`}
          target="_blank"
          rel="noreferrer"
        >
          <CheckCircle2 className="h-4 w-4" />
          Referral transaction confirmed
          <ExternalLink className="ml-auto h-4 w-4" />
        </a>
      ) : null}
    </GlassCard>
  );
}
