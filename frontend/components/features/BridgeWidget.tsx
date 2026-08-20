"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeftRight,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  ExternalLink,
  Loader2,
  XCircle,
} from "lucide-react";
import { formatUnits } from "viem";
import { ConnectSolanaWalletButton } from "@/components/wallet/ConnectSolanaWalletButton";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
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

  const content = (
    <div className={cn("space-y-5", embedded ? "" : "p-5")}>
      {!embedded ? (
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.06] p-2.5">
            <ArrowLeftRight className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">Bridge USDC</h2>
            <p className="mt-1 text-sm leading-6 text-white/50">
              Bridge bidirectionally with Circle CCTP v2 and your own wallets.
            </p>
          </div>
        </div>
      ) : null}

      <div>
        <p className="text-xs font-semibold uppercase text-white/40">
          Bridge route
        </p>
        <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="rounded-xl border border-emerald-200/20 bg-emerald-200/[0.08] px-3 py-3 text-center">
            <p className="text-[10px] uppercase tracking-wide text-white/35">
              From
            </p>
            <p className="mt-2 py-2 text-xs font-medium text-white">
              {sourceNetwork.label}
            </p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-white/35">
              Source chain
            </p>
          </div>
          <motion.button
            type="button"
            aria-label="Reverse bridge direction"
            whileHover={{ rotate: 8, scale: 1.05 }}
            whileTap={{ rotate: 180, scale: 0.92 }}
            onClick={() => {
              setSourceNetwork(destinationNetwork);
              setDestinationNetwork(sourceNetwork);
              setAmount("");
              reset();
            }}
            className="rounded-full border border-white/10 bg-white/[0.05] p-2.5 text-white/60 transition hover:bg-white/[0.09] hover:text-white"
          >
            <ArrowLeftRight className="h-4 w-4" />
          </motion.button>
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-3 text-center">
            <p className="text-[10px] uppercase tracking-wide text-white/35">
              To
            </p>
            <select
              aria-label="Destination bridge network"
              value={destinationNetwork.chain}
              onChange={(event) => {
                const next = BRIDGE_NETWORKS.find(
                  (network) => network.chain === event.target.value,
                );
                if (!next) return;
                if (next.chain === sourceNetwork.chain) {
                  setSourceNetwork(destinationNetwork);
                }
                setDestinationNetwork(next);
                setAmount("");
                reset();
              }}
              className="mt-2 w-full cursor-pointer rounded-lg border border-white/10 bg-[#15191b] px-2 py-2 text-xs font-medium text-white outline-none focus:border-emerald-200/40"
            >
              {BRIDGE_NETWORKS.map((network) => (
                <option key={network.chain} value={network.chain}>
                  {network.label}
                </option>
              ))}
            </select>
            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-white/35">
              Destination chain
            </p>
          </div>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase text-white/40">
          Wallets
        </p>
        <div className={cn("mt-2 grid gap-2 [&>*]:w-full", requiresSolana && "sm:grid-cols-2")}>
          <ConnectWalletButton />
          {requiresSolana ? <ConnectSolanaWalletButton /> : null}
        </div>
        {requiresSolana && !solanaWalletAvailable ? (
          <p className="mt-2 text-xs text-amber-100/65">
            No Solana wallet was detected. Install one with the button above,
            then refresh this page.
          </p>
        ) : null}
      </div>

      <label className="block">
        <span className="flex items-center justify-between gap-3 text-xs font-semibold uppercase text-white/40">
          <span>Amount</span>
          <span className="normal-case font-normal text-white/45">
            Available: <span className="font-mono text-white/70">
              {balanceLoading
                ? "…"
                : available.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 6,
                  })} USDC
            </span>
          </span>
        </span>
        <div className="mt-2 flex items-center rounded-lg border border-white/10 bg-white/[0.05] px-4 py-3 focus-within:border-emerald-200/35 focus-within:ring-1 focus-within:ring-emerald-200/15">
          <input
            aria-label="USDC amount to bridge"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              reset();
            }}
            inputMode="decimal"
            placeholder="0.00"
            className="min-w-0 flex-1 bg-transparent font-mono text-xl text-white outline-none placeholder:text-white/25"
          />
          <button
            type="button"
            disabled={!balanceKnown || available === 0}
            onClick={() => setAmount(String(available))}
            className="mr-3 rounded-md border border-emerald-200/20 bg-emerald-200/[0.08] px-2 py-1 text-[10px] font-semibold text-emerald-100 transition hover:bg-emerald-200/[0.14] disabled:cursor-not-allowed disabled:opacity-35"
          >
            MAX
          </button>
          <span className="text-sm font-medium text-white">USDC</span>
        </div>
        {exceedsBalance ? (
          <span className="mt-2 block text-xs text-red-300">
            Amount exceeds the available {sourceNetwork.label} balance.
          </span>
        ) : null}
      </label>

      {bridgeAction.status !== "idle" ? (
        <div className="space-y-2 rounded-xl border border-white/[0.08] bg-black/15 p-3">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs font-semibold uppercase text-white/40">
              CCTP progress
            </p>
            <span className="font-mono text-[10px] text-white/30">
              {eventCount} events
            </span>
          </div>
          {cctpProgress.map((step) => (
            <div
              key={step.key}
              className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-3"
            >
              {step.state === "success" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" />
              ) : step.state === "error" ? (
                <XCircle className="h-4 w-4 shrink-0 text-red-300" />
              ) : step.state === "active" ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-cyan-200" />
              ) : (
                <CircleDashed className="h-4 w-4 shrink-0 text-white/20" />
              )}
              <span className="min-w-0 flex-1 text-sm text-white/70">
                {step.label}
              </span>
              {step.explorerUrl ? (
                <a
                  href={step.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-white/45 transition hover:text-white"
                >
                  Explorer <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
            </div>
          ))}
          <p className="px-1 pt-1 text-[11px] leading-5 text-white/35">
            Bridging may take a minute or two while Circle&apos;s attestation
            confirms the transfer.
          </p>
        </div>
      ) : null}

      {showFundingReminder ? (
        <div className="rounded-xl border border-amber-200/10 bg-amber-100/[0.035]">
          <button
            type="button"
            aria-expanded={fundsOpen}
            onClick={() => setFundsOpen((value) => !value)}
            className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-xs font-medium text-amber-50/70"
          >
            Need testnet funds?
            <ChevronDown
              className={cn("h-4 w-4 transition", fundsOpen && "rotate-180")}
            />
          </button>
          {fundsOpen ? (
            <div className="space-y-2 border-t border-white/[0.06] px-3 py-3 text-xs text-white/50">
              <a className="block hover:text-white" href="https://faucet.circle.com" target="_blank" rel="noreferrer">
                Get testnet USDC <ExternalLink className="ml-1 inline h-3 w-3" />
              </a>
              {requiresSolana ? (
                <a className="block hover:text-white" href="https://faucet.solana.com" target="_blank" rel="noreferrer">
                  Get Solana Devnet SOL for gas <ExternalLink className="ml-1 inline h-3 w-3" />
                </a>
              ) : null}
              <a className="block hover:text-white" href="https://faucet.circle.com" target="_blank" rel="noreferrer">
                Get Arc Testnet USDC for gas <ExternalLink className="ml-1 inline h-3 w-3" />
              </a>
            </div>
          ) : null}
        </div>
      ) : null}

      {bridgeAction.error ? (
        <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {bridgeAction.error.message}
        </div>
      ) : null}

      {bridgeAction.status === "success" ? (
        <div className="rounded-xl border border-emerald-200/15 bg-emerald-200/[0.06] p-3 text-sm text-emerald-100">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            USDC arrived on {destinationNetwork.label}.
          </div>
          {explorerUrl ? (
            <a href={explorerUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs underline underline-offset-4">
              View final transaction <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>
      ) : null}

      <GlassButton
        type="button"
        variant="primary"
        className="w-full"
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
      >
        {bridgeAction.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ArrowLeftRight className="h-4 w-4" />
        )}
        {!connectorReady
          ? "Connect EVM Browser Wallet"
          : requiresSolana && !bridgeAction.solanaReady
            ? "Connect Solana Wallet"
            : bridgeAction.isLoading
              ? "Bridge in progress"
              : `Bridge to ${destinationNetwork.label}`}
      </GlassButton>

      <p className="text-center text-[11px] leading-5 text-white/35">
        Your connected wallets sign every transaction. Lendora never creates or
        stores a private key or Solana keypair.
      </p>
    </div>
  );

  return embedded ? content : <GlassCard glowOnHover>{content}</GlassCard>;
}
