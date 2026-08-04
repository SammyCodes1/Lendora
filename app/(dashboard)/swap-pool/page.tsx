"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Droplets,
  ExternalLink,
  Loader2,
  Plus,
  Minus,
  RefreshCw,
} from "lucide-react";
import {
  erc20Abi,
  formatUnits,
  parseUnits,
  type Address,
  type Hash,
} from "viem";
import {
  useChainId,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageTransition } from "@/components/layout/PageTransition";
import { StatBadge } from "@/components/ui/StatBadge";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import {
  ARC_DEX_ROUTERS,
  ARC_DEX_TOKENS,
  SWAP_POOL_ABI,
} from "@/lib/arcDex";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const POOL = ARC_DEX_ROUTERS.arclend;
const USDC = ARC_DEX_TOKENS.USDC;
const EURC = ARC_DEX_TOKENS.EURC;

function arcScanTx(hash: Hash) {
  return `https://testnet.arcscan.app/tx/${hash}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Transaction failed";
}

export default function SwapPoolPage() {
  const { address, isConnected } = useArcLendAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: 5042002 });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [amountA, setAmountA] = useState("");
  const [amountB, setAmountB] = useState("");
  const [removeLp, setRemoveLp] = useState("");
  const [reserveA, setReserveA] = useState<bigint | null>(null);
  const [reserveB, setReserveB] = useState<bigint | null>(null);
  const [totalSupply, setTotalSupply] = useState<bigint | null>(null);
  const [lpBalance, setLpBalance] = useState<bigint | null>(null);
  const [feeBps, setFeeBps] = useState<bigint>(30n);
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState<Hash | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const usdcBalance = useTokenBalance({
    address,
    token: USDC.address as Address,
    chainId: 5042002,
    enabled: Boolean(address),
  });
  const eurcBalance = useTokenBalance({
    address,
    token: EURC.address as Address,
    chainId: 5042002,
    enabled: Boolean(address),
  });

  const loadPool = useCallback(async () => {
    if (!publicClient) return;
    setRefreshing(true);
    try {
      const [a, b, supply, fee] = await Promise.all([
        publicClient.readContract({
          address: POOL,
          abi: SWAP_POOL_ABI,
          functionName: "reserveA",
        }),
        publicClient.readContract({
          address: POOL,
          abi: SWAP_POOL_ABI,
          functionName: "reserveB",
        }),
        publicClient.readContract({
          address: POOL,
          abi: SWAP_POOL_ABI,
          functionName: "totalSupply",
        }),
        publicClient.readContract({
          address: POOL,
          abi: SWAP_POOL_ABI,
          functionName: "feeBps",
        }),
      ]);
      setReserveA(a);
      setReserveB(b);
      setTotalSupply(supply);
      setFeeBps(fee);

      if (address) {
        const lp = await publicClient.readContract({
          address: POOL,
          abi: SWAP_POOL_ABI,
          functionName: "balanceOf",
          args: [address],
        });
        setLpBalance(lp);
      } else {
        setLpBalance(null);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setRefreshing(false);
    }
  }, [address, publicClient]);

  useEffect(() => {
    void loadPool();
    const id = window.setInterval(() => void loadPool(), 12_000);
    return () => window.clearInterval(id);
  }, [loadPool]);

  const price =
    reserveA && reserveB && reserveA > 0n
      ? Number(formatUnits(reserveB, 6)) / Number(formatUnits(reserveA, 6))
      : null;

  const impliedB = useMemo(() => {
    if (!amountA || !reserveA || !reserveB || reserveA === 0n) return "";
    try {
      const a = parseUnits(amountA, 6);
      const b = (a * reserveB) / reserveA;
      return formatUnits(b, 6);
    } catch {
      return "";
    }
  }, [amountA, reserveA, reserveB]);

  // Keep B input in sync with pool ratio when A changes (after first liquidity).
  useEffect(() => {
    if (totalSupply && totalSupply > 0n && impliedB) {
      setAmountB(impliedB);
    }
  }, [impliedB, totalSupply]);

  const redeemable = useMemo(() => {
    if (!lpBalance || !totalSupply || totalSupply === 0n || !reserveA || !reserveB) {
      return { a: 0n, b: 0n };
    }
    return {
      a: (lpBalance * reserveA) / totalSupply,
      b: (lpBalance * reserveB) / totalSupply,
    };
  }, [lpBalance, reserveA, reserveB, totalSupply]);

  const ensureNetwork = async () => {
    if (chainId !== 5042002) {
      await switchChainAsync({ chainId: 5042002 });
    }
  };

  const approveIfNeeded = async (
    token: Address,
    owner: Address,
    amount: bigint,
  ) => {
    if (!publicClient) throw new Error("Client unavailable");
    const allowance = await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, POOL],
    });
    if (allowance >= amount) return;
    const hash = await writeContractAsync({
      chainId: 5042002,
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [POOL, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  };

  const onAddLiquidity = async () => {
    if (!address || !publicClient) return;
    setLoading(true);
    setError(null);
    setTxHash(null);
    try {
      await ensureNetwork();
      const a = parseUnits(amountA || "0", 6);
      const b = parseUnits(amountB || "0", 6);
      if (a <= 0n || b <= 0n) throw new Error("Enter both USDC and EURC amounts");

      await approveIfNeeded(USDC.address as Address, address, a);
      await approveIfNeeded(EURC.address as Address, address, b);

      const hash = await writeContractAsync({
        chainId: 5042002,
        address: POOL,
        abi: SWAP_POOL_ABI,
        functionName: "addLiquidity",
        args: [a, b, 0n],
      });
      setTxHash(hash);
      await publicClient.waitForTransactionReceipt({ hash });
      showToast("success", "Liquidity added to ArcLend Swap Pool");
      setAmountA("");
      setAmountB("");
      await loadPool();
      await Promise.all([usdcBalance.refetch(), eurcBalance.refetch()]);
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      showToast("error", message);
    } finally {
      setLoading(false);
    }
  };

  const onRemoveLiquidity = async () => {
    if (!address || !publicClient) return;
    setLoading(true);
    setError(null);
    setTxHash(null);
    try {
      await ensureNetwork();
      const lp = parseUnits(removeLp || "0", 6);
      if (lp <= 0n) throw new Error("Enter LP amount to remove");
      if (lpBalance !== null && lp > lpBalance) {
        throw new Error("LP amount exceeds your balance");
      }

      const hash = await writeContractAsync({
        chainId: 5042002,
        address: POOL,
        abi: SWAP_POOL_ABI,
        functionName: "removeLiquidity",
        args: [lp, 0n, 0n],
      });
      setTxHash(hash);
      await publicClient.waitForTransactionReceipt({ hash });
      showToast("success", "Liquidity removed from ArcLend Swap Pool");
      setRemoveLp("");
      await loadPool();
      await Promise.all([usdcBalance.refetch(), eurcBalance.refetch()]);
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      showToast("error", message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageTransition>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Swap Pool LP"
          description="Provide USDC/EURC liquidity to ArcLend's native constant-product pool and earn 0.30% swap fees. Fully separate from the lending market."
          icon={<Droplets className="h-5 w-5" />}
        />

        <div className="flex flex-wrap gap-2">
          <StatBadge
            label="Reserve USDC"
            value={
              reserveA === null
                ? "…"
                : Number(formatUnits(reserveA, 6)).toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })
            }
          />
          <StatBadge
            label="Reserve EURC"
            value={
              reserveB === null
                ? "…"
                : Number(formatUnits(reserveB, 6)).toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })
            }
          />
          <StatBadge
            label="Implied price"
            value={
              price === null
                ? "—"
                : `1 USDC ≈ ${price.toFixed(4)} EURC`
            }
          />
          <StatBadge label="Swap fee" value={`${Number(feeBps) / 100}%`} />
          <button
            type="button"
            onClick={() => void loadPool()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/55 transition hover:text-white"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
            />
            Refresh
          </button>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <GlassCard className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <Plus className="h-4 w-4 text-white/50" />
              <h2 className="text-sm font-semibold text-white">
                Provide Swap Liquidity
              </h2>
            </div>
            <p className="mb-4 text-xs text-white/40">
              Deposits must match the pool ratio after the first seed. Excess of
              the non-binding side is not taken.
            </p>

            <label className="mb-1 block text-[11px] uppercase tracking-wide text-white/35">
              USDC
            </label>
            <input
              value={amountA}
              onChange={(e) => setAmountA(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="mb-3 w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 font-mono text-sm text-white outline-none focus:border-white/30"
            />
            <p className="mb-4 text-[11px] text-white/30">
              Wallet:{" "}
              {usdcBalance.data
                ? Number(
                    formatUnits(
                      usdcBalance.data.value,
                      usdcBalance.data.decimals,
                    ),
                  ).toLocaleString(undefined, { maximumFractionDigits: 2 })
                : "—"}{" "}
              USDC
            </p>

            <label className="mb-1 block text-[11px] uppercase tracking-wide text-white/35">
              EURC
            </label>
            <input
              value={amountB}
              onChange={(e) => setAmountB(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="mb-3 w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 font-mono text-sm text-white outline-none focus:border-white/30"
            />
            <p className="mb-5 text-[11px] text-white/30">
              Wallet:{" "}
              {eurcBalance.data
                ? Number(
                    formatUnits(
                      eurcBalance.data.value,
                      eurcBalance.data.decimals,
                    ),
                  ).toLocaleString(undefined, { maximumFractionDigits: 2 })
                : "—"}{" "}
              EURC
              {impliedB ? (
                <span className="ml-2 text-white/45">
                  · ratio suggests {Number(impliedB).toFixed(4)} EURC
                </span>
              ) : null}
            </p>

            <GlassButton
              type="button"
              variant="primary"
              className="w-full"
              disabled={!isConnected || loading || !amountA || !amountB}
              onClick={() => void onAddLiquidity()}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {isConnected ? "Add liquidity" : "Connect wallet"}
            </GlassButton>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <Minus className="h-4 w-4 text-white/50" />
              <h2 className="text-sm font-semibold text-white">My LP Position</h2>
            </div>

            <div className="mb-5 space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
              <div className="flex justify-between text-sm">
                <span className="text-white/40">ALP-USDC-EURC</span>
                <span className="font-mono text-white">
                  {lpBalance === null
                    ? "—"
                    : Number(formatUnits(lpBalance, 6)).toLocaleString(
                        undefined,
                        { maximumFractionDigits: 6 },
                      )}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/40">Redeemable USDC</span>
                <span className="font-mono text-white">
                  {Number(formatUnits(redeemable.a, 6)).toLocaleString(
                    undefined,
                    { maximumFractionDigits: 4 },
                  )}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/40">Redeemable EURC</span>
                <span className="font-mono text-white">
                  {Number(formatUnits(redeemable.b, 6)).toLocaleString(
                    undefined,
                    { maximumFractionDigits: 4 },
                  )}
                </span>
              </div>
            </div>

            <label className="mb-1 block text-[11px] uppercase tracking-wide text-white/35">
              LP tokens to burn
            </label>
            <div className="mb-4 flex gap-2">
              <input
                value={removeLp}
                onChange={(e) => setRemoveLp(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 font-mono text-sm text-white outline-none focus:border-white/30"
              />
              <button
                type="button"
                className="rounded-xl border border-white/10 px-3 text-xs text-white/55 hover:text-white"
                onClick={() =>
                  setRemoveLp(
                    lpBalance ? formatUnits(lpBalance, 6) : "",
                  )
                }
              >
                Max
              </button>
            </div>

            <GlassButton
              type="button"
              variant="ghost"
              className="w-full"
              disabled={
                !isConnected ||
                loading ||
                !removeLp ||
                !lpBalance ||
                lpBalance === 0n
              }
              onClick={() => void onRemoveLiquidity()}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Minus className="h-4 w-4" />
              )}
              Remove liquidity
            </GlassButton>
          </GlassCard>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        ) : null}
        {txHash ? (
          <a
            href={arcScanTx(txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-white/55 hover:text-white"
          >
            View transaction <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}

        <p className="text-xs text-white/30">
          Pool contract{" "}
          <a
            href={`https://testnet.arcscan.app/address/${POOL}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-white/45 underline-offset-2 hover:underline"
          >
            {POOL}
          </a>
          . Liquidity here never touches LendingPool reserves.
        </p>
      </div>
    </PageTransition>
  );
}
