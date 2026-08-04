"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, DollarSign, Gift, Search } from "lucide-react";
import { formatUnits, parseAbiItem, type Address } from "viem";
import { usePublicClient } from "wagmi";
import lendingPoolAbi from "@/constants/abis/LendingPool.json";
import erc20Abi from "@/constants/abis/ERC20.json";
import deployments from "@/constants/deployments.json";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { PageTransition } from "@/components/layout/PageTransition";
import { PageHeader } from "@/components/layout/PageHeader";
import { LiquidateModal, type LiquidationTarget } from "@/components/modals/LiquidateModal";
import { useLiveMarkets } from "@/hooks/useLiveMarkets";
import type { MarketAsset } from "@/components/modals/types";

type AtRiskPosition = LiquidationTarget & {
  status: "At Risk" | "Liquidatable";
};

const borrowEvent = parseAbiItem("event Borrow(address indexed asset,address indexed user,address indexed onBehalfOf,uint256 amount)");
const arcscanAddress = "https://testnet.arcscan.app/address/";
const LOG_BLOCKS_PER_REQUEST = 9_500n;

function usd8(value: bigint) {
  return `$${Number(formatUnits(value, 8)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function healthNumber(value: bigint) {
  return Number(formatUnits(value, 18));
}

function truncate(address: Address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function tokenUsd(amount: bigint, market: MarketAsset) {
  return (amount * market.price) / 1_000_000n;
}

function useAtRiskPositions(markets: MarketAsset[]) {
  const publicClient = usePublicClient({ chainId: 5042002 });
  const [positions, setPositions] = useState<AtRiskPosition[]>([]);

  useEffect(() => {
    if (!publicClient || deployments.lendingPool === "0x0000000000000000000000000000000000000000") {
      setPositions([]);
      return;
    }

    let cancelled = false;
    const client = publicClient;

    async function loadPositions() {
      const latest = await client.getBlockNumber();
      const deploymentBlock = BigInt(deployments.deploymentBlock);
      const borrowerSet = new Set<Address>();

      for (
        let fromBlock = deploymentBlock;
        fromBlock <= latest;
        fromBlock += LOG_BLOCKS_PER_REQUEST
      ) {
        const proposedToBlock = fromBlock + LOG_BLOCKS_PER_REQUEST - 1n;
        const toBlock = proposedToBlock < latest ? proposedToBlock : latest;
        const logs = await client.getLogs({
          address: deployments.lendingPool as Address,
          event: borrowEvent,
          fromBlock,
          toBlock,
        });

        for (const log of logs) {
          const borrower = (log.args.onBehalfOf || log.args.user) as Address | undefined;
          if (borrower) borrowerSet.add(borrower);
        }
      }

      const borrowers = Array.from(borrowerSet);

      const accountRows = await Promise.all(
        borrowers.map(async (borrower) => {
          const [data, ...balances] = await Promise.all([
            client.readContract({
              address: deployments.lendingPool as Address,
              abi: lendingPoolAbi,
              functionName: "getUserAccountData",
              args: [borrower],
            }),
            ...markets.flatMap((market) => [
              client.readContract({
                address: market.aToken,
                abi: erc20Abi,
                functionName: "balanceOf",
                args: [borrower],
              }),
              client.readContract({
                address: market.debtToken,
                abi: erc20Abi,
                functionName: "balanceOf",
                args: [borrower],
              }),
            ]),
          ]);

          const account = data as {
            totalCollateralUSD: bigint;
            totalDebtUSD: bigint;
            availableBorrowsUSD: bigint;
            healthFactor: bigint;
          };
          const healthFactor = account.healthFactor;
          const health = healthNumber(healthFactor);

          if (health >= 1.2 || account.totalDebtUSD === 0n) {
            return null;
          }

          const positions = markets.map((market, index) => ({
            market,
            supplied: balances[index * 2] as bigint,
            borrowed: balances[index * 2 + 1] as bigint,
          }));
          const collateral = positions
            .filter((position) => position.supplied > 0n)
            .sort((left, right) =>
              Number(tokenUsd(right.supplied, right.market) - tokenUsd(left.supplied, left.market)),
            )[0];
          const debt = positions
            .filter((position) => position.borrowed > 0n)
            .sort((left, right) =>
              Number(tokenUsd(right.borrowed, right.market) - tokenUsd(left.borrowed, left.market)),
            )[0];

          if (!collateral || !debt) {
            return null;
          }

          return {
            borrower,
            collateralUSD: account.totalCollateralUSD,
            debtUSD: account.totalDebtUSD,
            healthFactor,
            collateralMarket: collateral.market,
            debtMarket: debt.market,
            debtAmount: debt.borrowed,
            status: health < 1 ? "Liquidatable" : "At Risk",
          } satisfies AtRiskPosition;
        }),
      );

      if (!cancelled) {
        setPositions(accountRows.filter((row): row is AtRiskPosition => Boolean(row)));
      }
    }

    loadPositions().catch(() => setPositions([]));

    return () => {
      cancelled = true;
    };
  }, [markets, publicClient]);

  return positions;
}

function StepTile({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="rounded-md border border-white/[0.08] bg-black/15 p-4">
      <div className="w-fit rounded-md border border-white/[0.08] bg-white/[0.055] p-3 text-white">{icon}</div>
      <h3 className="mt-4 font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-white/55">{description}</p>
    </div>
  );
}

export default function LiquidatePage() {
  const { markets } = useLiveMarkets();
  const positions = useAtRiskPositions(markets);
  const [target, setTarget] = useState<LiquidationTarget | null>(null);

  return (
    <PageTransition>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={<AlertTriangle />}
          title="Liquidations"
          description="Scan recent borrowers for under-collateralized positions, review health factor, and act when liquidation criteria are met."
        />

        <GlassCard glowOnHover className="p-5">
          <h2 className="text-xl font-semibold text-white">How liquidations work</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <StepTile icon={<Search className="h-5 w-5" />} title="Find Risk" description="Find positions with Health Factor below 1.0." />
            <StepTile icon={<DollarSign className="h-5 w-5" />} title="Repay Debt" description="Repay up to 50% of the borrower's outstanding debt." />
            <StepTile icon={<Gift className="h-5 w-5" />} title="Receive Bonus" description="Receive collateral plus the reserve's configured liquidation bonus." />
          </div>
        </GlassCard>

        <GlassCard className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-white/[0.08] p-5">
            <h2 className="text-xl font-semibold text-white">At-Risk Positions</h2>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-3 py-1 text-xs text-white/55">{positions.length} found</span>
          </div>

          <div className="grid gap-3 p-4 md:hidden">
            {positions.length === 0 ? (
              <div className="rounded-md border border-white/[0.08] bg-white/[0.04] p-5 text-center text-sm text-white/45">
                No at-risk borrowers found from recent Borrow events.
              </div>
            ) : (
              positions.map((position) => {
                const health = healthNumber(position.healthFactor);
                return (
                  <GlassCard key={position.borrower} glowOnHover className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <Link href={`${arcscanAddress}${position.borrower}`} target="_blank" className="font-mono text-sm text-white underline decoration-white/20 underline-offset-4">
                        {truncate(position.borrower)}
                      </Link>
                      <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-xs text-white/60">{position.status}</span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-white/55">
                      <div><p>Collateral</p><p className="mt-1 font-mono text-white">{usd8(position.collateralUSD)}</p></div>
                      <div><p>Debt</p><p className="mt-1 font-mono text-white">{usd8(position.debtUSD)}</p></div>
                      <div><p>Health Factor</p><p className="mt-1 font-mono text-white">{health.toFixed(2)}</p></div>
                      <div><p>Bonus</p><p className="mt-1 font-mono text-white">{(position.collateralMarket.liquidationBonus / 100).toFixed(2)}%</p></div>
                    </div>
                    <GlassButton variant={health < 1 ? "primary" : "ghost"} className="mt-4 w-full" onClick={() => setTarget(position)}>Liquidate</GlassButton>
                  </GlassCard>
                );
              })
            )}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="text-white/45">
                <tr className="border-b border-white/[0.08]">
                  <th className="px-5 py-4 font-medium">Borrower</th>
                  <th className="px-5 py-4 font-medium">Collateral</th>
                  <th className="px-5 py-4 font-medium">Debt</th>
                  <th className="px-5 py-4 font-medium">Health Factor</th>
                  <th className="px-5 py-4 font-medium">Bonus</th>
                  <th className="px-5 py-4 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {positions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-white/45">
                      No at-risk borrowers found from recent Borrow events.
                    </td>
                  </tr>
                ) : (
                  positions.map((position) => {
                    const health = healthNumber(position.healthFactor);
                    const barWidth = `${Math.min(100, Math.max(5, health * 80))}%`;

                    return (
                      <tr key={position.borrower} className="border-b border-white/[0.05] transition hover:translate-x-0.5 hover:bg-white/[0.05]">
                        <td className="px-5 py-5">
                          <Link href={`${arcscanAddress}${position.borrower}`} target="_blank" className="font-mono text-white underline decoration-white/20 underline-offset-4">
                            {truncate(position.borrower)}
                          </Link>
                          <p className="mt-1 text-xs text-white/45">{position.status}</p>
                        </td>
                        <td className="px-5 py-5 font-mono text-white">{usd8(position.collateralUSD)}</td>
                        <td className="px-5 py-5 font-mono text-white">{usd8(position.debtUSD)}</td>
                        <td className="px-5 py-5">
                          <div className="flex items-center gap-3">
                            <div className="h-2 w-28 rounded-full bg-white/[0.06]">
                              <div className="h-full rounded-full bg-white/70" style={{ width: barWidth, opacity: health < 1 ? 0.35 : 0.7 }} />
                            </div>
                            <span className="font-mono text-white/75">{health.toFixed(2)}</span>
                          </div>
                        </td>
                        <td className="px-5 py-5 font-mono text-white">{(position.collateralMarket.liquidationBonus / 100).toFixed(2)}%</td>
                        <td className="px-5 py-5">
                          <GlassButton variant={health < 1 ? "primary" : "ghost"} onClick={() => setTarget(position)}>Liquidate</GlassButton>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </GlassCard>

        <LiquidateModal open={Boolean(target)} target={target} onClose={() => setTarget(null)} />
      </div>
    </PageTransition>
  );
}
