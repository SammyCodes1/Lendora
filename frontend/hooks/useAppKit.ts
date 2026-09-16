"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppKit } from "@circle-fin/app-kit";
import type {
  AppKitActions,
  BridgeResult,
  BridgeStep,
  GetBalancesResult,
  SendParams,
  SpendResult,
} from "@circle-fin/app-kit";
import { createSolanaAdapterFromProvider } from "@circle-fin/adapter-solana";
import { formatUnits, type Abi, type Address, type EIP1193Provider } from "viem";
import { useAccount, useChainId, useReadContracts, useSwitchChain } from "wagmi";
import erc20Abi from "@/constants/abis/ERC20.json";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import { useSolanaWallet } from "@/hooks/useSolanaWallet";
import { appKit, createAppKitAdapter, ArcMainnet } from "@/lib/appkit";

export type AppKitStatus =
  | "idle"
  | "loading"
  | "switching"
  | "confirming"
  | "success"
  | "error";

export type BridgeNetwork = {
  chain:
    | "Arc"
    | "Ethereum"
    | "Base"
    | "Polygon"
    | "Arbitrum";
  chainId: 5042 | 1 | 8453 | 137 | 42161;
  label: string;
};

export type BridgeSource = BridgeNetwork;

export type SolanaBridgeNetwork = {
  chain: "Solana";
  chainId: null;
  label: string;
};

export type BridgeEndpoint = BridgeNetwork | SolanaBridgeNetwork;
export type BridgeEvent = AppKitActions[keyof AppKitActions];

type BridgeInput = {
  source: BridgeEndpoint;
  destination: BridgeEndpoint;
  amount: string;
};

export type BridgeProgressStep = {
  key: "switch" | "approve" | "burn" | "attestation" | "mint";
  label: string;
  state: "waiting" | "active" | "success" | "error";
  finalityMs?: number;
  explorerUrl?: string;
  errorMessage?: string;
};

function createBridgeProgress(
  destinationLabel = "Arc Mainnet",
): BridgeProgressStep[] {
  return [
    { key: "switch", label: "Switch source network", state: "waiting" },
    { key: "approve", label: "Approve USDC", state: "waiting" },
    { key: "burn", label: "Burn on source chain", state: "waiting" },
    {
      key: "attestation",
      label: "Verify Circle attestation",
      state: "waiting",
    },
    {
      key: "mint",
      label: `Mint on ${destinationLabel}`,
      state: "waiting",
    },
  ];
}

const initialBridgeProgress = createBridgeProgress();

const nextBridgeStep: Partial<
  Record<BridgeProgressStep["key"], BridgeProgressStep["key"]>
> = {
  approve: "burn",
  burn: "attestation",
  attestation: "mint",
};

const walletUsdcContracts = [
  {
    key: "arc",
    chainId: 5042,
    address: "0x3600000000000000000000000000000000000000",
  },
  {
    key: "ethereum",
    chainId: 1,
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  },
  {
    key: "base",
    chainId: 8453,
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  {
    key: "polygon",
    chainId: 137,
    address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  },
  {
    key: "arbitrum",
    chainId: 42161,
    address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  },
] as const;

function toError(error: unknown) {
  return error instanceof Error ? error : new Error("Circle App Kit operation failed");
}

async function adapterForConnector(connector: ReturnType<typeof useAccount>["connector"]) {
  if (!connector) {
    throw new Error("Connect a wallet before using Circle App Kit");
  }

  const provider = (await connector.getProvider()) as EIP1193Provider;
  return createAppKitAdapter(provider);
}

export function useBridge() {
  const { connector } = useAccount();
  const {
    publicKey: solanaPublicKey,
    provider: solanaProvider,
  } = useSolanaWallet();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const [bridgeKit] = useState(() => new AppKit());
  const onEventRef = useRef<((event: BridgeEvent) => void) | undefined>(
    undefined,
  );
  const [status, setStatus] = useState<AppKitStatus>("idle");
  const [result, setResult] = useState<BridgeResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [progress, setProgress] = useState<BridgeProgressStep[]>(
    initialBridgeProgress,
  );
  const [finalityMs, setFinalityMs] = useState<number | null>(null);
  const bridgeStartedAtRef = useRef<number | null>(null);
  const stepStartedAtRef = useRef<
    Partial<Record<BridgeProgressStep["key"], number>>
  >({});

  const updateProgress = useCallback(
    (
      key: BridgeProgressStep["key"],
      update: Partial<BridgeProgressStep>,
    ) => {
      setProgress((steps) =>
        steps.map((step) => (step.key === key ? { ...step, ...update } : step)),
      );
    },
    [],
  );

  const applyTimedStep = useCallback(
    (
      key: BridgeProgressStep["key"],
      step: BridgeStep,
    ) => {
      const state: BridgeProgressStep["state"] =
        step.state === "success" || step.state === "noop"
          ? "success"
          : step.state === "error"
            ? "error"
            : "active";
      const now = performance.now();

      if (state === "active" && stepStartedAtRef.current[key] === undefined) {
        stepStartedAtRef.current[key] = now;
      }

      const startedAt = stepStartedAtRef.current[key];
      const finalityMs =
        step.state === "noop"
          ? 0
          : (state === "success" || state === "error") &&
              startedAt !== undefined
            ? Math.max(0, Math.round(now - startedAt))
            : undefined;

      updateProgress(key, {
        state,
        finalityMs,
        explorerUrl: step.explorerUrl,
        errorMessage: step.errorMessage,
      });

      const nextKey = nextBridgeStep[key];
      if (state === "success" && nextKey) {
        stepStartedAtRef.current[nextKey] = now;
      }
    },
    [updateProgress],
  );

  useEffect(() => {
    const onApprove = (payload: AppKitActions["bridge.approve"]) => {
      onEventRef.current?.(payload);
      applyTimedStep("approve", payload.values);
    };
    const onBurn = (payload: AppKitActions["bridge.burn"]) => {
      onEventRef.current?.(payload);
      applyTimedStep("burn", payload.values);
    };
    const onAttestation = (
      payload: AppKitActions["bridge.fetchAttestation"],
    ) => {
      onEventRef.current?.(payload);
      applyTimedStep("attestation", payload.values);
    };
    const onMint = (payload: AppKitActions["bridge.mint"]) => {
      onEventRef.current?.(payload);
      applyTimedStep("mint", payload.values);
    };

    bridgeKit.on("bridge.approve", onApprove);
    bridgeKit.on("bridge.burn", onBurn);
    bridgeKit.on("bridge.fetchAttestation", onAttestation);
    bridgeKit.on("bridge.mint", onMint);

    return () => {
      bridgeKit.off("bridge.approve", onApprove);
      bridgeKit.off("bridge.burn", onBurn);
      bridgeKit.off("bridge.fetchAttestation", onAttestation);
      bridgeKit.off("bridge.mint", onMint);
    };
  }, [applyTimedStep, bridgeKit]);

  const bridge = useCallback(
    async (
      input: BridgeInput,
      onEvent?: (event: BridgeEvent) => void,
    ) => {
      const { source, destination, amount } = input;
      const sourceIsSolana = source.chain === "Solana";
      const destinationIsSolana = destination.chain === "Solana";
      const usesSolana = sourceIsSolana || destinationIsSolana;
      const evmSource = sourceIsSolana ? null : source;

      if (!amount || Number(amount) <= 0) {
        throw new Error("Enter a valid USDC amount");
      }
      if (source.chain === destination.chain) {
        throw new Error("Source and destination networks must be different");
      }
      if (!connector) {
        throw new Error("Connect your EVM browser wallet");
      }
      if (usesSolana && !solanaPublicKey) {
        throw new Error("Connect your Solana browser wallet");
      }

      setError(null);
      setResult(null);
      setFinalityMs(null);
      bridgeStartedAtRef.current = null;
      stepStartedAtRef.current = {};
      setProgress(
        createBridgeProgress(destination.label).map((step) => ({
          ...step,
          state:
            step.key === "switch"
              ? !evmSource || chainId === evmSource.chainId
                ? "success"
                : "active"
              : "waiting",
        })),
      );

      try {
        if (evmSource && chainId !== evmSource.chainId) {
          const switchStartedAt = performance.now();
          stepStartedAtRef.current.switch = switchStartedAt;
          setStatus("switching");
          await switchChainAsync({ chainId: evmSource.chainId });
          updateProgress("switch", {
            state: "success",
            finalityMs: Math.max(
              0,
              Math.round(performance.now() - switchStartedAt),
            ),
          });
        }

        setStatus("confirming");
        updateProgress("approve", { state: "active" });
        stepStartedAtRef.current.approve = performance.now();
        const adapter = await adapterForConnector(connector);
        bridgeStartedAtRef.current = performance.now();
        onEventRef.current = onEvent;
        const bridgeResult = usesSolana
          ? await (async () => {
              if (!solanaProvider) {
                throw new Error("Connect a Solana wallet to continue");
              }
              const solanaAdapter = await createSolanaAdapterFromProvider({
                provider: solanaProvider,
                capabilities: { addressContext: "user-controlled" },
              });
              const bridgeSourceChain = (source.chain === "Arc" ? ArcMainnet : source.chain) as any;
              const bridgeDestinationChain = (destination.chain === "Arc" ? ArcMainnet : destination.chain) as any;
              return sourceIsSolana
                ? bridgeKit.bridge({
                    from: { adapter: solanaAdapter, chain: "Solana" },
                    to: {
                      adapter,
                      chain: bridgeDestinationChain,
                      useForwarder: true,
                    },
                    amount,
                    token: "USDC",
                  })
                : bridgeKit.bridge({
                    from: { adapter, chain: bridgeSourceChain },
                    to: { adapter: solanaAdapter, chain: "Solana" },
                    amount,
                    token: "USDC",
                  });
            })()
          : await (async () => {
              const bridgeSourceChain = (source.chain === "Arc" ? ArcMainnet : source.chain) as any;
              const bridgeDestinationChain = (destination.chain === "Arc" ? ArcMainnet : destination.chain) as any;
              return bridgeKit.bridge({
                from: { adapter, chain: bridgeSourceChain },
                to: {
                  adapter,
                  chain: bridgeDestinationChain,
                  useForwarder: true,
                },
                amount,
                token: "USDC",
              });
            })();
        const completedAt = performance.now();
        setFinalityMs(
          bridgeStartedAtRef.current === null
            ? null
            : Math.max(
                0,
                Math.round(completedAt - bridgeStartedAtRef.current),
              ),
        );

        setResult(bridgeResult);
        setStatus(bridgeResult.state === "success" ? "success" : "error");
        bridgeResult.steps.forEach((step) => {
          const key = step.name.toLowerCase().includes("approve")
            ? "approve"
            : step.name.toLowerCase().includes("burn")
              ? "burn"
              : step.name.toLowerCase().includes("attestation")
                ? "attestation"
                : step.name.toLowerCase().includes("mint")
                  ? "mint"
                  : null;
          if (key) {
            const startedAt = stepStartedAtRef.current[key];
            const stepFinalityMs =
              step.state === "noop"
                ? 0
                : (step.state === "success" || step.state === "error") &&
                    startedAt !== undefined
                  ? Math.max(0, Math.round(completedAt - startedAt))
                  : undefined;
            const progressUpdate: Partial<BridgeProgressStep> = {
              state:
                step.state === "success" || step.state === "noop"
                  ? "success"
                  : step.state === "error"
                    ? "error"
                    : "active",
              explorerUrl: step.explorerUrl,
              errorMessage: step.errorMessage,
            };
            if (stepFinalityMs !== undefined) {
              progressUpdate.finalityMs = stepFinalityMs;
            }
            updateProgress(key, progressUpdate);
          }
        });

        if (bridgeResult.state === "error") {
          throw new Error("Bridge did not complete. Review the completed steps before retrying.");
        }

        return bridgeResult;
      } catch (caught) {
        const nextError = toError(caught);
        setError(nextError);
        setStatus("error");
        setProgress((steps) => {
          const activeIndex = steps.findIndex((step) => step.state === "active");
          return steps.map((step, index) =>
            index === activeIndex
              ? { ...step, state: "error", errorMessage: nextError.message }
              : step,
          );
        });
        throw nextError;
      } finally {
        onEventRef.current = undefined;
      }
    },
    [
      bridgeKit,
      chainId,
      connector,
      solanaProvider,
      solanaPublicKey,
      switchChainAsync,
      updateProgress,
    ],
  );

  return {
    bridge,
    status,
    result,
    error,
    progress,
    finalityMs,
    evmReady: Boolean(connector),
    solanaReady: Boolean(solanaPublicKey),
    isLoading: status === "switching" || status === "confirming",
    reset: () => {
      setStatus("idle");
      setResult(null);
      setError(null);
      setFinalityMs(null);
      bridgeStartedAtRef.current = null;
      stepStartedAtRef.current = {};
      setProgress(createBridgeProgress());
    },
  };
}

export function useUnifiedBalance() {
  const { connector } = useAccount();
  const { address } = useArcLendAccount();
  const walletBalances = useReadContracts({
    contracts: walletUsdcContracts.map((contract) => ({
      chainId: contract.chainId,
      address: contract.address as Address,
      abi: erc20Abi as Abi,
      functionName: "balanceOf" as const,
      args: [address as Address],
    })),
    allowFailure: true,
    query: {
      enabled: Boolean(address),
      refetchInterval: 15_000,
    },
  });
  const [data, setData] = useState<GetBalancesResult | null>(null);
  const [status, setStatus] = useState<AppKitStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [spendResult, setSpendResult] = useState<SpendResult | null>(null);

  const refresh = useCallback(async () => {
    if (!address) {
      setData(null);
      setStatus("idle");
      return null;
    }

    setStatus("loading");
    setError(null);

    try {
      const balances = await appKit.unifiedBalance.getBalances({
        token: "USDC",
        sources: { address },
        networkType: "mainnet",
      });
      setData(balances);
      setStatus("success");
      return balances;
    } catch (caught) {
      const nextError = toError(caught);
      setError(nextError);
      setStatus("error");
      return null;
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const moveToArc = useCallback(
    async (amount: string) => {
      if (!address || !amount || Number(amount) <= 0) {
        throw new Error("Enter a valid USDC amount");
      }

      setStatus("confirming");
      setError(null);

      try {
        const adapter = await adapterForConnector(connector);
        const result = await appKit.unifiedBalance.spend({
          from: { adapter },
          to: {
            adapter,
            chain: ArcMainnet as any,
            recipientAddress: address,
            useForwarder: true,
          },
          amount,
          token: "USDC",
        });
        setSpendResult(result);
        setStatus("success");
        await refresh();
        return result;
      } catch (caught) {
        const nextError = toError(caught);
        setError(nextError);
        setStatus("error");
        throw nextError;
      }
    },
    [address, connector, refresh],
  );

  const chainBalances = data?.breakdown.flatMap((account) => account.breakdown) ?? [];
  const balanceFor = (chain: string) =>
    chainBalances
      .filter((entry) => entry.chain === chain)
      .reduce((sum, entry) => sum + Number(entry.confirmedBalance), 0);
  const walletBalanceFor = (index: number) => {
    const result = walletBalances.data?.[index];
    return result?.status === "success"
      ? Number(formatUnits(result.result as bigint, 6))
      : 0;
  };
  const walletBreakdown = {
    arc: walletBalanceFor(0),
    ethereum: walletBalanceFor(1),
    base: walletBalanceFor(2),
    polygon: walletBalanceFor(3),
    arbitrum: walletBalanceFor(4),
  };
  const gatewayTotal = Number(data?.totalConfirmedBalance ?? 0);
  const walletTotal = Object.values(walletBreakdown).reduce(
    (sum, value) => sum + value,
    0,
  );

  return {
    data,
    status,
    error,
    spendResult,
    total: gatewayTotal + walletTotal,
    gatewayTotal,
    walletTotal,
    walletBreakdown,
    breakdown: {
      arc: balanceFor("Arc"),
      ethereum: balanceFor("Ethereum"),
      base: balanceFor("Base"),
      polygon: balanceFor("Polygon"),
      arbitrum: balanceFor("Arbitrum"),
    },
    isLoading:
      status === "loading" ||
      status === "confirming" ||
      walletBalances.isPending,
    refresh,
    moveToArc,
  };
}

export function useSend() {
  const { connector } = useAccount();
  const [status, setStatus] = useState<AppKitStatus>("idle");
  const [error, setError] = useState<Error | null>(null);

  const send = useCallback(
    async (params: Omit<SendParams, "from"> & { chain: SendParams["from"]["chain"] }) => {
      setStatus("confirming");
      setError(null);

      try {
        const adapter = await adapterForConnector(connector);
        const result = await appKit.send({
          from: { adapter, chain: params.chain },
          to: params.to,
          amount: params.amount,
          token: params.token ?? "USDC",
        });
        setStatus("success");
        return result;
      } catch (caught) {
        const nextError = toError(caught);
        setError(nextError);
        setStatus("error");
        throw nextError;
      }
    },
    [connector],
  );

  return {
    send,
    status,
    error,
    isLoading: status === "confirming",
  };
}
