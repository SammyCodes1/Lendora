"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Transaction } from "@mysten/sui/transactions";
import { signAndExecuteTransaction } from "@mysten/wallet-standard";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
  type StandardEventsFeature,
} from "@wallet-standard/features";
import { fetchSuiUsdcBalance } from "@/lib/suiCctp";

const SUI_CHAIN = "sui:mainnet" as const;
const selectedWalletStorageKey = "arclend:sui-wallet";

type CompatibleWallet = Wallet & {
  features: StandardConnectFeature &
    Partial<StandardDisconnectFeature & StandardEventsFeature> &
    Record<string, unknown>;
};

let initialized = false;
let selectedWalletName: string | null = null;
let selectedAccount: WalletAccount | null = null;
let storeVersion = 0;
let removeSelectedWalletListener: (() => void) | null = null;
const storeListeners = new Set<() => void>();

function isCompatibleWallet(wallet: Wallet): wallet is CompatibleWallet {
  return (
    wallet.chains.some((chain) => chain.startsWith("sui:")) &&
    StandardConnect in wallet.features &&
    ("sui:signAndExecuteTransaction" in wallet.features ||
      "sui:signAndExecuteTransactionBlock" in wallet.features)
  );
}

function compatibleWallets() {
  if (typeof window === "undefined") return [];
  return getWallets().get().filter(isCompatibleWallet);
}

function suiAccount(accounts: readonly WalletAccount[]) {
  return (
    accounts.find((account) => account.chains.includes(SUI_CHAIN)) ??
    accounts.find((account) =>
      account.chains.some((chain) => chain.startsWith("sui:")),
    ) ??
    null
  );
}

function emitStoreChange() {
  storeVersion += 1;
  storeListeners.forEach((listener) => listener());
}

function watchSelectedWallet(wallet: CompatibleWallet | null) {
  removeSelectedWalletListener?.();
  removeSelectedWalletListener = null;
  const events = wallet?.features[StandardEvents];
  if (!events) return;
  removeSelectedWalletListener = events.on("change", (properties) => {
    if (properties.accounts) {
      selectedAccount = suiAccount(properties.accounts);
    }
    emitStoreChange();
  });
}

function updateSelection(wallet: CompatibleWallet | null) {
  selectedWalletName = wallet?.name ?? null;
  selectedAccount = wallet ? suiAccount(wallet.accounts) : null;
  if (typeof window !== "undefined") {
    if (selectedWalletName) {
      window.localStorage.setItem(selectedWalletStorageKey, selectedWalletName);
    } else {
      window.localStorage.removeItem(selectedWalletStorageKey);
    }
  }
  watchSelectedWallet(wallet);
  emitStoreChange();
}

function initializeWalletStore() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  const registry = getWallets();
  const syncWallets = () => {
    const wallets = compatibleWallets();
    const selected = wallets.find((wallet) => wallet.name === selectedWalletName);
    if (selected) {
      selectedAccount = suiAccount(selected.accounts);
      watchSelectedWallet(selected);
    } else if (wallets.length > 0) {
      updateSelection(wallets[0]);
      return;
    }
    emitStoreChange();
  };

  selectedWalletName = window.localStorage.getItem(selectedWalletStorageKey);
  registry.on("register", syncWallets);
  registry.on("unregister", syncWallets);
  syncWallets();
}

function subscribe(listener: () => void) {
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
}

function getSnapshot() {
  return storeVersion;
}

function getServerSnapshot() {
  return 0;
}

export async function executeSuiTransaction(transaction: Transaction) {
  const wallet = compatibleWallets().find(
    (item) => item.name === selectedWalletName,
  );
  const account = wallet ? selectedAccount : null;
  if (!wallet || !account) {
    throw new Error("Connect your Sui wallet");
  }
  transaction.setSender(account.address);
  const output = await signAndExecuteTransaction(wallet, {
    transaction,
    account,
    chain: account.chains.includes(SUI_CHAIN)
      ? SUI_CHAIN
      : account.chains.find((chain) => chain.startsWith("sui:")) ?? SUI_CHAIN,
  });
  if (!output.digest) {
    throw new Error(`${wallet.name} did not return a transaction digest`);
  }
  return output.digest;
}

export function useSuiWallet() {
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    initializeWalletStore();
  }, []);

  const wallets = compatibleWallets();
  const selectedWallet =
    wallets.find((wallet) => wallet.name === selectedWalletName) ?? null;
  const account = selectedWallet ? selectedAccount : null;

  const selectWallet = useCallback((walletName: string) => {
    const wallet = compatibleWallets().find((item) => item.name === walletName);
    if (!wallet) throw new Error("That Sui wallet is no longer available");
    updateSelection(wallet);
  }, []);

  const connect = useCallback(async () => {
    const wallet =
      compatibleWallets().find((item) => item.name === selectedWalletName) ??
      compatibleWallets()[0];
    if (!wallet) throw new Error("No Sui wallet detected");
    const output = await wallet.features[StandardConnect].connect();
    const nextAccount = suiAccount(output.accounts);
    if (!nextAccount) {
      throw new Error(`${wallet.name} did not return a Sui account`);
    }
    selectedWalletName = wallet.name;
    selectedAccount = nextAccount;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(selectedWalletStorageKey, wallet.name);
    }
    watchSelectedWallet(wallet);
    emitStoreChange();
    return nextAccount.address;
  }, []);

  const disconnect = useCallback(async () => {
    const wallet = compatibleWallets().find(
      (item) => item.name === selectedWalletName,
    );
    await wallet?.features[StandardDisconnect]?.disconnect();
    selectedAccount = null;
    emitStoreChange();
  }, []);

  return {
    wallets: wallets.map((wallet) => ({
      name: wallet.name,
      icon: wallet.icon,
    })),
    selectedWalletName: selectedWallet?.name ?? null,
    selectWallet,
    address: account?.address ?? null,
    isConnected: Boolean(account),
    isAvailable: wallets.length > 0,
    connect,
    disconnect,
    execute: executeSuiTransaction,
  };
}

export function useSuiUsdcBalance(address: string | null) {
  const [balance, setBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!address) {
      setBalance(null);
      setIsLoading(false);
      return;
    }

    let active = true;
    const load = async () => {
      setIsLoading(true);
      try {
        const nextBalance = await fetchSuiUsdcBalance(address);
        if (active) setBalance(nextBalance);
      } catch {
        if (active) setBalance(null);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void load();
    const interval = window.setInterval(load, 10_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [address]);

  return { balance, isLoading };
}
