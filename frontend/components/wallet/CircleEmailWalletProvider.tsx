"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type CircleEmailWallet = {
  id: string;
  address: string;
  blockchain: string;
  accountType: string;
  state: string;
};

export type CircleEmailWalletAuth = {
  userToken: string;
  encryptionKey: string;
};

type CircleEmailWalletContextValue = {
  wallet: CircleEmailWallet | null;
  auth: CircleEmailWalletAuth | null;
  isConnected: boolean;
  setSession: (wallet: CircleEmailWallet, auth: CircleEmailWalletAuth) => void;
  clearSession: () => void;
};

const CircleEmailWalletContext =
  createContext<CircleEmailWalletContextValue | null>(null);

export function CircleEmailWalletProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [wallet, setWallet] = useState<CircleEmailWallet | null>(null);
  const [auth, setAuth] = useState<CircleEmailWalletAuth | null>(null);

  const setSession = useCallback(
    (nextWallet: CircleEmailWallet, nextAuth: CircleEmailWalletAuth) => {
      setWallet(nextWallet);
      setAuth(nextAuth);
    },
    [],
  );

  const clearSession = useCallback(() => {
    setWallet(null);
    setAuth(null);
  }, []);

  const value = useMemo(
    () => ({
      wallet,
      auth,
      isConnected: Boolean(wallet && auth),
      setSession,
      clearSession,
    }),
    [auth, clearSession, setSession, wallet],
  );

  return (
    <CircleEmailWalletContext.Provider value={value}>
      {children}
    </CircleEmailWalletContext.Provider>
  );
}

export function useCircleEmailWallet() {
  const context = useContext(CircleEmailWalletContext);
  if (!context) {
    throw new Error(
      "useCircleEmailWallet must be used inside CircleEmailWalletProvider",
    );
  }
  return context;
}
