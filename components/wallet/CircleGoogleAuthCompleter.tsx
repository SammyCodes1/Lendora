"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import type { SocialLoginResult } from "@circle-fin/w3s-pw-web-sdk/dist/src/types";
import { useCircleEmailWallet } from "@/components/wallet/CircleEmailWalletProvider";
import {
  circleLoginErrorMessage,
  clearOAuthHash,
  clearSocialOAuthState,
  googleRedirectUri,
  readSocialOAuthState,
  restoreOAuthHash,
} from "@/lib/circleSocialLogin";
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

// Survives React Strict Mode remounts so the OAuth hash is only consumed once.
// Reset to false whenever completion finishes (success or error) so that a
// subsequent sign-in attempt in the same tab can proceed.
let googleOAuthCompletionStarted = false;

export function CircleGoogleAuthCompleter() {
  const pathname = usePathname();
  const router = useRouter();
  const { setSession, resumeFromSocialLogin } = useCircleEmailWallet();
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    if (googleOAuthCompletionStarted) return;

    // If the Google Client ID or Circle App ID is missing, clear the stale
    // OAuth hash so the loading overlay never appears, and warn the user.
    if (!circleAppId || !googleClientId) {
      if (restoreOAuthHash()) {
        clearOAuthHash();
        clearSocialOAuthState();
        if (!circleAppId) {
          showToast("error", "NEXT_PUBLIC_CIRCLE_APP_ID is not configured.");
        } else {
          showToast("error", "NEXT_PUBLIC_GOOGLE_CLIENT_ID is not configured.");
        }
      }
      return;
    }

    if (!restoreOAuthHash()) return;

    const savedOAuth = readSocialOAuthState();
    if (!savedOAuth) {
      clearOAuthHash();
      showToast("error", "Google sign in expired. Tap Sign in and try again.");
      return;
    }

    googleOAuthCompletionStarted = true;
    setFinishing(true);

    /** Resets the completion gate and hides the overlay. */
    const finish = (wasError: boolean) => {
      googleOAuthCompletionStarted = false;
      setFinishing(false);
      if (wasError) {
        clearOAuthHash();
      }
    };

    const goToApp = () => {
      clearOAuthHash();
      if (pathname === "/") {
        router.replace("/dashboard");
      }
    };

    // Safety net: if the SDK callback never fires (e.g. network timeout, SDK
    // bug), dismiss the overlay so the user isn't permanently blocked.
    const timeoutId = window.setTimeout(() => {
      finish(true);
      clearSocialOAuthState();
      showToast("error", "Google sign in timed out. Please try again.");
    }, COMPLETION_TIMEOUT_MS);

    const onLoginComplete = (error: unknown, result: unknown) => {
      window.clearTimeout(timeoutId);

      if (error) {
        clearSocialOAuthState();
        finish(true);
        goToApp();
        showToast(
          "error",
          circleLoginErrorMessage(error, "Google sign in failed."),
        );
        return;
      }

      const loginResult = result as SocialLoginResult | undefined;
      if (!loginResult?.userToken || !loginResult.encryptionKey) {
        clearSocialOAuthState();
        finish(true);
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
          const wallet = data.wallets?.find((item) => item.id && item.address);
          if (response.ok && wallet) {
            setSession(wallet, nextAuth);
            finish(false);
            showToast("success", "Signed in with Google");
            goToApp();
            return;
          }
        } catch {
          // First-time users still need to create a wallet in the sign-in dialog.
        }

        // No wallet yet — open the dialog so the user can create one.
        finish(false);
        resumeFromSocialLogin(nextAuth);
        goToApp();
      })();
    };

    // Do not call getDeviceId() here. The constructor starts token verification
    // on an iframe with id `sdkIframe`; getDeviceId() would race that iframe.
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

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [pathname, resumeFromSocialLogin, router, setSession]);

  if (!finishing) return null;

  return (
    // z-[200] keeps this below the Circle SDK wallet iframe (which the SDK
    // injects at a very high z-index) while still covering the app UI.
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 px-6 text-center backdrop-blur-sm">
      <div className="relative">
        <p className="text-sm font-medium text-white">Signing you in with Google…</p>
        <p className="mt-2 text-sm text-white/50">You will be taken to the app in a moment.</p>
        {/* Safety dismiss — lets the user unblock themselves if the callback stalls */}
        <button
          type="button"
          onClick={() => {
            googleOAuthCompletionStarted = false;
            setFinishing(false);
          }}
          className="mt-5 text-xs text-white/30 underline underline-offset-2 hover:text-white/60"
        >
          Taking too long? Dismiss
        </button>
      </div>
    </div>
  );
}
