"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, type Address } from "viem";
import {
  useReserveData,
  useReservesList,
  useUserAccountData,
  useUserBalance,
} from "@/hooks/useLendingPool";
import { useLiveMarkets } from "@/hooks/useLiveMarkets";
import { useContacts } from "@/hooks/useContacts";
import type {
  AgentChatMessage,
  AgentContext,
  AgentResponse,
  AgentTransactionReceipt,
  ValidatedAgentAction,
} from "@/lib/agentTypes";
import { ARC_DEX_TOKENS } from "@/lib/arcDex";
import { marketDefinitions } from "@/lib/markets";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import { useTokenBalance } from "@/hooks/useTokenBalance";

const usdc = marketDefinitions.find((market) => market.symbol === "USDC")!;
const eurc = marketDefinitions.find((market) => market.symbol === "EURC")!;
const usdt = ARC_DEX_TOKENS.USDT;
const cirBtc = ARC_DEX_TOKENS.cirBTC;

const bridgeUsdc = {
  ethereum: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  base: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  polygon: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
} as const satisfies Record<string, Address>;

function rawBalance(value?: bigint, decimals = 6) {
  return value === undefined ? "0" : formatUnits(value, decimals);
}

function healthFactor(value?: bigint) {
  if (
    value === undefined ||
    value ===
      BigInt(
        "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      )
  ) {
    return "∞";
  }
  return Number(formatUnits(value, 18)).toFixed(2);
}

function safeContextEntry<T>(
  label: string,
  failed: boolean,
  build: () => T,
): T | undefined {
  if (failed) {
    console.warn(`[ArcLend agent] Omitted unavailable ${label} context.`);
    return undefined;
  }
  try {
    return build();
  } catch (error) {
    console.warn(`[ArcLend agent] Failed to build ${label} context.`, error);
    return undefined;
  }
}

function parseSaveContactCommand(message: string) {
  if (!/\b(?:save|add|remember)\b/i.test(message)) {
    return null;
  }

  const address = message.match(/\b0x[a-fA-F0-9]{40}\b/)?.[0];
  const name =
    message.match(
      /\b(?:as|name(?:\s+it)?|nickname)\s+["']?([a-zA-Z0-9][a-zA-Z0-9 _-]{0,23})["']?\s*[.!?]*$/i,
    )?.[1]?.trim() ?? null;

  if (!address) {
    return {
      type: "message" as const,
      text: "Which wallet address should I save? Provide the full 0x address.",
    };
  }
  if (!name) {
    return {
      type: "message" as const,
      text: "What nickname should I use? For example: Save 0x… as Alice.",
    };
  }

  return { type: "contact" as const, address, name };
}

export function useAgent() {
  const { address } = useArcLendAccount();
  const { contacts, addContact, removeContact } = useContacts();
  const reservesList = useReservesList();
  const liveReserveAddresses = useMemo(
    () =>
      new Set(
        reservesList.reserves.map((reserve) => reserve.toLowerCase()),
      ),
    [reservesList.reserves],
  );
  const usdcIsLive = liveReserveAddresses.has(usdc.address.toLowerCase());
  const eurcIsLive = liveReserveAddresses.has(eurc.address.toLowerCase());
  const { accountData } = useUserAccountData(address);
  const usdcReserve = useReserveData(usdc.address, usdcIsLive);
  const eurcReserve = useReserveData(eurc.address, eurcIsLive);
  const usdcWallet = useUserBalance(usdc.address, usdcIsLive);
  const eurcWallet = useUserBalance(eurc.address, eurcIsLive);
  const usdcSupply = useUserBalance(usdc.aToken, usdcIsLive);
  const eurcSupply = useUserBalance(eurc.aToken, eurcIsLive);
  const usdcDebt = useUserBalance(usdc.debtToken, usdcIsLive);
  const eurcDebt = useUserBalance(eurc.debtToken, eurcIsLive);
  const cirBtcWallet = useTokenBalance({
    address,
    token: cirBtc.address,
    chainId: 5042002,
    enabled: Boolean(address),
    refetchInterval: 8_000,
  });
  const usdtWallet = useTokenBalance({
    address,
    token: usdt.address,
    chainId: 5042002,
    enabled: Boolean(address),
    refetchInterval: 8_000,
  });
  const ethereumUsdc = useTokenBalance({
    address,
    token: bridgeUsdc.ethereum,
    chainId: 11155111,
    enabled: Boolean(address),
    refetchInterval: 8_000,
  });
  const baseUsdc = useTokenBalance({
    address,
    token: bridgeUsdc.base,
    chainId: 84532,
    enabled: Boolean(address),
    refetchInterval: 8_000,
  });
  const polygonUsdc = useTokenBalance({
    address,
    token: bridgeUsdc.polygon,
    chainId: 80002,
    enabled: Boolean(address),
    refetchInterval: 8_000,
  });
  const { markets } = useLiveMarkets(liveReserveAddresses);
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [pendingAction, setPendingAction] =
    useState<ValidatedAgentAction | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [historyResetAfterId, setHistoryResetAfterId] =
    useState<string | null>(null);

  useEffect(() => {
    const failures = [
      ["reserve list", reservesList.error],
      ["USDC reserve", usdcReserve.error],
      ["EURC reserve", eurcReserve.error],
      ["USDC wallet balance", usdcWallet.error],
      ["USDC supplied balance", usdcSupply.error],
      ["USDC debt balance", usdcDebt.error],
      ["EURC wallet balance", eurcWallet.error],
      ["EURC supplied balance", eurcSupply.error],
      ["EURC debt balance", eurcDebt.error],
      ["cirBTC wallet balance", cirBtcWallet.error],
      ["USDT wallet balance", usdtWallet.error],
    ] as const;
    failures.forEach(([label, error]) => {
      if (error) {
        console.warn(
          `[ArcLend agent] Omitted unavailable ${label} context.`,
          error,
        );
      }
    });
  }, [
    eurcDebt.error,
    eurcReserve.error,
    eurcSupply.error,
    eurcWallet.error,
    cirBtcWallet.error,
    usdtWallet.error,
    reservesList.error,
    usdcDebt.error,
    usdcReserve.error,
    usdcSupply.error,
    usdcWallet.error,
  ]);

  const context = useMemo<AgentContext>(() => {
    const usdcMarket = markets.find((market) => market.symbol === "USDC");
    const eurcMarket = markets.find((market) => market.symbol === "EURC");
    const liquidationCapacityUsd = markets.reduce(
      (sum, market) =>
        sum +
        (((market.userSupply * market.price) / 1_000_000n) *
          BigInt(market.liquidationThreshold)) /
          10_000n,
      0n,
    );

    const usdcBalance =
      usdcIsLive &&
      !usdcWallet.isPending &&
      !usdcSupply.isPending &&
      !usdcDebt.isPending &&
      usdcWallet.data &&
      usdcSupply.data &&
      usdcDebt.data
      ? safeContextEntry(
          "USDC balance",
          Boolean(
            usdcWallet.error ||
              usdcSupply.error ||
              usdcDebt.error,
          ),
          () => ({
              wallet: rawBalance(usdcWallet.data?.value),
              supplied: rawBalance(usdcSupply.data?.value),
              debt: rawBalance(usdcDebt.data?.value),
              pendingSupplyInterest: rawBalance(
                usdcMarket?.accruedSupply,
              ),
            }),
        )
      : undefined;
    const eurcBalance =
      eurcIsLive &&
      !eurcWallet.isPending &&
      !eurcSupply.isPending &&
      !eurcDebt.isPending &&
      eurcWallet.data &&
      eurcSupply.data &&
      eurcDebt.data
      ? safeContextEntry(
          "EURC balance",
          Boolean(
            eurcWallet.error ||
              eurcSupply.error ||
              eurcDebt.error,
          ),
          () => ({
              wallet: rawBalance(eurcWallet.data?.value),
              supplied: rawBalance(eurcSupply.data?.value),
              debt: rawBalance(eurcDebt.data?.value),
              pendingSupplyInterest: rawBalance(
                eurcMarket?.accruedSupply,
              ),
            }),
        )
      : undefined;
    const cirBtcBalance =
      !cirBtcWallet.isPending && cirBtcWallet.data
        ? safeContextEntry(
            "cirBTC balance",
            Boolean(cirBtcWallet.error),
            () => ({
              wallet: rawBalance(
                cirBtcWallet.data?.value,
                cirBtc.decimals,
              ),
              supplied: "0",
              debt: "0",
            }),
          )
      : undefined;
    const usdtBalance =
      !usdtWallet.isPending && usdtWallet.data
        ? safeContextEntry(
            "USDT balance",
            Boolean(usdtWallet.error),
            () => ({
              wallet: rawBalance(usdtWallet.data?.value, usdt.decimals),
              supplied: "0",
              debt: "0",
            }),
          )
        : undefined;
    const usdcReserveContext =
      usdcIsLive &&
      usdcMarket &&
      !usdcReserve.isPending &&
      usdcReserve.reserveData
        ? safeContextEntry(
            "USDC reserve",
            Boolean(usdcReserve.error),
            () => ({
              asset: "USDC" as const,
              address: usdc.address,
              decimals: 6 as const,
              supplyApy: usdcMarket.supplyApy,
              borrowApr: usdcMarket.borrowApr,
              availableLiquidity: rawBalance(
                usdcReserve.reserveData!.totalLiquidity >
                  usdcReserve.reserveData!.totalBorrowed
                  ? usdcReserve.reserveData!.totalLiquidity -
                      usdcReserve.reserveData!.totalBorrowed
                  : 0n,
              ),
              priceUsd: rawBalance(usdcMarket.price, 8),
              liquidationThresholdBps:
                usdcReserve.reserveData!.liquidationThreshold,
              active: usdcReserve.reserveData!.isActive,
              borrowingEnabled:
                usdcReserve.reserveData!.isBorrowingEnabled,
            }),
          )
        : undefined;
    const eurcReserveContext =
      eurcIsLive &&
      eurcMarket &&
      !eurcReserve.isPending &&
      eurcReserve.reserveData
        ? safeContextEntry(
            "EURC reserve",
            Boolean(eurcReserve.error),
            () => ({
              asset: "EURC" as const,
              address: eurc.address,
              decimals: 6 as const,
              supplyApy: eurcMarket.supplyApy,
              borrowApr: eurcMarket.borrowApr,
              availableLiquidity: rawBalance(
                eurcReserve.reserveData!.totalLiquidity >
                  eurcReserve.reserveData!.totalBorrowed
                  ? eurcReserve.reserveData!.totalLiquidity -
                      eurcReserve.reserveData!.totalBorrowed
                  : 0n,
              ),
              priceUsd: rawBalance(eurcMarket.price, 8),
              liquidationThresholdBps:
                eurcReserve.reserveData!.liquidationThreshold,
              active: eurcReserve.reserveData!.isActive,
              borrowingEnabled:
                eurcReserve.reserveData!.isBorrowingEnabled,
            }),
          )
        : undefined;

    return {
      walletAddress: address ?? null,
      positions: {
        totalCollateralUsd: rawBalance(
          accountData?.totalCollateralUSD,
          8,
        ),
        totalDebtUsd: rawBalance(accountData?.totalDebtUSD, 8),
        availableBorrowsUsd: rawBalance(
          accountData?.availableBorrowsUSD,
          8,
        ),
        healthFactor: healthFactor(accountData?.healthFactor),
        liquidationCapacityUsd: rawBalance(liquidationCapacityUsd, 8),
      },
      balances: {
        ...(usdcBalance ? { USDC: usdcBalance } : {}),
        ...(eurcBalance ? { EURC: eurcBalance } : {}),
        ...(usdtBalance ? { USDT: usdtBalance } : {}),
        ...(cirBtcBalance ? { cirBTC: cirBtcBalance } : {}),
      },
      contacts,
      bridgeBalances: {
        Ethereum_Sepolia: rawBalance(
          ethereumUsdc.data?.value,
          ethereumUsdc.data?.decimals,
        ),
        Base_Sepolia: rawBalance(
          baseUsdc.data?.value,
          baseUsdc.data?.decimals,
        ),
        Polygon_Amoy_Testnet: rawBalance(
          polygonUsdc.data?.value,
          polygonUsdc.data?.decimals,
        ),
      },
      reserves: {
        ...(usdcReserveContext ? { USDC: usdcReserveContext } : {}),
        ...(eurcReserveContext ? { EURC: eurcReserveContext } : {}),
      },
    };
  }, [
    accountData,
    address,
    baseUsdc.data,
    cirBtcWallet.data,
    cirBtcWallet.error,
    cirBtcWallet.isPending,
    contacts,
    ethereumUsdc.data,
    eurcDebt.data,
    eurcDebt.error,
    eurcDebt.isPending,
    eurcReserve,
    eurcSupply.data,
    eurcSupply.error,
    eurcSupply.isPending,
    eurcWallet.data,
    eurcWallet.error,
    eurcWallet.isPending,
    eurcIsLive,
    markets,
    polygonUsdc.data,
    usdcDebt.data,
    usdcDebt.error,
    usdcDebt.isPending,
    usdcReserve,
    usdcSupply.data,
    usdcSupply.error,
    usdcSupply.isPending,
    usdcWallet.data,
    usdcWallet.error,
    usdcWallet.isPending,
    usdcIsLive,
    usdtWallet.data,
    usdtWallet.error,
    usdtWallet.isPending,
  ]);

  const sendMessage = useCallback(
    async (message: string) => {
      const content = message.trim();
      if (!content || isPending) {
        return null;
      }

      const contactCommand = parseSaveContactCommand(content);
      if (contactCommand) {
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "user",
            content,
          },
        ]);

        if (contactCommand.type === "message") {
          const response: AgentResponse = {
            type: "message",
            text: contactCommand.text,
          };
          setMessages((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              role: "agent",
              content: response.text,
            },
          ]);
          return response;
        }

        try {
          addContact(contactCommand.name, contactCommand.address);
          const response: AgentResponse = {
            type: "message",
            text: `Saved ${contactCommand.name} as ${contactCommand.address}.`,
          };
          setMessages((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              role: "agent",
              content: response.text,
            },
          ]);
          return response;
        } catch (caught) {
          const response: AgentResponse = {
            type: "message",
            text:
              caught instanceof Error
                ? caught.message
                : "I couldn't save that wallet contact.",
          };
          setMessages((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              role: "agent",
              content: response.text,
            },
          ]);
          return response;
        }
      }

      const historyStart = historyResetAfterId
        ? messages.findIndex(
            (item) => item.id === historyResetAfterId,
          ) + 1
        : 0;
      const history = messages
        .slice(Math.max(historyStart, messages.length - 10))
        .map(({ role, content: historyContent }) => ({
          role,
          content: historyContent,
        }));

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "user",
          content,
        },
      ]);
      setIsPending(true);

      try {
        const response = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: content, history, context }),
        });
        const result = (await response.json()) as AgentResponse;

        if (result.type === "action") {
          setPendingAction(result.validated);
          setMessages((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              role: "agent",
              content: result.validated.action.explanation,
              action: result.validated,
            },
          ]);
        } else {
          setMessages((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              role: "agent",
              content: result.text,
            },
          ]);
        }
        return result;
      } catch {
        const fallback: AgentResponse = {
          type: "message",
          text: "The agent could not process that request. Please retry.",
        };
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "agent",
            content: fallback.text,
          },
        ]);
        return fallback;
      } finally {
        setIsPending(false);
      }
    },
    [addContact, context, historyResetAfterId, isPending, messages],
  );

  const clearPendingAction = useCallback((cancelled = false) => {
    setPendingAction(null);
    const resetId = crypto.randomUUID();
    setHistoryResetAfterId(resetId);
    if (cancelled) {
      setMessages((current) => [
        ...current,
        {
          id: resetId,
          role: "agent",
          content: "Cancelled. No transaction was submitted.",
        },
      ]);
    } else {
      setMessages((current) => [
        ...current,
        {
          id: resetId,
          role: "agent",
          content: "Transaction completed. Previous action details cleared.",
        },
      ]);
    }
  }, []);

  const completePendingAction = useCallback(
    (receipt: AgentTransactionReceipt) => {
      setPendingAction(null);
      const resetId = crypto.randomUUID();
      setHistoryResetAfterId(resetId);
      setMessages((current) => [
        ...current,
        {
          id: resetId,
          role: "agent",
          content: "Transaction confirmed onchain.",
          receipt,
        },
      ]);
    },
    [],
  );

  const blockPendingAction = useCallback((reason: string) => {
    setPendingAction(null);
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "agent",
        content: reason,
      },
    ]);
  }, []);

  return {
    messages,
    sendMessage,
    isPending,
    pendingAction,
    clearPendingAction,
    completePendingAction,
    blockPendingAction,
    contacts,
    addContact,
    removeContact,
  };
}
