"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import type { SocialLoginResult } from "@circle-fin/w3s-pw-web-sdk/dist/src/types";
import { useCircleEmailWallet } from "@/components/wallet/CircleEmailWalletProvider";
import {
  circleLoginErrorMessage,
  clearOAuthHash,
  clearSocialOAuthState,
  consumeSocialOAuthReturnPath,
  googleRedirectUri,
  readSocialOAuthState,
  restoreOAuthHash,
  OAUTH_HASH_STORAGE_KEY,
} from "@/lib/circleSocialLogin";
import { installCircleSdkIframePatch } from "@/lib/circleW3sPatch";
import { showToast } from "@/lib/toast";

const circleAppId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID ?? "";
const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

/** Maximum ms to wait for the W3SSdk callback before giving up. */
const COMPLETION_TIMEOUT_MS = 30_000;

type WalletResponse = {
  wallets?: Array<{
    id: string;
    address: string;
    blockchain: string;
    accountType: string;
    state: string;
  }>;
  error?: string;
  message?: string;
};

export function CircleGoogleAuthCompleter() {
  const router = useRouter();
  const { setSession, resumeFromSocialLogin } = useCircleEmailWallet();
  const [finishing, setFinishing] = useState(false);

  // Keep latest callbacks in refs so the one-time effect always has
  // fresh values without needing them as dependencies.
  const routerRef = useRef(router);
  routerRef.current = router;
  const setSessionRef = useRef(setSession);
  setSessionRef.current = setSession;
  const resumeRef = useRef(resumeFromSocialLogin);
  resumeRef.current = resumeFromSocialLogin;

  // Per-instance flag — resets naturally when the component unmounts/remounts.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;

    // No OAuth hash present — normal page load, nothing to do.
    if (!restoreOAuthHash()) return;

    // Hash found but env vars missing — clear it and warn.
    if (!circleAppId || !googleClientId) {
      clearOAuthHash();
      clearSocialOAuthState();
      showToast(
        "error",
        !circleAppId
          ? "NEXT_PUBLIC_CIRCLE_APP_ID is not configured."
          : "NEXT_PUBLIC_GOOGLE_CLIENT_ID is not configured.",
      );
      return;
    }

    const savedOAuth = readSocialOAuthState();
    if (!savedOAuth) {
      clearOAuthHash();
      showToast("error", "Google sign in expired. Please try again.");
      return;
    }

    startedRef.current = true;
    setFinishing(true);

    // Hash stays on the URL for Circle's SDK. Drop the session copy so a
    // later wallet-create dialog is not treated as an in-flight OAuth return.
    try {
      window.sessionStorage.removeItem(OAUTH_HASH_STORAGE_KEY);
    } catch {
      /* ignore */
    }

    const dismiss = () => {
      startedRef.current = false;
      setFinishing(false);
    };

    const goToApp = () => {
      clearOAuthHash();
      const returnPath = consumeSocialOAuthReturnPath();
      const currentPath = `${window.location.pathname}${window.location.search}`;
      if (currentPath !== returnPath) {
        routerRef.current.replace(returnPath);
      }
    };

    // If W3SSdk never calls back, dismiss after 30 s.
    const timeoutId = window.setTimeout(() => {
      dismiss();
      clearSocialOAuthState();
      clearOAuthHash();
      showToast("error", "Google sign in timed out. Please try again.");
    }, COMPLETION_TIMEOUT_MS);

    const onLoginComplete = (error: unknown, result: unknown) => {
      window.clearTimeout(timeoutId);

      if (error) {
        clearSocialOAuthState();
        clearOAuthHash();
        dismiss();
        goToApp();
        showToast("error", circleLoginErrorMessage(error, "Google sign in failed."));
        return;
      }

      const loginResult = result as SocialLoginResult | undefined;
      if (!loginResult?.userToken || !loginResult.encryptionKey) {
        clearSocialOAuthState();
        clearOAuthHash();
        dismiss();
        goToApp();
        showToast("error", "Sign in did not return a Circle session.");
        return;
      }

      clearSocialOAuthState();
      const nextAuth = {
        userToken: loginResult.userToken,
        encryptionKey: loginResult.encryptionKey,
      };

      void (async () => {
        try {
          const response = await fetch("/api/circle-wallet/wallets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userToken: nextAuth.userToken }),
          });
          const data = (await response.json()) as WalletResponse;
          const wallet = data.wallets?.find((w) => w.id && w.address);
          if (response.ok && wallet) {
            setSessionRef.current(wallet, nextAuth);
            dismiss();
            showToast("success", "Signed in with Google");
            goToApp();
            return;
          }
        } catch {
          // First-time user — no wallet yet, fall through.
        }

        // Dismiss overlay, navigate, then open wallet dialog.
        dismiss();
        goToApp();
        window.setTimeout(() => resumeRef.current(nextAuth), 0);
      })();
    };

    // Do not call getDeviceId() here — it races the SDK's own iframe.
    installCircleSdkIframePatch();
    new W3SSdk(
      {
        appSettings: { appId: circleAppId },
        loginConfigs: {
          deviceToken: savedOAuth.deviceToken,
          deviceEncryptionKey: savedOAuth.deviceEncryptionKey,
          google: {
            clientId: googleClientId,
            redirectUri: googleRedirectUri(),
            selectAccountPrompt: true,
          },
        },
      },
      onLoginComplete,
    );

    return () => { window.clearTimeout(timeoutId); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // runs once on mount only

  if (!finishing) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 px-6 text-center backdrop-blur-sm">
      <div>
        <p className="text-sm font-medium text-white">Signing you in with Google…</p>
        <p className="mt-2 text-sm text-white/50">You will be taken to the app in a moment.</p>
        <button
          type="button"
          onClick={() => { startedRef.current = false; setFinishing(false); }}
          className="mt-5 text-xs text-white/30 underline underline-offset-2 hover:text-white/60"
        >
          Taking too long? Dismiss
        </button>
      </div>
    </div>
  );
}
