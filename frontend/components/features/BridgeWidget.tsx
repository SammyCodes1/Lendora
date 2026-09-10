"use client";

import { useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowDownUp,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clock,
  Droplets,
  ExternalLink,
  Fuel,
  Info,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Wallet,
  XCircle,
} from "lucide-react";
import { formatUnits } from "viem";
import { ConnectSolanaWalletButton } from "@/components/wallet/ConnectSolanaWalletButton";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { TokenMark } from "@/components/ui/TokenMark";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import {
  useBridge,
  type BridgeEndpoint,
} from "@/hooks/useAppKit";
import {
  useSolanaUsdcBalance,
  useSolanaWallet,
} from "@/hooks/useSolanaWallet";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { useDismissibleDropdown } from "@/hooks/useDismissibleDropdown";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type BridgeWidgetProps = { embedded?: boolean };

const BRIDGE_NETWORKS: BridgeEndpoint[] = [
  { chain: "Arc_Testnet", chainId: 5042002, label: "Arc Testnet" },
  { chain: "Ethereum_Sepolia", chainId: 11155111, label: "Ethereum Sepolia" },
  { chain: "Base_Sepolia", chainId: 84532, label: "Base Sepolia" },
  { chain: "Polygon_Amoy_Testnet", chainId: 80002, label: "Polygon Amoy" },
  { chain: "Solana_Devnet", chainId: null, label: "Solana Devnet" },
];

const USDC_BY_CHAIN = {
  Arc_Testnet: "0x3600000000000000000000000000000000000000",
  Ethereum_Sepolia: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  Base_Sepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  Polygon_Amoy_Testnet: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
} as const;

function NetworkLogo({
  chain,
  className = "h-4 w-4",
}: {
  chain: BridgeEndpoint["chain"];
  className?: string;
}) {
  if (chain === "Arc_Testnet") {
    return (
      <span className={cn("inline-flex items-center justify-center rounded-full bg-[#1a1d24] p-0.5 shrink-0", className)}>
        <svg className="h-full w-full" viewBox="0 0 31 32" fill="none" aria-label="Arc">
          <path
            d="M0 32C.26 24.17 1.59 16.85 3.82 11.17 6.64 3.97 10.73 0 15.32 0s8.68 3.97 11.5 11.17c1.47 3.75 2.55 8.2 3.19 13.04.06.43.11.87.16 1.31.02.03.03.05.02.07 0 0 .38 2.34.46 6.41h-.04c-.56-.46-7.14-5.61-18.04-4.12.16-1.84.39-3.63.68-5.34l.05-.26c4.28-.13 8.02.37 10.89 1.02l-.03-.21c-.59-3.66-1.46-7.01-2.58-9.88-1.84-4.68-4.23-7.59-6.25-7.59s-4.41 2.91-6.25 7.59c-.44 1.13-.85 2.34-1.21 3.62-.51 1.79-.94 3.7-1.28 5.71-.51 2.97-.82 6.16-.94 9.46H0Z"
            fill="white"
          />
        </svg>
      </span>
    );
  }

  if (chain === "Ethereum_Sepolia") {
    return (
      <span className={cn("inline-flex items-center justify-center rounded-full bg-[#627EEA]/20 p-0.5 shrink-0", className)}>
        <svg className="h-full w-full" viewBox="0 0 24 24" fill="none" aria-label="Ethereum">
          <path d="M12 2 5.8 12.2 12 15.8l6.2-3.6L12 2Z" fill="#8C8CFF" />
          <path d="m12 17-6.2-3.6L12 22l6.2-8.6L12 17Z" fill="#6262D9" />
          <path d="M12 2v13.8l6.2-3.6L12 2Z" fill="#6F6FEA" />
        </svg>
      </span>
    );
  }

  if (chain === "Base_Sepolia") {
    return (
      <span className={cn("inline-flex items-center justify-center rounded-full bg-[#0052FF]/20 p-0.5 shrink-0", className)}>
        <svg className="h-full w-full" viewBox="0 0 24 24" fill="none" aria-label="Base">
          <circle cx="12" cy="12" r="10" fill="#0052FF" />
          <path d="M6.4 12A5.6 5.6 0 0 1 17.5 10.9h-3.1A2.8 2.8 0 1 0 14.4 13h3.1A5.6 5.6 0 0 1 6.4 12Z" fill="white" />
        </svg>
      </span>
    );
  }

  if (chain === "Polygon_Amoy_Testnet") {
    return (
      <span className={cn("inline-flex items-center justify-center rounded-full bg-[#8247E5]/20 p-0.5 shrink-0", className)}>
        <svg className="h-full w-full" viewBox="0 0 24 24" fill="none" aria-label="Polygon">
          <path
            d="m8.3 9.1 2.5-1.5a2.4 2.4 0 0 1 2.4 0l2.5 1.5a2.4 2.4 0 0 1 1.2 2.1v2.9l2.2-1.3v-2.9L16.6 8.4a2.4 2.4 0 0 0-2.4 0l-2.5 1.5a2.4 2.4 0 0 0-1.2 2.1v2.9l-2.2 1.3-2.2-1.3V12l2.2-1.3 1.3.8V8.9L9.5 8a2.4 2.4 0 0 0-2.4 0l-2.5 1.5a2.4 2.4 0 0 0-1.2 2.1v2.9a2.4 2.4 0 0 0 1.2 2.1l2.5 1.5a2.4 2.4 0 0 0 2.4 0l2.5-1.5a2.4 2.4 0 0 0 1.2-2.1v-2.9l2.2-1.3 2.2 1.3v2.9l-2.2 1.3-1.3-.8v2.6l.1.1a2.4 2.4 0 0 0 2.4 0l2.5-1.5a2.4 2.4 0 0 0 1.2-2.1v-2.9a2.4 2.4 0 0 0-1.2-2.1l-2.5-1.5a2.4 2.4 0 0 0-2.4 0l-2.5 1.5a2.4 2.4 0 0 0-1.2 2.1v2.9l-2.2 1.3-2.2-1.3v-2.9l2.2-1.3Z"
            fill="#8247E5"
          />
        </svg>
      </span>
    );
  }

  // Solana_Devnet
  return (
    <span className={cn("inline-flex items-center justify-center rounded-full bg-[#14F195]/20 p-0.5 shrink-0", className)}>
      <svg className="h-full w-full" viewBox="0 0 397.7 311.7" fill="none" aria-label="Solana">
        <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" fill="#00FFA3" />
        <path d="M64.6 3.8C67 1.4 70.3 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" fill="#00FFA3" />
        <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" fill="#DC1FFF" />
      </svg>
    </span>
  );
}

function NetworkSelector({
  value,
  onChange,
  label,
}: {
  value: BridgeEndpoint;
  onChange: (network: BridgeEndpoint) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const containerRef = useDismissibleDropdown(open, close);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label} network: ${value.label}`}
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] py-1.5 pl-2 pr-2.5 text-xs font-semibold text-white shadow-sm transition hover:border-white/25 hover:bg-white/[0.08] active:scale-[0.98]"
      >
        <NetworkLogo chain={value.chain} className="h-4 w-4" />
        <span className="truncate max-w-[120px] sm:max-w-none">{value.label}</span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 text-white/45 transition-transform duration-200", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute right-0 top-full z-50 mt-1.5 w-56 rounded-2xl border border-white/15 bg-[#0d1217] p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.85)] backdrop-blur-2xl"
        >
          <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/35">
            Select {label} Network
          </div>
          <div className="space-y-0.5">
            {BRIDGE_NETWORKS.map((network) => {
              const isSelected = network.chain === value.chain;
              return (
                <button
                  key={network.chain}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(network);
                    close();
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition",
                    isSelected
                      ? "bg-emerald-500/15 text-white font-medium border border-emerald-500/30"
                      : "text-white/70 hover:bg-white/[0.06] hover:text-white",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <NetworkLogo chain={network.chain} className="h-4 w-4" />
                    <span>{network.label}</span>
                  </div>
                  {isSelected ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function BridgeWidget({ embedded = false }: BridgeWidgetProps) {
  const { address, isConnected, source: accountSource } = useArcLendAccount();
  const { publicKey, isAvailable: solanaWalletAvailable } = useSolanaWallet();
  const solanaBalance = useSolanaUsdcBalance(publicKey);
  const arcBalance = useTokenBalance({
    address,
    token: USDC_BY_CHAIN.Arc_Testnet,
    chainId: 5042002,
    enabled: Boolean(address),
    refetchInterval: 15_000,
  });
  const ethereumBalance = useTokenBalance({
    address,
    token: USDC_BY_CHAIN.Ethereum_Sepolia,
    chainId: 11155111,
    enabled: Boolean(address),
    refetchInterval: 15_000,
  });
  const baseBalance = useTokenBalance({
    address,
    token: USDC_BY_CHAIN.Base_Sepolia,
    chainId: 84532,
    enabled: Boolean(address),
    refetchInterval: 15_000,
  });
  const polygonBalance = useTokenBalance({
    address,
    token: USDC_BY_CHAIN.Polygon_Amoy_Testnet,
    chainId: 80002,
    enabled: Boolean(address),
    refetchInterval: 15_000,
  });
  const bridgeAction = useBridge();
  const [sourceNetwork, setSourceNetwork] = useState<BridgeEndpoint>(
    BRIDGE_NETWORKS[0],
  );
  const [destinationNetwork, setDestinationNetwork] = useState<BridgeEndpoint>(
    BRIDGE_NETWORKS[4],
  );
  const [amount, setAmount] = useState("");
  const [fundsOpen, setFundsOpen] = useState(false);
  const [eventCount, setEventCount] = useState(0);

  const connectorReady =
    isConnected && accountSource === "wallet" && bridgeAction.evmReady;
  const evmBalances = {
    Arc_Testnet: arcBalance,
    Ethereum_Sepolia: ethereumBalance,
    Base_Sepolia: baseBalance,
    Polygon_Amoy_Testnet: polygonBalance,
  };
  const selectedEvmBalance =
    sourceNetwork.chain === "Solana_Devnet"
      ? null
      : evmBalances[sourceNetwork.chain];
  const available =
    sourceNetwork.chain === "Solana_Devnet"
      ? (solanaBalance.balance ?? 0)
      : selectedEvmBalance?.data
        ? Number(
            formatUnits(
              selectedEvmBalance.data.value,
              selectedEvmBalance.data.decimals,
            ),
          )
        : 0;
  const balanceLoading =
    sourceNetwork.chain === "Solana_Devnet"
      ? solanaBalance.isLoading
      : Boolean(selectedEvmBalance?.isLoading);
  const balanceKnown =
    sourceNetwork.chain === "Solana_Devnet"
      ? solanaBalance.balance !== null
      : Boolean(selectedEvmBalance?.data);
  const requiresSolana =
    sourceNetwork.chain === "Solana_Devnet" ||
    destinationNetwork.chain === "Solana_Devnet";
  const showFundingReminder = balanceKnown && available === 0;
  const exceedsBalance = Boolean(amount) && Number(amount) > available;
  const explorerUrl = useMemo(
    () =>
      bridgeAction.result?.steps
        .slice()
        .reverse()
        .find((step) => step.explorerUrl)?.explorerUrl,
    [bridgeAction.result],
  );
  const cctpProgress = bridgeAction.progress.filter(
    (step) => step.key !== "switch",
  );

  const reset = () => {
    setEventCount(0);
    bridgeAction.reset();
  };

  const handleSourceChange = (next: BridgeEndpoint) => {
    if (next.chain === destinationNetwork.chain) {
      setDestinationNetwork(sourceNetwork);
    }
    setSourceNetwork(next);
    setAmount("");
    reset();
  };

  const handleDestinationChange = (next: BridgeEndpoint) => {
    if (next.chain === sourceNetwork.chain) {
      setSourceNetwork(destinationNetwork);
    }
    setDestinationNetwork(next);
    setAmount("");
    reset();
  };

  const handleReverse = () => {
    const prevSource = sourceNetwork;
    const prevDest = destinationNetwork;
    setSourceNetwork(prevDest);
    setDestinationNetwork(prevSource);
    setAmount("");
    reset();
  };

  const setPercent = (pct: number) => {
    if (!balanceKnown || available <= 0) return;
    const calc = available * pct;
    // Format to 2 or 4 decimal places
    const val = pct === 1 ? String(available) : calc.toFixed(2);
    setAmount(val);
    reset();
  };

  const approxUsd = useMemo(() => {
    const num = Number(amount);
    if (!num || isNaN(num)) return "$0.00";
    return `~$${num.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }, [amount]);

  const content = (
    <div className={cn("space-y-4", embedded ? "" : "p-4 sm:p-6")}>
      {!embedded ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-white/[0.08] pb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight text-white">Bridge</h2>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                CCTP v2
              </span>
            </div>
            <p className="mt-0.5 text-xs text-white/45">
              Zero slippage · Native burn & mint between testnets
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={reset}
              title="Reset route"
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-white/50 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
            >
              <RotateCcw className="h-3 w-3" />
              <span className="hidden sm:inline">Reset</span>
            </button>
            <a
              href="https://faucet.circle.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-white/50 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
            >
              <Droplets className="h-3 w-3 text-cyan-300" />
              <span>Faucet</span>
              <ExternalLink className="h-2.5 w-2.5 text-white/30" />
            </a>
          </div>
        </div>
      ) : null}

      {/* Jumper UI: "You pay" Container */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#0a0f12] p-4 transition focus-within:border-emerald-500/40 focus-within:ring-1 focus-within:ring-emerald-500/20">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-white/40">
            You pay
          </span>
          <NetworkSelector
            value={sourceNetwork}
            onChange={handleSourceChange}
            label="Source"
          />
        </div>

        <div className="mt-3.5 flex items-center justify-between gap-3">
          <input
            aria-label="USDC amount to bridge"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              reset();
            }}
            inputMode="decimal"
            placeholder="0.0"
            className="min-w-0 flex-1 bg-transparent font-mono text-3xl sm:text-4xl font-semibold text-white outline-none placeholder:text-white/20"
          />

          <div className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <TokenMark symbol="USDC" className="h-6 w-6" />
            <span className="font-semibold text-sm text-white">USDC</span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/[0.05]">
          <span className="font-mono text-xs text-white/40">{approxUsd}</span>

          <div className="flex items-center gap-1.5 text-xs text-white/45">
            <span>
              Balance:{" "}
              <span className="font-mono text-white/70">
                {balanceLoading
                  ? "…"
                  : available.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 4,
                    })}
              </span>
            </span>
            <div className="ml-1 flex items-center gap-1">
              <button
                type="button"
                disabled={!balanceKnown || available <= 0}
                onClick={() => setPercent(0.25)}
                className="rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-white/60 transition hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                25%
              </button>
              <button
                type="button"
                disabled={!balanceKnown || available <= 0}
                onClick={() => setPercent(0.5)}
                className="rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-white/60 transition hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                50%
              </button>
              <button
                type="button"
                disabled={!balanceKnown || available <= 0}
                onClick={() => setPercent(1)}
                className="rounded-md border border-emerald-400/30 bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-300 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-30"
              >
                MAX
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Jumper Direction Switcher (Centered flip button) */}
      <div className="relative -my-2.5 z-10 flex justify-center">
        <motion.button
          type="button"
          aria-label="Reverse bridge direction"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9, rotate: 180 }}
          onClick={handleReverse}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-[#0d1318] text-white/70 shadow-lg backdrop-blur-xl transition hover:border-emerald-400/40 hover:bg-[#141d22] hover:text-white active:scale-95"
        >
          <ArrowDownUp className="h-4 w-4" />
        </motion.button>
      </div>

      {/* Jumper UI: "You receive" Container */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#0a0f12] p-4 transition hover:border-white/15">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-white/40">
            You receive
          </span>
          <NetworkSelector
            value={destinationNetwork}
            onChange={handleDestinationChange}
            label="Destination"
          />
        </div>

        <div className="mt-3.5 flex items-center justify-between gap-3">
          <span className="min-w-0 flex-1 truncate font-mono text-3xl sm:text-4xl font-semibold text-white">
            {amount ? amount : "0.0"}
          </span>

          <div className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <TokenMark symbol="USDC" className="h-6 w-6" />
            <span className="font-semibold text-sm text-white">USDC</span>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 pt-2 border-t border-white/[0.05]">
          <span className="font-mono text-xs text-white/40">{approxUsd}</span>
          <span className="rounded-md bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
            1:1 CCTP Guaranteed Peg
          </span>
        </div>
      </div>

      {/* Jumper UI: Route / Execution Details Card */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3.5 space-y-2.5">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
            <span className="font-medium text-white">Circle CCTP v2</span>
            <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-emerald-300">
              Best Route
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-white/50">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3 text-white/40" />
              ~1–2 min
            </span>
            <span>·</span>
            <span className="flex items-center gap-1 text-emerald-300">
              <Fuel className="h-3 w-3" />
              Zero Fee
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.05] pt-2 text-[11px] text-white/45">
          <span>Execution path</span>
          <span className="flex items-center gap-1 text-white/80 font-mono text-[10px]">
            <span className="text-white/60">{sourceNetwork.label}</span>
            <span className="text-emerald-400">→</span>
            <span>CCTP Attestation</span>
            <span className="text-emerald-400">→</span>
            <span className="text-white/60">{destinationNetwork.label}</span>
          </span>
        </div>
      </div>

      {/* Wallets Connector Row */}
      <div className="space-y-2">
        <div className={cn("grid gap-2 [&>*]:w-full", requiresSolana && "sm:grid-cols-2")}>
          <ConnectWalletButton />
          {requiresSolana ? <ConnectSolanaWalletButton /> : null}
        </div>
        {requiresSolana && !solanaWalletAvailable ? (
          <p className="text-xs text-amber-200/80 bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5">
            No Solana wallet detected. Install Phantom or Backpack to bridge to/from Solana Devnet.
          </p>
        ) : null}
      </div>

      {/* Balance Exceeded Error */}
      {exceedsBalance ? (
        <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-200">
          Entered amount exceeds the available {sourceNetwork.label} balance of {available.toLocaleString()} USDC.
        </div>
      ) : null}

      {/* CCTP Progress Card */}
      {bridgeAction.status !== "idle" ? (
        <div className="space-y-2.5 rounded-2xl border border-white/[0.08] bg-black/20 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-white/40">
              CCTP Bridge Progress
            </p>
            <span className="font-mono text-[10px] text-white/35">
              {eventCount} events logged
            </span>
          </div>

          <div className="space-y-1.5">
            {cctpProgress.map((step) => (
              <div
                key={step.key}
                className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5"
              >
                {step.state === "success" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                ) : step.state === "error" ? (
                  <XCircle className="h-4 w-4 shrink-0 text-red-400" />
                ) : step.state === "active" ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-400" />
                ) : (
                  <CircleDashed className="h-4 w-4 shrink-0 text-white/20" />
                )}
                <span className="min-w-0 flex-1 text-xs sm:text-sm text-white/80">
                  {step.label}
                </span>
                {step.explorerUrl ? (
                  <a
                    href={step.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-xs text-emerald-400 transition hover:text-emerald-300 underline underline-offset-2"
                  >
                    Explorer <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            ))}
          </div>

          <p className="pt-1 text-[11px] text-white/35">
            Circle&apos;s validator set typically completes cross-chain attestation in ~1–2 minutes.
          </p>
        </div>
      ) : null}

      {/* Funding reminder */}
      {showFundingReminder ? (
        <div className="rounded-xl border border-amber-200/15 bg-amber-100/[0.03]">
          <button
            type="button"
            aria-expanded={fundsOpen}
            onClick={() => setFundsOpen((value) => !value)}
            className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-xs font-medium text-amber-100/75"
          >
            <span>Need testnet funds on {sourceNetwork.label}?</span>
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", fundsOpen && "rotate-180")}
            />
          </button>
          {fundsOpen ? (
            <div className="space-y-2 border-t border-white/[0.06] px-3 py-2.5 text-xs text-white/50">
              <a className="flex items-center justify-between hover:text-white" href="https://faucet.circle.com" target="_blank" rel="noreferrer">
                <span>Get Circle testnet USDC</span>
                <ExternalLink className="h-3 w-3" />
              </a>
              {requiresSolana ? (
                <a className="flex items-center justify-between hover:text-white" href="https://faucet.solana.com" target="_blank" rel="noreferrer">
                  <span>Get Solana Devnet SOL for gas</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Error Message */}
      {bridgeAction.error ? (
        <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs sm:text-sm text-red-300">
          {bridgeAction.error.message}
        </div>
      ) : null}

      {/* Success Notification */}
      {bridgeAction.status === "success" ? (
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3.5 text-sm text-emerald-100 space-y-2">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <span>USDC successfully arrived on {destinationNetwork.label}.</span>
          </div>
          {explorerUrl ? (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-xs text-emerald-300 underline underline-offset-4 hover:text-white"
            >
              View confirmation on Explorer <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>
      ) : null}

      {/* Jumper-style Primary Action Button */}
      <button
        type="button"
        disabled={
          !connectorReady ||
          (requiresSolana && !bridgeAction.solanaReady) ||
          !amount ||
          Number(amount) <= 0 ||
          exceedsBalance ||
          bridgeAction.isLoading
        }
        onClick={async () => {
          try {
            await bridgeAction.bridge(
              {
                source: sourceNetwork,
                destination: destinationNetwork,
                amount,
              },
              () => setEventCount((count) => count + 1),
            );
            showToast("success", `USDC bridged to ${destinationNetwork.label}`);
          } catch (error) {
            showToast(
              "error",
              error instanceof Error ? error.message : "Bridge failed",
            );
          }
        }}
        className={cn(
          "w-full min-h-[50px] rounded-xl font-semibold text-sm sm:text-base transition-all flex items-center justify-center gap-2 shadow-[0_10px_30px_rgba(16,185,129,0.20)] active:scale-[0.99]",
          !connectorReady ||
            (requiresSolana && !bridgeAction.solanaReady) ||
            !amount ||
            Number(amount) <= 0 ||
            exceedsBalance ||
            bridgeAction.isLoading
            ? "cursor-not-allowed border border-white/10 bg-white/[0.05] text-white/35 shadow-none"
            : "border border-emerald-400/30 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-[0_10px_35px_rgba(16,185,129,0.28)]",
        )}
      >
        {bridgeAction.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4 text-emerald-200" />
        )}
        {!connectorReady
          ? "Connect Browser Wallet"
          : requiresSolana && !bridgeAction.solanaReady
            ? "Connect Solana Wallet"
            : bridgeAction.isLoading
              ? "Bridge in progress…"
              : `Bridge to ${destinationNetwork.label}`}
      </button>

      <p className="text-center text-[10px] leading-4 text-white/30">
        Non-custodial settlement · Transactions signed directly via your connected browser wallet.
      </p>
    </div>
  );

  return embedded ? (
    content
  ) : (
    <div className="rounded-3xl border border-white/10 bg-[#0a0f12]/90 shadow-[0_24px_80px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl">
      {content}
    </div>
  );
}
