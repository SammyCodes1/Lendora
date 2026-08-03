"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { CreateSolanaAdapterFromProviderParams } from "@circle-fin/adapter-solana";
import {
  SolanaSignMessage,
  SolanaSignTransaction,
  type SolanaSignMessageFeature,
  type SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount, WalletWithFeatures } from "@wallet-standard/base";
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
  type StandardEventsFeature,
} from "@wallet-standard/features";

export type SolanaWalletProvider =
  CreateSolanaAdapterFromProviderParams["provider"];

type CompatibleWallet = WalletWithFeatures<
  StandardConnectFeature &
    SolanaSignTransactionFeature &
    Partial<
      StandardDisconnectFeature &
        StandardEventsFeature &
        SolanaSignMessageFeature
    >
>;

const SOLANA_CHAIN = "solana:devnet" as const;
const selectedWalletStorageKey = "arclend:solana-wallet";
export const SOLANA_DEVNET_USDC_MINT =
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

let initialized = false;
let selectedWalletName: string | null = null;
let selectedAccount: WalletAccount | null = null;
let storeVersion = 0;
let removeSelectedWalletListener: (() => void) | null = null;
const storeListeners = new Set<() => void>();

function isCompatibleWallet(wallet: Wallet): wallet is CompatibleWallet {
  return (
    wallet.chains.some((chain) => chain.startsWith("solana:")) &&
    StandardConnect in wallet.features &&
    SolanaSignTransaction in wallet.features
  );
}

function compatibleWallets() {
  if (typeof window === "undefined") return [];
  return getWallets().get().filter(isCompatibleWallet);
}

function solanaAccount(accounts: readonly WalletAccount[]) {
  return (
    accounts.find((account) => account.chains.includes(SOLANA_CHAIN)) ??
    accounts.find((account) =>
      account.chains.some((chain) => chain.startsWith("solana:")),
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
      selectedAccount = solanaAccount(properties.accounts);
    }
    emitStoreChange();
  });
}

function updateSelection(wallet: CompatibleWallet | null) {
  selectedWalletName = wallet?.name ?? null;
  selectedAccount = wallet ? solanaAccount(wallet.accounts) : null;
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
      selectedAccount = solanaAccount(selected.accounts);
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
  return () => storeListeners.delete(listener);
}

function getSnapshot() {
  return storeVersion;
}

function getServerSnapshot() {
  return 0;
}

function serializeTransaction(transaction: unknown) {
  if (transaction instanceof VersionedTransaction) {
    return transaction.serialize();
  }
  if (transaction instanceof Transaction) {
    return transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
  }
  throw new Error("The selected wallet received an unsupported transaction type");
}

function deserializeTransaction(bytes: Uint8Array, original: unknown) {
  return original instanceof VersionedTransaction
    ? VersionedTransaction.deserialize(bytes)
    : Transaction.from(bytes);
}

function createStandardProvider(
  wallet: CompatibleWallet,
  initialAccount: WalletAccount,
): SolanaWalletProvider {
  const currentAccount = () =>
    wallet.accounts.find((account) => account.address === initialAccount.address) ??
    selectedAccount ??
    initialAccount;
  const publicKey = { toString: () => currentAccount().address };

  return {
    isConnected: true,
    publicKey,
    connect: async () => {
      const output = await wallet.features[StandardConnect].connect();
      const account = solanaAccount(output.accounts);
      if (!account) throw new Error(`${wallet.name} did not return a Solana account`);
      selectedAccount = account;
      emitStoreChange();
      return { publicKey: { toString: () => account.address } };
    },
    disconnect: async () => {
      await wallet.features[StandardDisconnect]?.disconnect();
      selectedAccount = null;
      emitStoreChange();
    },
    signTransaction: async (transaction) => {
      const feature = wallet.features[SolanaSignTransaction];
      const [output] = await feature.signTransaction({
        account: currentAccount(),
        transaction: serializeTransaction(transaction),
        chain: SOLANA_CHAIN,
      });
      if (!output) throw new Error(`${wallet.name} did not return a signed transaction`);
      return deserializeTransaction(output.signedTransaction, transaction);
    },
    signAllTransactions: async (transactions) => {
      const feature = wallet.features[SolanaSignTransaction];
      const outputs = await feature.signTransaction(
        ...transactions.map((transaction) => ({
          account: currentAccount(),
          transaction: serializeTransaction(transaction),
          chain: SOLANA_CHAIN,
        })),
      );
      return outputs.map((output, index) =>
        deserializeTransaction(output.signedTransaction, transactions[index]),
      );
    },
    signMessage: wallet.features[SolanaSignMessage]
      ? async (message) => {
          const [output] = await wallet.features[SolanaSignMessage]!.signMessage({
            account: currentAccount(),
            message,
          });
          if (!output) throw new Error(`${wallet.name} did not return a signature`);
          return { signature: output.signature };
        }
      : undefined,
  };
}

export function useSolanaWallet() {
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    initializeWalletStore();
  }, []);

  const wallets = compatibleWallets();
  const selectedWallet =
    wallets.find((wallet) => wallet.name === selectedWalletName) ?? null;
  const account = selectedWallet ? selectedAccount : null;
  const provider =
    selectedWallet && account
      ? createStandardProvider(selectedWallet, account)
      : null;

  const selectWallet = useCallback((walletName: string) => {
    const wallet = compatibleWallets().find((item) => item.name === walletName);
    if (!wallet) throw new Error("That Solana wallet is no longer available");
    updateSelection(wallet);
  }, []);

  const connect = useCallback(async () => {
    const wallet =
      compatibleWallets().find((item) => item.name === selectedWalletName) ??
      compatibleWallets()[0];
    if (!wallet) {
      throw new Error("Install a Wallet Standard compatible Solana wallet");
    }
    if (wallet.name !== selectedWalletName) updateSelection(wallet);
    const output = await wallet.features[StandardConnect].connect();
    const nextAccount = solanaAccount(output.accounts);
    if (!nextAccount) {
      throw new Error(`${wallet.name} did not return a Solana account`);
    }
    selectedAccount = nextAccount;
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
    selectedWalletName,
    selectWallet,
    publicKey: account?.address ?? null,
    provider,
    isConnected: Boolean(account),
    connect,
    disconnect,
    isAvailable: wallets.length > 0,
  };
}

type SolanaTokenAccountResponse = {
  result?: {
    value?: Array<{
      account?: {
        data?: {
          parsed?: {
            info?: {
              tokenAmount?: { uiAmountString?: string };
            };
          };
        };
      };
    }>;
  };
};

export function useSolanaUsdcBalance(publicKey: string | null) {
  const [balance, setBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!publicKey) {
      setBalance(null);
      setIsLoading(false);
      return;
    }

    let active = true;
    const load = async () => {
      setIsLoading(true);
      try {
        const response = await fetch("https://api.devnet.solana.com", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "arclend-solana-usdc-balance",
            method: "getTokenAccountsByOwner",
            params: [
              publicKey,
              { mint: SOLANA_DEVNET_USDC_MINT },
              { encoding: "jsonParsed", commitment: "confirmed" },
            ],
          }),
        });
        if (!response.ok) {
          throw new Error(`Solana RPC returned ${response.status}`);
        }
        const payload = (await response.json()) as SolanaTokenAccountResponse;
        const nextBalance = (payload.result?.value ?? []).reduce(
          (total, entry) =>
            total +
            Number(
              entry.account?.data?.parsed?.info?.tokenAmount?.uiAmountString ??
                "0",
            ),
          0,
        );
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
  }, [publicKey]);

  return { balance, isLoading };
}
