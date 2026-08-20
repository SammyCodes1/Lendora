"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  CircleDollarSign,
  Euro,
  ExternalLink,
  Loader2,
  PiggyBank,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { formatUnits, isAddress, type Abi, type Address, type Hash } from "viem";
import {
  useChainId,
  usePublicClient,
  useReadContract,
  useSwitchChain,
} from "wagmi";
import erc20Abi from "@/constants/abis/ERC20.json";
import { PageTransition } from "@/components/layout/PageTransition";
import { PageHeader } from "@/components/layout/PageHeader";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatBadge } from "@/components/ui/StatBadge";
import { TokenInput } from "@/components/ui/TokenInput";
import {
  EARN_REFERRAL_CONTROLLER_ADDRESS,
  useEarnVaultAction,
  useEarnVaultMarkets,
  type EarnReferralSummary,
  type EarnVaultMarket,
} from "@/hooks/useEarnVaults";
import { useLiveMarkets } from "@/hooks/useLiveMarkets";
import { useUserBalance } from "@/hooks/useLendingPool";
import { resultHash, useArcLendContractWrite } from "@/hooks/useArcLendContractWrite";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import { showToast } from "@/lib/toast";
import {
  ARCSCAN_TX,
  errorMessage,
  formatExactTokenAmount,
  formatTokenAmount,
  parseTokenAmount,
} from "@/components/modals/modalUtils";

type VaultMode = "deposit" | "withdraw";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const erc20WriteAbi = erc20Abi as Abi;

function iconFor(symbol: EarnVaultMarket["symbol"]) {
  return symbol === "USDC" ? CircleDollarSign : Euro;
}

function VaultCard({
  vault,
  supplyApy,
  referral,
  referralAddress,
  onRefresh,
}: {
  vault: EarnVaultMarket;
  supplyApy: string;
  referral: EarnReferralSummary;
  referralAddress: Address;
  onRefresh: () => Promise<unknown>;
}) {
  const [mode, setMode] = useState<VaultMode>("deposit");
  const [amount, setAmount] = useState("");
  const [lastHash, setLastHash] = useState<Hash | null>(null);
  const [confirmedApproval, setConfirmedApproval] = useState(0n);
  const { address, source } = useArcLendAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: 5042002 });
  const walletBalance = useUserBalance(vault.asset, vault.deployed);
  const depositSpender = referral.deployed
    ? EARN_REFERRAL_CONTROLLER_ADDRESS
    : vault.vault;
  const allowanceRead = useReadContract({
    chainId: 5042002,
    address: vault.asset,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, depositSpender] : undefined,
    query: {
      enabled: Boolean(address) && vault.deployed,
      refetchInterval: 4_000,
    },
  });
  const approveWrite = useArcLendContractWrite();
  const vaultAction = useEarnVaultAction();
  const parsedAmount = useMemo(() => parseTokenAmount(amount), [amount]);
  const Icon = iconFor(vault.symbol);
  const activeError = approveWrite.error || vaultAction.error;
  const isBusy = approveWrite.isPending || vaultAction.isPending;
  const allowance =
    typeof allowanceRead.data === "bigint" ? allowanceRead.data : 0n;
  const effectiveAllowance =
    allowance > confirmedApproval ? allowance : confirmedApproval;
  const hasDepositApproval =
    mode !== "deposit" ||
    (parsedAmount > 0n && effectiveAllowance >= parsedAmount);
  const userAssetsLabel = `${formatTokenAmount(vault.userAssets, 6)} ${vault.symbol}`;
  const totalAssetsUsd = Number(formatUnits(vault.totalAssets, 6));
  const canSubmit =
    Boolean(address) &&
    vault.deployed &&
    parsedAmount > 0n &&
    hasDepositApproval &&
    !isBusy;
  const canApprove =
    Boolean(address) &&
    vault.deployed &&
    mode === "deposit" &&
    parsedAmount > 0n &&
    !isBusy;

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

  const approve = useCallback(async () => {
    if (!canApprove || hasDepositApproval) return;
    approveWrite.reset();
    try {
      await ensureArc();
      const hash = resultHash(await approveWrite.writeContractAsync({
        chainId: 5042002,
        address: vault.asset,
        abi: erc20WriteAbi,
        functionName: "approve",
        args: [depositSpender, parsedAmount],
      }));
      if (hash) {
        await publicClient!.waitForTransactionReceipt({ hash });
      }
      setConfirmedApproval((current) =>
        parsedAmount > current ? parsedAmount : current,
      );
      await allowanceRead.refetch();
      setLastHash(hash ?? null);
      approveWrite.reset();
      showToast("success", `${vault.symbol} approved for Earn Vault`);
    } catch (error) {
      approveWrite.reset();
      showToast(
        "error",
        error instanceof Error
          ? error.message
          : `Could not approve ${vault.symbol}`,
      );
    }
  }, [
    allowanceRead,
    approveWrite,
    canApprove,
    depositSpender,
    ensureArc,
    hasDepositApproval,
    parsedAmount,
    publicClient,
    vault,
  ]);

  const submit = useCallback(async () => {
    if (!canSubmit || !address) return;
    vaultAction.reset();
    try {
      await ensureArc();
      const expectedShares =
        ((parsedAmount * (vault.totalShares + 1_000_000n)) /
          (vault.totalAssets + 1_000_000n));
      const minShares = (expectedShares * 9_950n) / 10_000n;
      const hash =
        mode === "deposit"
          ? referral.deployed
            ? await vaultAction.depositWithReferral(
                vault.vault,
                parsedAmount,
                address as Address,
                referralAddress,
                minShares,
              )
            : await vaultAction.deposit(
                vault.vault,
                parsedAmount,
                address as Address,
                minShares,
              )
          : await vaultAction.withdraw(
              vault.vault,
              parsedAmount,
              address as Address,
              address as Address,
            );
      if (hash) {
        await publicClient!.waitForTransactionReceipt({ hash });
      }
      await allowanceRead.refetch();
      if (mode === "deposit") {
        setConfirmedApproval((current) =>
          current > parsedAmount ? current - parsedAmount : 0n,
        );
      }
      setLastHash(hash ?? null);
      setAmount("");
      vaultAction.reset();
      showToast(
        "success",
        `${formatUnits(parsedAmount, 6)} ${vault.symbol} ${
          mode === "deposit" ? "deposited" : "withdrawn"
        }`,
      );
      await onRefresh();
    } catch (error) {
      vaultAction.reset();
      showToast(
        "error",
        error instanceof Error
          ? error.message
          : `Could not ${mode} ${vault.symbol}`,
      );
    }
  }, [
    address,
    allowanceRead,
    canSubmit,
    ensureArc,
    mode,
    onRefresh,
    parsedAmount,
    publicClient,
    referral.deployed,
    referralAddress,
    vault,
    vaultAction,
  ]);

  return (
    <GlassCard glowOnHover className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-md border border-white/[0.08] bg-white/[0.06] p-3">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">{vault.symbol} Earn Vault</h2>
            <p className="mt-1 text-xs text-white/35">
              {vault.deployed ? "Lendora managed vault" : "Deployment pending"}
            </p>
          </div>
        </div>
        <StatBadge label="Lending APY" value={supplyApy} tone="positive" />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-white/[0.08] bg-black/15 p-3">
          <p className="text-xs text-white/40">Your vault assets</p>
          <p className="mt-1 font-mono text-lg text-white">{userAssetsLabel}</p>
        </div>
        <div className="rounded-md border border-white/[0.08] bg-black/15 p-3">
          <p className="text-xs text-white/40">Available to withdraw</p>
          <p className="mt-1 font-mono text-lg text-white">
            {formatTokenAmount(
              vault.userAssets < vault.availableAssets
                ? vault.userAssets
                : vault.availableAssets,
              2,
            )}{" "}
            {vault.symbol}
          </p>
        </div>
        <div className="rounded-md border border-white/[0.08] bg-black/15 p-3">
          <p className="text-xs text-white/40">Assets per share</p>
          <p className="mt-1 font-mono text-lg text-white">
            {vault.assetsPerShare.toFixed(6)}
          </p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 rounded-md border border-white/[0.08] bg-white/[0.04] p-1">
        {(["deposit", "withdraw"] as const).map((nextMode) => (
          <button
            key={nextMode}
            type="button"
            onClick={() => {
              setMode(nextMode);
              setAmount("");
            }}
            className={`rounded px-3 py-2 text-sm transition ${
              mode === nextMode
                ? "bg-white text-black"
                : "text-white/55 hover:bg-white/[0.06] hover:text-white"
            }`}
          >
            {nextMode === "deposit" ? "Deposit" : "Withdraw"}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <TokenInput
          value={amount}
          onChange={setAmount}
          tokenName={vault.name}
          tokenSymbol={vault.symbol}
          balance={
            mode === "deposit"
              ? `${walletBalance.formatted} ${vault.symbol}`
              : userAssetsLabel
          }
          icon={Icon}
          error={Boolean(activeError)}
          onMax={() =>
            setAmount(
              mode === "deposit"
                ? walletBalance.formatted.replace(/,/g, "")
                : formatExactTokenAmount(
                    vault.userAssets < vault.availableAssets
                      ? vault.userAssets
                      : vault.availableAssets,
                    6,
                  ),
            )
          }
        />
      </div>

      {activeError ? (
        <div className="mt-3 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {errorMessage(activeError)}
        </div>
      ) : null}

      {lastHash ? (
        <a
          className="mt-3 flex items-center gap-2 rounded-md border border-emerald-200/15 bg-emerald-200/[0.06] p-3 text-sm text-emerald-100"
          href={`${ARCSCAN_TX}${lastHash}`}
          target="_blank"
          rel="noreferrer"
        >
          <CheckCircle2 className="h-4 w-4" />
          Confirmed on ArcScan
          <ExternalLink className="ml-auto h-4 w-4" />
        </a>
      ) : null}

      {!vault.deployed ? (
        <div className="mt-4 rounded-md border border-amber-200/15 bg-amber-200/[0.06] px-3 py-2 text-sm text-amber-100/80">
          Deploy the {vault.symbol} Earn Vault and update `deployments.json` before accepting deposits.
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <GlassButton
          type="button"
          variant="ghost"
          disabled={!canApprove || hasDepositApproval || approveWrite.isPending}
          onClick={() => void approve()}
        >
          {approveWrite.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          Approve
        </GlassButton>
        <GlassButton
          type="button"
          variant="primary"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          {vaultAction.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : mode === "deposit" ? (
            <ArrowDownToLine className="h-4 w-4" />
          ) : (
            <ArrowUpFromLine className="h-4 w-4" />
          )}
          {mode === "deposit" ? "Deposit" : "Withdraw"}
        </GlassButton>
      </div>
    </GlassCard>
  );
}

function EarnPageContent() {
  const earnVaults = useEarnVaultMarkets();
  const liveMarkets = useLiveMarkets();
  const searchParams = useSearchParams();
  const { address } = useArcLendAccount();
  const refParam = searchParams.get("ref");
  const referralAddress =
    refParam &&
    isAddress(refParam) &&
    (!address || refParam.toLowerCase() !== address.toLowerCase())
      ? (refParam as Address)
      : ZERO_ADDRESS;
  const totalUserAssets = earnVaults.markets.reduce(
    (sum, vault) => sum + Number(formatUnits(vault.userAssets, 6)),
    0,
  );
  const deployedCount = earnVaults.markets.filter((vault) => vault.deployed).length;

  return (
    <PageTransition>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={<PiggyBank />}
          title="Earn"
          description="Deposit stablecoins into Lendora-managed vault shares backed by lending yield, referral routing, and protocol rewards. Vaults re-supply into the same lending pools — withdrawals can be limited by pool utilization, and share value inherits pool / bad-debt risk."
          stats={[
            {
              label: "Vaults live",
              value: `${deployedCount}/2`,
              tone: deployedCount > 0 ? "positive" : "warning",
            },
            {
              label: "Your vault assets",
              value: `$${totalUserAssets.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}`,
              tone: "positive",
            },
          ]}
        />

        <div className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.05] px-4 py-3 text-xs leading-5 text-amber-100/75">
          <strong className="font-medium text-amber-100/90">Nested liquidity risk.</strong>{" "}
          Earn vaults hold aTokens in Lendora reserves. If utilization is high, vault
          withdrawals may fail until pool cash returns. Bad-debt write-offs that
          haircut aToken index also reduce vault assets per share.
        </div>

        <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="grid gap-4">
            <GlassCard className="p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-md border border-emerald-200/15 bg-emerald-200/[0.06] p-2 text-emerald-100">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Yield Source</h2>
                  <p className="mt-1 text-sm text-white/45">
                    Vault assets are supplied into Lendora pools. Borrower interest and owner-added protocol rewards raise assets per share.
                  </p>
                </div>
              </div>
              <div className="mt-5 grid gap-3">
                {liveMarkets.markets.map((market) => (
                  <div
                    key={market.symbol}
                    className="rounded-md border border-white/[0.08] bg-black/15 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-white">{market.symbol}</span>
                      <StatBadge label="Supply APY" value={market.supplyApy} tone="positive" />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-white/50">
                      <div>
                        <p>Total supplied</p>
                        <p className="mt-1 font-mono text-white">
                          {formatTokenAmount(market.totalSupply, 2)}
                        </p>
                      </div>
                      <div>
                        <p>Borrowed</p>
                        <p className="mt-1 font-mono text-white">
                          {formatTokenAmount(market.totalBorrow, 2)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </div>

          <div className="grid gap-4">
            {earnVaults.markets.map((vault) => {
              const liveMarket = liveMarkets.markets.find(
                (market) => market.symbol === vault.symbol,
              );
              return (
                <VaultCard
                  key={vault.symbol}
                  vault={vault}
                  supplyApy={liveMarket?.supplyApy ?? "0.00%"}
                  referral={earnVaults.referral}
                  referralAddress={referralAddress}
                  onRefresh={async () => {
                    await Promise.all([
                      earnVaults.refetch(),
                      liveMarkets.refetch(),
                    ]);
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </PageTransition>
  );
}

export default function EarnPage() {
  return (
    <Suspense
      fallback={
        <PageTransition>
          <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
            <Skeleton height={132} />
            <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
              <Skeleton height={360} />
              <Skeleton height={520} />
            </div>
          </div>
        </PageTransition>
      }
    >
      <EarnPageContent />
    </Suspense>
  );
}
