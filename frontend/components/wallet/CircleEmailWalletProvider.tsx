"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  CIRCLE_PENDING_AUTH_STORAGE_KEY,
  CIRCLE_SESSION_STORAGE_KEY,
  isCircleOAuthReturn,
} from "@/lib/circleSocialLogin";

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
  pendingAuth: CircleEmailWalletAuth | null;
  signInRequested: boolean;
  setSession: (wallet: CircleEmailWallet, auth: CircleEmailWalletAuth) => void;
  clearSession: () => void;
  resumeFromSocialLogin: (auth: CircleEmailWalletAuth) => void;
  requestSignIn: () => void;
  consumePendingAuth: () => CircleEmailWalletAuth | null;
  clearSignInRequest: () => void;
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
  const [pendingAuth, setPendingAuth] = useState<CircleEmailWalletAuth | null>(
    null,
  );
  const [signInRequested, setSignInRequested] = useState(false);

  useEffect(() => {
    try {
      const rawSession = window.sessionStorage.getItem(CIRCLE_SESSION_STORAGE_KEY);
      if (rawSession) {
        const parsed = JSON.parse(rawSession) as {
          wallet?: CircleEmailWallet;
          auth?: CircleEmailWalletAuth;
        };
        if (parsed.wallet?.id && parsed.wallet.address && parsed.auth?.userToken && parsed.auth.encryptionKey) {
          setWallet(parsed.wallet);
          setAuth(parsed.auth);
          return;
        }
      }

      const rawPending = window.sessionStorage.getItem(
        CIRCLE_PENDING_AUTH_STORAGE_KEY,
      );
      if (!rawPending) return;
      const pending = JSON.parse(rawPending) as CircleEmailWalletAuth;
      if (pending.userToken && pending.encryptionKey) {
        setPendingAuth(pending);
        if (!isCircleOAuthReturn()) {
          setSignInRequested(true);
        }
      }
    } catch {
      window.sessionStorage.removeItem(CIRCLE_SESSION_STORAGE_KEY);
      window.sessionStorage.removeItem(CIRCLE_PENDING_AUTH_STORAGE_KEY);
    }
  }, []);

  const setSession = useCallback(
    (nextWallet: CircleEmailWallet, nextAuth: CircleEmailWalletAuth) => {
      setWallet(nextWallet);
      setAuth(nextAuth);
      setPendingAuth(null);
      setSignInRequested(false);
      window.sessionStorage.setItem(
        CIRCLE_SESSION_STORAGE_KEY,
        JSON.stringify({ wallet: nextWallet, auth: nextAuth }),
      );
      window.sessionStorage.removeItem(CIRCLE_PENDING_AUTH_STORAGE_KEY);
    },
    [],
  );

  const clearSession = useCallback(() => {
    setWallet(null);
    setAuth(null);
    setPendingAuth(null);
    setSignInRequested(false);
    window.sessionStorage.removeItem(CIRCLE_SESSION_STORAGE_KEY);
    window.sessionStorage.removeItem(CIRCLE_PENDING_AUTH_STORAGE_KEY);
  }, []);

  const resumeFromSocialLogin = useCallback((nextAuth: CircleEmailWalletAuth) => {
    setPendingAuth(nextAuth);
    setSignInRequested(true);
    window.sessionStorage.setItem(
      CIRCLE_PENDING_AUTH_STORAGE_KEY,
      JSON.stringify(nextAuth),
    );
  }, []);

  const requestSignIn = useCallback(() => {
    setSignInRequested(true);
  }, []);

  const consumePendingAuth = useCallback(() => {
    const nextAuth = pendingAuth;
    setPendingAuth(null);
    window.sessionStorage.removeItem(CIRCLE_PENDING_AUTH_STORAGE_KEY);
    return nextAuth;
  }, [pendingAuth]);

  const clearSignInRequest = useCallback(() => {
    setSignInRequested(false);
  }, []);

  const value = useMemo(
    () => ({
      wallet,
      auth,
      isConnected: Boolean(wallet && auth),
      pendingAuth,
      signInRequested,
      setSession,
      clearSession,
      resumeFromSocialLogin,
      requestSignIn,
      consumePendingAuth,
      clearSignInRequest,
    }),
    [
      auth,
      clearSession,
      clearSignInRequest,
      consumePendingAuth,
      pendingAuth,
      requestSignIn,
      resumeFromSocialLogin,
      setSession,
      signInRequested,
      wallet,
    ],
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
