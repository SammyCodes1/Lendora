"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { type Address } from "viem";
import { useReadContracts } from "wagmi";
import { useActiveDeployment } from "@/hooks/useActiveDeployment";
import { TokenMark, ChainlinkIcon } from "@/components/ui/TokenMark";
import { cn } from "@/lib/utils";

const CHAINLINK_ORACLE_ABI = [
  {
    name: "getPrice",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      { name: "price", type: "uint256" },
      { name: "decimals", type: "uint8" },
    ],
  },
] as const;

export interface TickerTokenConfig {
  symbol: string;
  name: string;
  address: Address;
  decimals: number;
  defaultPrice: number;
  priceDecimals: number;
}

export const TICKER_TOKENS: TickerTokenConfig[] = [
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x3600000000000000000000000000000000000000",
    decimals: 6,
    defaultPrice: 1.0,
    priceDecimals: 2,
  },
  {
    symbol: "EURC",
    name: "Euro Coin",
    address: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
    decimals: 6,
    defaultPrice: 1.08,
    priceDecimals: 2,
  },
  {
    symbol: "cirBTC",
    name: "Circle Wrapped Bitcoin",
    address: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
    decimals: 8,
    defaultPrice: 76120.0,
    priceDecimals: 2,
  },
  {
    symbol: "CRCL",
    name: "Circle Internet Group",
    address: "0x4352434C00000000000000000000000000000000",
    decimals: 18,
    defaultPrice: 81.72,
    priceDecimals: 2,
  },
];

function formatTickerPrice(val: number, decimals: number): string {
  if (val >= 1000) {
    return (
      "$" +
      val.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
    );
  }
  return "$" + val.toFixed(decimals);
}

export function SwapPriceTicker({ className }: { className?: string }) {
  const { chainId, deployment } = useActiveDeployment();
  const oracleAddress = (deployment?.priceOracle ||
    "0xbee561CF55b5976213325EdBa41839b6277908de") as Address;

  const contracts = useMemo(
    () =>
      TICKER_TOKENS.map((token) => ({
        chainId,
        address: oracleAddress,
        abi: CHAINLINK_ORACLE_ABI,
        functionName: "getPrice" as const,
        args: [token.address],
      })),
    [chainId, oracleAddress],
  );

  const { data } = useReadContracts({
    contracts,
    query: {
      refetchInterval: 5_000,
      staleTime: 4_000,
    },
  });

  return (
    <div
      className={cn(
        "glass-panel relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] p-3 sm:p-3.5 backdrop-blur-3xl shadow-[0_8px_32px_rgba(0,0,0,0.37)]",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {/* Chainlink Branding Badge */}
        <div className="flex shrink-0 items-center justify-between sm:justify-start gap-2.5 rounded-xl border border-[#375BD2]/30 bg-[#375BD2]/[0.1] px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#375BD2]/20 p-1">
              <ChainlinkIcon className="h-4 w-4" />
            </div>
            <div className="flex flex-col">
              <span className="font-display text-xs font-semibold tracking-wide text-white">
                Chainlink
              </span>
              <span className="text-[10px] text-white/50">
                Price Oracle Feeds
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 pl-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="font-mono text-[10px] font-medium text-emerald-400 uppercase tracking-wider">
              Live
            </span>
          </div>
        </div>

        {/* Ticker Tokens List */}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-1 sm:items-center sm:justify-end sm:gap-3 overflow-x-auto no-scrollbar">
          {TICKER_TOKENS.map((token, index) => {
            const contractRes = data?.[index];
            let priceNum = token.defaultPrice;

            if (
              contractRes?.status === "success" &&
              Array.isArray(contractRes.result)
            ) {
              const rawPrice = contractRes.result[0] as bigint;
              const dec = Number(contractRes.result[1] as number);
              if (rawPrice > 0n && dec > 0) {
                priceNum = Number(rawPrice) / 10 ** dec;
              }
            }

            const formattedPrice = formatTickerPrice(
              priceNum,
              token.priceDecimals,
            );

            return (
              <motion.div
                key={token.symbol}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
                className="group relative flex items-center justify-between sm:justify-start gap-2.5 rounded-xl border border-white/[0.08] bg-black/40 px-3 py-2 backdrop-blur-xl transition hover:border-white/20 hover:bg-white/[0.05]"
              >
                <div className="flex items-center gap-2">
                  <TokenMark
                    symbol={token.symbol}
                    className="h-6 w-6"
                    iconClassName="h-3.5 w-3.5"
                  />
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-white/90 group-hover:text-white">
                      {token.symbol}
                    </span>
                    <span className="hidden sm:inline text-[9px] text-white/40 group-hover:text-white/60">
                      {token.name}
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="font-mono text-xs font-semibold tracking-tight text-white">
                    {formattedPrice}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
