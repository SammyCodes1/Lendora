"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type Abi,
  type Address,
  type Hex,
  encodePacked,
  formatUnits,
  keccak256,
} from "viem";
import {
  useChainId,
  usePublicClient,
  useSwitchChain,
} from "wagmi";
import {
  CircleDollarSign,
  Euro,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { PageTransition } from "@/components/layout/PageTransition";
import { PageHeader } from "@/components/layout/PageHeader";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { StatBadge } from "@/components/ui/StatBadge";
import { TokenInput } from "@/components/ui/TokenInput";

import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import {
  resultHash,
  useArcLendContractWrite,
} from "@/hooks/useArcLendContractWrite";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  ARCSCAN_TX,
  errorMessage,
  formatExactTokenAmount,
  formatTokenAmount,
  parseTokenAmount,
} from "@/components/modals/modalUtils";

import erc20AbiJson from "@/constants/abis/ERC20.json";
import executorAbiJson from "@/constants/abis/RecurringOrderExecutor.json";
import {
  ARC_TESTNET_CONTRACTS,
  ARC_TESTNET_METADATA,
} from "@/constants/contracts";
import deployments from "@/constants/deployments.json";

const erc20Abi = erc20AbiJson as Abi;
const executorAbi = executorAbiJson as Abi;
type HexAddress = `0x${string}`;

/** Live RecurringOrderExecutor on Arc testnet (extracted / verified). */
const EXECUTOR = (deployments as { RecurringOrderExecutor?: string })
  .RecurringOrderExecutor as HexAddress;

/** On-chain MIN_INTERVAL = 15 minutes. */
const MIN_INTERVAL_SECONDS = 15 * 60;

type Asset = "USDC" | "EURC";

type StoredOrder = {
  orderId: Hex;
  tokenIn: Address;
  tokenOut: Address;
  tokenInSymbol: Asset;
  tokenOutSymbol: Asset;
  maxAmountIn: string;
  minInterval: number;
  validAfter: number;
  validUntil: number;
  createdAt: number;
  authorizeTx?: string;
};

type OnChainAuth = {
  user: Address;
  tokenIn: Address;
  tokenOut: Address;
  maxAmountIn: bigint;
  minInterval: bigint;
  validAfter: bigint;
  validUntil: bigint;
  lastExecutedAt: bigint;
  active: boolean;
};

function ordersStorageKey(address: string) {
  return `arclend:recurring-orders:${address.toLowerCase()}`;
}

function loadStoredOrders(address: string): StoredOrder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ordersStorageKey(address));
    if (!raw) return [];
    return JSON.parse(raw) as StoredOrder[];
  } catch {
    return [];
  }
}

function saveStoredOrders(address: string, orders: StoredOrder[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    ordersStorageKey(address),
    JSON.stringify(orders),
  );
}

function makeOrderId(user: Address): Hex {
  const entropy = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return keccak256(encodePacked(["address", "string"], [user, entropy]));
}

function formatInterval(seconds: number) {
  if (seconds % 86_400 === 0) {
    const d = seconds / 86_400;
    return d === 1 ? "1 day" : `${d} days`;
  }
  if (seconds % 3_600 === 0) {
    const h = seconds / 3_600;
    return h === 1 ? "1 hour" : `${h} hours`;
  }
  if (seconds % 60 === 0) {
    const m = seconds / 60;
    return m === 1 ? "1 minute" : `${m} minutes`;
  }
  return `${seconds}s`;
}

/** Local datetime-local string from a Date (yyyy-MM-ddThh:mm). */
function toLocalInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Parse datetime-local value to unix seconds (local timezone). */
function fromLocalInputValue(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

function defaultStartLocal() {
  return toLocalInputValue(new Date());
}

function defaultEndLocal() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return toLocalInputValue(d);
}

function parseAuthRow(raw: unknown): OnChainAuth | null {
  if (raw == null) return null;
  const row = raw as Record<string | number, unknown>;
  const user = String(row.user ?? row[0] ?? "") as Address;
  if (!user || user === "0x0000000000000000000000000000000000000000") {
    return null;
  }
  return {
    user,
    tokenIn: String(row.tokenIn ?? row[1] ?? "") as Address,
    tokenOut: String(row.tokenOut ?? row[2] ?? "") as Address,
    maxAmountIn: BigInt((row.maxAmountIn ?? row[3] ?? 0) as bigint | number | string),
    minInterval: BigInt((row.minInterval ?? row[4] ?? 0) as bigint | number | string),
    validAfter: BigInt((row.validAfter ?? row[5] ?? 0) as bigint | number | string),
    validUntil: BigInt((row.validUntil ?? row[6] ?? 0) as bigint | number | string),
    lastExecutedAt: BigInt(
      (row.lastExecutedAt ?? row[7] ?? 0) as bigint | number | string,
    ),
    active: Boolean(row.active ?? row[8]),
  };
}

export default function OrdersPage() {
  const { address, isConnected } = useArcLendAccount();
  const chainId = useChainId();
  const { switchChainAsync, switchChain } = useSwitchChain();
  const targetChainId = ARC_TESTNET_METADATA.chainId;
  const publicClient = usePublicClient({ chainId: targetChainId });
  const { writeContractAsync } = useArcLendContractWrite();

  const [tokenInSymbol, setTokenInSymbol] = useState<Asset>("USDC");
  const tokenOutSymbol: Asset = tokenInSymbol === "USDC" ? "EURC" : "USDC";
  const [amount, setAmount] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState("15");
  /** First time the order may be executed (validAfter). */
  const [startAtLocal, setStartAtLocal] = useState(defaultStartLocal);
  /** Optional expiry (validUntil). Empty = no expiry. */
  const [endAtLocal, setEndAtLocal] = useState(defaultEndLocal);
  const [noExpiry, setNoExpiry] = useState(false);

  const [isApproving, setIsApproving] = useState(false);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [storedOrders, setStoredOrders] = useState<StoredOrder[]>([]);
  const [onChainById, setOnChainById] = useState<
    Record<string, OnChainAuth | null>
  >({});
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  const tokenIn = (
    tokenInSymbol === "USDC"
      ? ARC_TESTNET_CONTRACTS.USDC
      : ARC_TESTNET_CONTRACTS.EURC
  ) as HexAddress;
  const tokenOut = (
    tokenOutSymbol === "USDC"
      ? ARC_TESTNET_CONTRACTS.USDC
      : ARC_TESTNET_CONTRACTS.EURC
  ) as HexAddress;

  const balance = useTokenBalance({
    address,
    token: tokenIn,
    chainId: targetChainId,
    enabled: Boolean(address && tokenIn),
    refetchInterval: 4_000,
  });

  const balanceLabel = !isConnected
    ? "0.00"
    : balance.isLoading
      ? "…"
      : formatTokenAmount(balance.data?.value);

  const minIntervalSeconds = useMemo(() => {
    const mins = Math.max(1, Math.floor(Number(intervalMinutes) || 0));
    return mins * 60;
  }, [intervalMinutes]);

  const intervalValid = minIntervalSeconds >= MIN_INTERVAL_SECONDS;

  const ensureArcChain = useCallback(async () => {
    if (chainId === targetChainId) return true;
    try {
      if (switchChainAsync) {
        await switchChainAsync({ chainId: targetChainId });
        return true;
      }
      switchChain?.({ chainId: targetChainId });
      showToast("error", "Switch to Arc Testnet, then try again.");
      return false;
    } catch (err) {
      showToast("error", errorMessage(err) || "Failed to switch network.");
      return false;
    }
  }, [chainId, switchChain, switchChainAsync, targetChainId]);

  const refreshOrders = useCallback(async () => {
    if (!address || !publicClient || !EXECUTOR) {
      setStoredOrders([]);
      setOnChainById({});
      return;
    }
    setIsLoadingOrders(true);
    try {
      const local = loadStoredOrders(address);
      setStoredOrders(local);
      const map: Record<string, OnChainAuth | null> = {};
      for (const order of local) {
        try {
          const raw = await publicClient.readContract({
            address: EXECUTOR,
            abi: executorAbi,
            functionName: "orderAuthorizations",
            args: [order.orderId],
          });
          map[order.orderId] = parseAuthRow(raw);
        } catch {
          map[order.orderId] = null;
        }
      }
      setOnChainById(map);
    } finally {
      setIsLoadingOrders(false);
    }
  }, [address, publicClient]);

  useEffect(() => {
    void refreshOrders();
  }, [refreshOrders]);

  const handleAuthorize = async () => {
    if (!address || !amount) return;
    if (!(await ensureArcChain())) return;
    if (!intervalValid) {
      showToast(
        "error",
        `Minimum interval is ${MIN_INTERVAL_SECONDS / 60} minutes on-chain.`,
      );
      return;
    }

    const maxAmountIn = parseTokenAmount(amount);
    if (maxAmountIn <= 0n) {
      showToast("error", "Enter a valid amount.");
      return;
    }

    const validAfter = fromLocalInputValue(startAtLocal);
    if (validAfter == null) {
      showToast("error", "Pick a valid start date and time.");
      return;
    }

    let validUntil = 0;
    if (!noExpiry) {
      const end = fromLocalInputValue(endAtLocal);
      if (end == null) {
        showToast("error", "Pick a valid end date and time, or enable no expiry.");
        return;
      }
      if (end <= validAfter) {
        showToast("error", "End time must be after the start time.");
        return;
      }
      validUntil = end;
    }

    const orderId = makeOrderId(address);

    try {
      setIsApproving(true);
      // Approve maxAmountIn so the executor can pull each run (up to cap).
      // Users may raise allowance later for multi-run totals.
      const approveRes = await writeContractAsync({
        chainId: targetChainId,
        address: tokenIn,
        abi: erc20Abi,
        functionName: "approve",
        args: [EXECUTOR, maxAmountIn],
      });
      const approveHash = resultHash(approveRes);
      if (approveHash && publicClient) {
        showToast("success", "Approval submitted…");
        await publicClient.waitForTransactionReceipt({
          hash: approveHash as HexAddress,
        });
      }
    } catch (err) {
      showToast("error", errorMessage(err));
      setIsApproving(false);
      return;
    } finally {
      setIsApproving(false);
    }

    try {
      setIsAuthorizing(true);
      const authRes = await writeContractAsync({
        chainId: targetChainId,
        address: EXECUTOR,
        abi: executorAbi,
        functionName: "authorizeOrder",
        args: [
          orderId,
          tokenIn,
          tokenOut,
          maxAmountIn,
          BigInt(minIntervalSeconds),
          BigInt(validAfter),
          BigInt(validUntil),
        ],
      });
      const authHash = resultHash(authRes);
      if (authHash && publicClient) {
        await publicClient.waitForTransactionReceipt({
          hash: authHash as HexAddress,
        });
        setLastTxHash(authHash);
        showToast("success", `Order authorized. ${ARCSCAN_TX}${authHash}`);
      } else if (authRes && "challengeId" in authRes) {
        showToast("success", "Authorize submitted.");
      }

      const next: StoredOrder = {
        orderId,
        tokenIn,
        tokenOut,
        tokenInSymbol,
        tokenOutSymbol,
        maxAmountIn: maxAmountIn.toString(),
        minInterval: minIntervalSeconds,
        validAfter,
        validUntil,
        createdAt: Date.now(),
        authorizeTx: authHash,
      };
      const updated = [next, ...loadStoredOrders(address)];
      saveStoredOrders(address, updated);
      setStoredOrders(updated);
      await refreshOrders();
    } catch (err) {
      showToast("error", errorMessage(err));
    } finally {
      setIsAuthorizing(false);
    }
  };

  const handleCancel = async (orderId: Hex) => {
    if (!(await ensureArcChain())) return;
    try {
      setCancelingId(orderId);
      const res = await writeContractAsync({
        chainId: targetChainId,
        address: EXECUTOR,
        abi: executorAbi,
        functionName: "cancelOrder",
        args: [orderId],
      });
      const hash = resultHash(res);
      if (hash && publicClient) {
        await publicClient.waitForTransactionReceipt({
          hash: hash as HexAddress,
        });
        setLastTxHash(hash);
        showToast("success", `Order cancelled. ${ARCSCAN_TX}${hash}`);
      }
      await refreshOrders();
    } catch (err) {
      showToast("error", errorMessage(err));
    } finally {
      setCancelingId(null);
    }
  };

  return (
    <PageTransition>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={<RefreshCw />}
          title="Recurring Orders"
          description="Authorize bounded recurring swaps via RecurringOrderExecutor. You set max amount and min interval on-chain; approved relayers execute routes when due."
          stats={[
            { label: "Executor", value: "On-chain", tone: "positive" },
            { label: "Min interval", value: "15m" },
          ]}
        />

        <div className="grid gap-5 lg:grid-cols-2">
          <GlassCard className="flex flex-col gap-6 p-5">
            <h3 className="text-lg font-semibold text-white">
              Authorize order
            </h3>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-white/60">
                  Sell asset
                </label>
                <div className="flex gap-2">
                  {(["USDC", "EURC"] as const).map((sym) => (
                    <button
                      key={sym}
                      type="button"
                      onClick={() => setTokenInSymbol(sym)}
                      className={cn(
                        "flex-1 rounded-xl border py-2 px-3 text-sm font-medium transition",
                        tokenInSymbol === sym
                          ? "border-white/20 bg-white/10 text-white"
                          : "border-white/5 bg-white/[0.02] text-white/50 hover:bg-white/[0.04]",
                      )}
                    >
                      <span className="inline-flex items-center justify-center gap-2">
                        {sym === "USDC" ? (
                          <CircleDollarSign className="h-4 w-4" />
                        ) : (
                          <Euro className="h-4 w-4" />
                        )}
                        {sym}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-white/60">
                  Buy asset
                </label>
                <div className="flex items-center justify-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] py-2 text-sm text-white/50 opacity-80">
                  {tokenOutSymbol === "USDC" ? (
                    <CircleDollarSign className="h-4 w-4" />
                  ) : (
                    <Euro className="h-4 w-4" />
                  )}
                  {tokenOutSymbol}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-white/60">
                  Max amount per execution
                </label>
                <TokenInput
                  value={amount}
                  onChange={setAmount}
                  tokenName={tokenInSymbol}
                  tokenSymbol={tokenInSymbol}
                  balance={`${balanceLabel} ${tokenInSymbol}`}
                  icon={
                    tokenInSymbol === "USDC" ? CircleDollarSign : Euro
                  }
                  onMax={() => {
                    if (!balance.data?.value) {
                      setAmount("0");
                      return;
                    }
                    setAmount(
                      formatExactTokenAmount(
                        balance.data.value,
                        balance.data.decimals,
                      ),
                    );
                  }}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-white/60">
                  Min interval between runs (minutes)
                </label>
                <input
                  type="number"
                  min={15}
                  step={1}
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(e.target.value)}
                  className={cn(
                    "w-full rounded-xl border bg-black/40 px-4 py-3 text-sm text-white focus:outline-none focus:ring-1",
                    intervalValid
                      ? "border-white/[0.08] focus:border-white/20 focus:ring-white/20"
                      : "border-red-400/40 focus:border-red-300/50 focus:ring-red-300/30",
                  )}
                />
                <span
                  className={cn(
                    "mt-1 block text-[11px]",
                    intervalValid ? "text-white/35" : "text-red-300",
                  )}
                >
                  {intervalValid
                    ? `At most once every ${formatInterval(minIntervalSeconds)}`
                    : `Minimum ${MIN_INTERVAL_SECONDS / 60} minutes on-chain`}
                </span>
              </div>

              <div className="space-y-3">
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-white/60">
                    First executable date &amp; time
                  </span>
                  <input
                    type="datetime-local"
                    value={startAtLocal}
                    onChange={(e) => setStartAtLocal(e.target.value)}
                    className="rounded-xl border border-white/[0.08] bg-black/40 px-4 py-3 text-sm text-white [color-scheme:dark] focus:border-white/20 focus:outline-none focus:ring-1 focus:ring-white/20"
                  />
                  <span className="text-[11px] text-white/35">
                    Relayers cannot execute before this time
                  </span>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-white/60">
                    End date &amp; time
                  </span>
                  <input
                    type="datetime-local"
                    value={endAtLocal}
                    disabled={noExpiry}
                    onChange={(e) => setEndAtLocal(e.target.value)}
                    className="rounded-xl border border-white/[0.08] bg-black/40 px-4 py-3 text-sm text-white [color-scheme:dark] focus:border-white/20 focus:outline-none focus:ring-1 focus:ring-white/20 disabled:opacity-40"
                  />
                  <label className="mt-1 inline-flex items-center gap-2 text-[11px] text-white/45">
                    <input
                      type="checkbox"
                      checked={noExpiry}
                      onChange={(e) => setNoExpiry(e.target.checked)}
                      className="rounded border-white/20 bg-black/40"
                    />
                    No expiry
                  </label>
                </label>
              </div>

              {lastTxHash ? (
                <a
                  href={ARCSCAN_TX + lastTxHash}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100 transition hover:bg-emerald-400/15"
                >
                  <ExternalLink className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">
                    Last tx — view on Arcscan
                  </span>
                </a>
              ) : null}

              <GlassButton
                className="w-full"
                disabled={
                  !isConnected ||
                  !amount ||
                  !intervalValid ||
                  isApproving ||
                  isAuthorizing ||
                  !EXECUTOR
                }
                onClick={handleAuthorize}
              >
                {isApproving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Approving…
                  </>
                ) : isAuthorizing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />{" "}
                    Authorizing…
                  </>
                ) : (
                  "Approve & authorize order"
                )}
              </GlassButton>
            </div>
          </GlassCard>

          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-lg font-semibold text-white">My orders</h3>
              <button
                type="button"
                onClick={() => void refreshOrders()}
                className="text-xs text-white/45 hover:text-white/70"
              >
                Refresh
              </button>
            </div>

            {!isConnected ? (
              <GlassCard className="p-8 text-center text-white/50">
                Connect your wallet to manage recurring orders.
              </GlassCard>
            ) : isLoadingOrders ? (
              <GlassCard className="p-8 text-center text-white/50">
                <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              </GlassCard>
            ) : storedOrders.length === 0 ? (
              <GlassCard className="flex flex-col items-center gap-3 p-8 text-center text-white/50">
                <RefreshCw className="h-8 w-8 text-white/20" />
                <p>No authorized orders in this browser yet.</p>
              </GlassCard>
            ) : (
              <div className="space-y-4">
                {storedOrders.map((order) => {
                  const chain = onChainById[order.orderId];
                  const active = chain?.active ?? false;
                  const lastAt = chain
                    ? Number(chain.lastExecutedAt)
                    : 0;
                  const maxIn = chain
                    ? chain.maxAmountIn
                    : BigInt(order.maxAmountIn || "0");

                  return (
                    <GlassCard key={order.orderId} className="p-5">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-white">
                              {order.tokenInSymbol} → {order.tokenOutSymbol}
                            </span>
                            <StatBadge
                              label="Status"
                              value={
                                chain == null
                                  ? "Unknown"
                                  : active
                                    ? "Active"
                                    : "Cancelled"
                              }
                              tone={
                                active
                                  ? "positive"
                                  : chain == null
                                    ? "neutral"
                                    : "negative"
                              }
                            />
                          </div>
                          <div className="font-mono text-[11px] text-white/35">
                            {order.orderId.slice(0, 14)}…
                            {order.orderId.slice(-10)}
                          </div>
                        </div>
                        <div className="text-right text-xs text-white/50">
                          <div>
                            Max{" "}
                            <span className="text-white/80">
                              {formatUnits(maxIn, 6)} {order.tokenInSymbol}
                            </span>
                          </div>
                          <div className="mt-1">
                            Every {formatInterval(order.minInterval)}
                          </div>
                          <div className="mt-1">
                            Starts{" "}
                            {new Date(order.validAfter * 1000).toLocaleString()}
                          </div>
                          <div className="mt-1">
                            {order.validUntil > 0
                              ? `Ends ${new Date(order.validUntil * 1000).toLocaleString()}`
                              : "No expiry"}
                          </div>
                          {lastAt > 0 ? (
                            <div className="mt-1">
                              Last run{" "}
                              {new Date(lastAt * 1000).toLocaleString()}
                            </div>
                          ) : (
                            <div className="mt-1">Never executed</div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 border-t border-white/[0.08] pt-3">
                        {order.authorizeTx ? (
                          <a
                            href={ARCSCAN_TX + order.authorizeTx}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-white/45 hover:text-white/70"
                          >
                            <ExternalLink className="h-3 w-3" /> Authorize tx
                          </a>
                        ) : null}
                        {active ? (
                          <GlassButton
                            variant="danger"
                            className="w-full"
                            disabled={cancelingId === order.orderId}
                            onClick={() => handleCancel(order.orderId)}
                          >
                            {cancelingId === order.orderId ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />{" "}
                                Cancelling…
                              </>
                            ) : (
                              "Cancel order"
                            )}
                          </GlassButton>
                        ) : null}
                      </div>
                    </GlassCard>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
