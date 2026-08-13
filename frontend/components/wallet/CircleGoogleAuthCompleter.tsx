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
let googleOAuthCompletionStarted = false;

export function CircleGoogleAuthCompleter() {
  const pathname = usePathname();
  const router = useRouter();
  const { setSession, resumeFromSocialLogin } = useCircleEmailWallet();
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    if (googleOAuthCompletionStarted) return;
    if (!circleAppId || !googleClientId) return;
    if (!restoreOAuthHash()) return;

    const savedOAuth = readSocialOAuthState();
    if (!savedOAuth) {
      clearOAuthHash();
      showToast("error", "Google sign in expired. Tap Sign in and try again.");
      return;
    }

    googleOAuthCompletionStarted = true;
    setFinishing(true);

    const goToApp = () => {
      clearOAuthHash();
      if (pathname === "/") {
        router.replace("/dashboard");
      }
    };

    const onLoginComplete = (error: unknown, result: unknown) => {
      if (error) {
        clearSocialOAuthState();
        setFinishing(false);
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
        setFinishing(false);
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
            showToast("success", "Signed in with Google");
            goToApp();
            return;
          }
        } catch {
          // First-time users still need to create a wallet in the sign-in dialog.
        }

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
  }, [pathname, resumeFromSocialLogin, router, setSession]);

  if (!finishing) return null;

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/80 px-6 text-center backdrop-blur-sm">
      <div>
        <p className="text-sm font-medium text-white">Signing you in with Google…</p>
        <p className="mt-2 text-sm text-white/50">You will be taken to the app in a moment.</p>
      </div>
    </div>
  );
}
