"use client";

import { useState } from "react";
import Image from "next/image";
import {
  Award,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Trash2,
  Sparkles,
} from "lucide-react";
import {
  useChainId,
  usePublicClient,
  useSwitchChain,
} from "wagmi";
import { formatUnits } from "viem";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import { PageTransition } from "@/components/layout/PageTransition";
import { PageHeader } from "@/components/layout/PageHeader";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import {
  useBurnAllPositions,
  useClosePosition,
  useClaimExistingPosition,
  useUserPositionNFTs,
  type ClaimablePositionReceipt,
  type UserPositionNFT,
} from "@/hooks/usePositionManager";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import deployments from "@/constants/deployments.json";
import { showToast } from "@/lib/toast";

function nftExplorerUrl(tokenId: bigint) {
  return `https://testnet.arcscan.app/token/${deployments.PositionNFT}?a=${tokenId}`;
}

export default function PositionsPage() {
  const { address, isConnected, source } = useArcLendAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: 5042002 });
  const receipts = useUserPositionNFTs();
  const claimAction = useClaimExistingPosition();
  const closeAction = useClosePosition();
  const burnAllAction = useBurnAllPositions();
  const [claimingKey, setClaimingKey] = useState<string | null>(null);
  const [closingTokenId, setClosingTokenId] = useState<bigint | null>(null);

  const burnablePositions = receipts.positions.filter(
    (p) => p.liveBalance === 0n,
  );

  const claimReceipt = async (
    claimable: ClaimablePositionReceipt,
  ) => {
    if (!address || !publicClient) return;
    const key = `${claimable.asset}-${claimable.positionType}`;
    setClaimingKey(key);
    try {
      if (source !== "email" && chainId !== 5042002) {
        await switchChainAsync({ chainId: 5042002 });
      }
      const hash = await claimAction.claimExistingPosition(
        claimable.asset,
        claimable.positionType,
      );
      if (hash) {
        await publicClient.waitForTransactionReceipt({ hash });
      }
      await receipts.refetch();
      showToast(
        "success",
        `${claimable.typeLabel} ${claimable.symbol} receipt claimed`,
      );
    } catch (error) {
      showToast(
        "error",
        error instanceof Error
          ? error.message
          : "Could not claim position receipt",
      );
    } finally {
      setClaimingKey(null);
    }
  };

  const burnReceipt = async (position: UserPositionNFT) => {
    if (!address) {
      showToast("error", "Connect your wallet before burning a receipt.");
      return;
    }
    if (!publicClient) {
      showToast("error", "Arc client is unavailable.");
      return;
    }
    if (position.liveBalance > 0n) {
      showToast(
        "error",
        `Close this ${position.typeLabel.toLowerCase()} position before burning its receipt.`,
      );
      return;
    }
    setClosingTokenId(position.tokenId);
    try {
      if (source !== "email" && chainId !== 5042002) {
        await switchChainAsync({ chainId: 5042002 });
      }
      const hash = await closeAction.closePosition(
        position.asset,
        position.positionType,
      );
      if (hash) {
        await publicClient.waitForTransactionReceipt({ hash });
      }
      await receipts.refetch();
      showToast(
        "success",
        `${position.typeLabel} ${position.symbol} receipt burned`,
      );
    } catch (error) {
      showToast(
        "error",
        error instanceof Error
          ? error.message
          : "Could not burn position receipt",
      );
    } finally {
      setClosingTokenId(null);
    }
  };

  const burnAllReceipts = async () => {
    if (!address) {
      showToast("error", "Connect your wallet before burning receipts.");
      return;
    }
    if (!publicClient) {
      showToast("error", "Arc client is unavailable.");
      return;
    }
    if (burnablePositions.length === 0) {
      showToast("info", "No receipts ready to burn.");
      return;
    }
    if (source !== "email" && chainId !== 5042002) {
      try {
        await switchChainAsync({ chainId: 5042002 });
      } catch {
        showToast("error", "Switch to Arc Testnet to continue.");
        return;
      }
    }
    const results = await burnAllAction.burnAll(burnablePositions);
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    await receipts.refetch();
    burnAllAction.reset();
    if (failed === 0) {
      showToast("success", `Burned ${succeeded} receipt${succeeded !== 1 ? "s" : ""}.`);
    } else {
      showToast(
        "error",
        `Burned ${succeeded}, ${failed} failed. Check the console for details.`,
      );
    }
  };

  return (
    <PageTransition>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={<Award />}
          title="Positions"
          description="Claim and inspect on-chain receipts that represent ArcLend supply and borrow positions across the protocol."
          stats={[
            {
              label: "Receipts",
              value: receipts.positions.length.toString(),
              tone: receipts.positions.length > 0 ? "positive" : "neutral",
            },
            {
              label: "Claimable",
              value: receipts.claimable.length.toString(),
              tone: receipts.claimable.length > 0 ? "positive" : "neutral",
            },
          ]}
        />

        {!isConnected ? (
          <GlassCard className="flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-xl font-semibold text-white">
                Connect your wallet
              </h2>
              <p className="mt-1 text-sm text-white/45">
                Position receipts and retroactive claims are wallet-specific.
              </p>
            </div>
            <ConnectWalletButton />
          </GlassCard>
        ) : null}

        {isConnected && receipts.claimable.length > 0 ? (
          <GlassCard depth="foreground" className="p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <Sparkles className="h-5 w-5 text-white/65" />
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Existing positions found
                </h2>
                <p className="text-xs text-white/40">
                  Claim on-chain receipts for positions opened before this feature.
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {receipts.claimable.map((claimable) => {
                const key = `${claimable.asset}-${claimable.positionType}`;
                const isClaiming = claimingKey === key;
                return (
                  <div
                    key={key}
                    className="rounded-md border border-white/[0.08] bg-black/20 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-white">
                          {claimable.typeLabel} {claimable.symbol}
                        </p>
                        <p className="mt-1 font-mono text-xs text-white/45">
                          {formatUnits(claimable.liveBalance, 6)}{" "}
                          {claimable.symbol}
                        </p>
                      </div>
                      <GlassButton
                        variant="primary"
                        className="px-3"
                        disabled={claimingKey !== null}
                        onClick={() => void claimReceipt(claimable)}
                      >
                        {isClaiming ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Award className="h-4 w-4" />
                        )}
                        Claim Receipt
                      </GlassButton>
                    </div>
                  </div>
                );
              })}
            </div>
          </GlassCard>
        ) : null}

        {isConnected && receipts.isLoading ? (
          <div className="flex min-h-52 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.03]">
            <Loader2 className="h-6 w-6 animate-spin text-white/65" />
          </div>
        ) : null}

        {isConnected &&
        !receipts.isLoading &&
        receipts.positions.length === 0 ? (
          <GlassCard className="flex min-h-64 flex-col items-center justify-center p-8 text-center">
            <Award className="h-10 w-10 text-white/55" />
            <h2 className="mt-4 text-xl font-semibold text-white">
              No position receipts yet
            </h2>
            <p className="mt-2 text-sm text-white/45">
              Supply or borrow an asset to mint your first one.
            </p>
          </GlassCard>
        ) : null}

        {burnablePositions.length > 0 ? (
          <GlassCard depth="foreground" className="flex flex-col items-start justify-between gap-4 p-5 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-lg font-semibold text-white">
                {burnablePositions.length} receipt{burnablePositions.length !== 1 ? "s" : ""} ready to burn
              </h2>
              <p className="mt-1 text-xs text-white/40">
                These positions have been closed — burn their receipts to clean up
                your portfolio.
              </p>
            </div>
            <GlassButton
              variant="danger"
              disabled={burnAllAction.isBurning}
              onClick={() => void burnAllReceipts()}
            >
              {burnAllAction.isBurning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Burning{" "}
                  {burnAllAction.progress
                    ? `${burnAllAction.progress.current}/${burnAllAction.progress.total}`
                    : "..."}
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Burn All Receipts
                </>
              )}
            </GlassButton>
          </GlassCard>
        ) : null}

        {receipts.positions.length > 0 ? (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {receipts.positions.map((position, index) => (
              <GlassCard
                key={position.tokenId.toString()}
                glowOnHover
                depth="foreground"
                delay={index * 0.08}
                className="overflow-hidden rounded-2xl p-0"
              >
                {position.metadata?.image ? (
                  <Image
                    src={position.metadata.image}
                    alt={position.metadata.name}
                    width={640}
                    height={640}
                    unoptimized
                    className="aspect-square w-full border-b border-white/[0.08] bg-black object-cover"
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center bg-black">
                    <Award className="h-12 w-12 text-white/35" />
                  </div>
                )}
                <div className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">
                        {position.symbol} Position
                      </p>
                      <p className="mt-1 text-xs text-white/40">
                        Opened{" "}
                        {new Date(
                          Number(position.openedAt) * 1_000,
                        ).toLocaleDateString()}
                      </p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[10px] font-semibold uppercase text-white/65">
                      {position.typeLabel}
                    </span>
                  </div>
                  <div className="mt-4 rounded-xl border border-white/[0.07] bg-black/20 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-white/30">
                      Live balance
                    </p>
                    <p className="mt-1 font-mono text-lg text-white">
                      {position.formattedBalance} {position.symbol}
                    </p>
                  </div>
                  <div className="mt-4 grid gap-2">
                    <a
                      href={nftExplorerUrl(position.tokenId)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.045] px-4 text-sm text-white/75 transition hover:bg-white/[0.08] hover:text-white"
                    >
                      View NFT on ArcScan
                      <ExternalLink className="h-4 w-4" />
                    </a>
                    <GlassButton
                      variant={position.liveBalance > 0n ? "ghost" : "danger"}
                      disabled={
                        closingTokenId !== null ||
                        position.liveBalance > 0n
                      }
                      onClick={() => void burnReceipt(position)}
                    >
                      {closingTokenId === position.tokenId ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      Close Position
                    </GlassButton>
                    {position.liveBalance > 0n ? (
                      <p className="text-[10px] leading-4 text-white/32">
                        Close this {position.typeLabel.toLowerCase()} position before burning its receipt.
                      </p>
                    ) : null}
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        ) : null}

        {receipts.positions.length > 0 ? (
          <div className="flex items-center gap-2 text-xs text-white/35">
            <CheckCircle2 className="h-4 w-4 text-white/55" />
            Balances and on-chain SVG metadata refresh automatically.
          </div>
        ) : null}
      </div>
    </PageTransition>
  );
}
