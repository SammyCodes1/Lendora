"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Copy, Loader2, Mail, Wallet, X } from "lucide-react";
import { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { SocialLoginProvider } from "@circle-fin/w3s-pw-web-sdk/dist/src/types";
import type {
  EmailLoginResult,
  SocialLoginResult,
} from "@circle-fin/w3s-pw-web-sdk/dist/src/types";
import { GlassButton } from "@/components/ui/GlassButton";
import {
  circleLoginErrorMessage,
  clearSocialOAuthState,
  type SocialOAuthState,
  writeSocialOAuthState,
} from "@/lib/circleSocialLogin";
import { showToast } from "@/lib/toast";
import type {
  CircleEmailWallet,
  CircleEmailWalletAuth,
} from "@/components/wallet/CircleEmailWalletProvider";
import { useCircleEmailWallet } from "@/components/wallet/CircleEmailWalletProvider";

type OtpTokens = {
  deviceToken: string;
  deviceEncryptionKey: string;
  otpToken: string;
};

type CircleWalletResponse = {
  wallets?: CircleEmailWallet[];
  challengeId?: string;
  alreadyInitialized?: boolean;
  error?: string;
  message?: string;
};

type CircleEmailWalletDialogProps = {
  open: boolean;
  onClose: () => void;
  onWalletReady: (
    wallet: CircleEmailWallet,
    auth: CircleEmailWalletAuth,
  ) => void;
};

const circleAppId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID ?? "";
const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const walletLoadRetryCount = 6;
const walletLoadRetryDelayMs = 1_500;

function apiError(data: CircleWalletResponse, fallback: string) {
  return data.error ?? data.message ?? fallback;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function CircleEmailWalletDialog({
  open,
  onClose,
  onWalletReady,
}: CircleEmailWalletDialogProps) {
  const sdkRef = useRef<W3SSdk | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [email, setEmail] = useState("");
  const [otpTokens, setOtpTokens] = useState<OtpTokens | null>(null);
  const [auth, setAuth] = useState<CircleEmailWalletAuth | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [wallets, setWallets] = useState<CircleEmailWallet[]>([]);
  const [status, setStatus] = useState("Enter your email to start.");
  const [isBusy, setIsBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const autoInitRef = useRef(false);
  const {
    pendingAuth,
    consumePendingAuth,
  } = useCircleEmailWallet();

  const loadWallets = useCallback(
    async (nextAuth: CircleEmailWalletAuth) => {
      const response = await fetch("/api/circle-wallet/wallets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userToken: nextAuth.userToken }),
      });
      const data = (await response.json()) as CircleWalletResponse;
      if (!response.ok) {
        throw new Error(apiError(data, "Could not load Circle wallets."));
      }

      const nextWallets = data.wallets ?? [];
      setWallets(nextWallets);
      if (nextWallets[0]) {
        onWalletReady(nextWallets[0], nextAuth);
        setStatus("Email wallet ready on Arc Testnet.");
      } else {
        setStatus("No Arc wallet found yet. Create or load your wallet.");
      }
      return nextWallets;
    },
    [onWalletReady],
  );

  const loadWalletsWithRetry = useCallback(
    async (nextAuth: CircleEmailWalletAuth) => {
      for (let attempt = 0; attempt < walletLoadRetryCount; attempt++) {
        const nextWallets = await loadWallets(nextAuth);
        if (nextWallets.length > 0) {
          return nextWallets;
        }
        if (attempt < walletLoadRetryCount - 1) {
          setStatus("Wallet creation confirmed. Waiting for Circle to index it…");
          await wait(walletLoadRetryDelayMs);
        }
      }
      setStatus("Wallet creation is still indexing. Click Load wallet again in a few seconds.");
      return [];
    },
    [loadWallets],
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadWalletsRef = useRef(loadWallets);
  loadWalletsRef.current = loadWallets;

  useEffect(() => {
    if (!circleAppId) {
      setStatus("NEXT_PUBLIC_CIRCLE_APP_ID is not configured.");
      return;
    }

    const onLoginComplete = (error: unknown, result: unknown) => {
      if (error) {
        const message = circleLoginErrorMessage(error, "Sign in failed.");
        setStatus(message);
        showToast("error", message);
        clearSocialOAuthState();
        return;
      }

      const loginResult = result as
        | EmailLoginResult
        | SocialLoginResult
        | undefined;
      if (!loginResult?.userToken || !loginResult.encryptionKey) {
        setStatus("Sign in did not return a Circle session.");
        showToast("error", "Sign in did not return a Circle session.");
        return;
      }

      clearSocialOAuthState();

      setAuth({
        userToken: loginResult.userToken,
        encryptionKey: loginResult.encryptionKey,
      });
      setStatus("Sign in verified. Checking for an Arc wallet…");
      void loadWalletsRef.current(loginResult).catch((caught) => {
        const message =
          caught instanceof Error
            ? caught.message
            : "Sign in verified. Load or create your Arc wallet.";
        setStatus(message);
      });
    };

    // OAuth return is completed by CircleGoogleAuthCompleter so this instance
    // can keep a dedicated SDK for OTP + wallet-creation challenges.
    const sdk = new W3SSdk(
      { appSettings: { appId: circleAppId } },
      onLoginComplete,
    );
    sdkRef.current = sdk;
    void sdk
      .getDeviceId()
      .then(setDeviceId)
      .catch(() => setStatus("Could not initialize Circle wallet."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circleAppId]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    if (!googleClientId) {
      setStatus("NEXT_PUBLIC_GOOGLE_CLIENT_ID is not configured.");
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const requestOtp = useCallback(async () => {
    if (!deviceId || !email.trim()) return;

    setIsBusy(true);
    try {
      const response = await fetch("/api/circle-wallet/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, email }),
      });
      const data = (await response.json()) as OtpTokens & CircleWalletResponse;
      if (!response.ok) {
        throw new Error(apiError(data, "Could not send email OTP."));
      }
      if (!data.deviceToken || !data.deviceEncryptionKey || !data.otpToken) {
        throw new Error("Circle did not return OTP verification tokens.");
      }

      setOtpTokens({
        deviceToken: data.deviceToken,
        deviceEncryptionKey: data.deviceEncryptionKey,
        otpToken: data.otpToken,
      });
      sdkRef.current?.updateConfigs({
        appSettings: { appId: circleAppId },
        loginConfigs: {
          deviceToken: data.deviceToken,
          deviceEncryptionKey: data.deviceEncryptionKey,
          otpToken: data.otpToken,
        },
      });
      setStatus("OTP sent. Continue to verification.");
      showToast("success", "Circle OTP sent");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not send OTP.";
      setStatus(message);
      showToast("error", message);
    } finally {
      setIsBusy(false);
    }
  }, [deviceId, email]);

  const verifyOtp = useCallback(() => {
    if (!otpTokens || !sdkRef.current) return;
    sdkRef.current.verifyOtp();
  }, [otpTokens]);

  const requestGoogleLogin = useCallback(async () => {
    if (!deviceId) {
      setStatus("Circle wallet is still initializing. Try again in a moment.");
      return;
    }
    if (!googleClientId) {
      setStatus("NEXT_PUBLIC_GOOGLE_CLIENT_ID is not configured.");
      return;
    }

    setIsBusy(true);
    try {
      const response = await fetch("/api/circle-wallet/social-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
      });
      const data = (await response.json()) as SocialOAuthState &
        CircleWalletResponse;
      if (!response.ok) {
        throw new Error(apiError(data, "Could not start Google sign in."));
      }
      if (!data.deviceToken || !data.deviceEncryptionKey) {
        throw new Error("Circle did not return social login tokens.");
      }

      writeSocialOAuthState({
        deviceToken: data.deviceToken,
        deviceEncryptionKey: data.deviceEncryptionKey,
      });

      sdkRef.current?.updateConfigs({
        appSettings: { appId: circleAppId },
        loginConfigs: {
          deviceToken: data.deviceToken,
          deviceEncryptionKey: data.deviceEncryptionKey,
          google: {
            clientId: googleClientId,
            redirectUri: window.location.origin,
            selectAccountPrompt: true,
          },
        },
      });

      setStatus("Redirecting to Google…");
      await sdkRef.current?.performLogin(SocialLoginProvider.GOOGLE);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not start Google sign in.";
      setStatus(message);
      showToast("error", message);
    } finally {
      setIsBusy(false);
    }
  }, [deviceId]);

  const initializeWallet = useCallback(async () => {
    if (!auth?.userToken) return;

    setIsBusy(true);
    try {
      const response = await fetch("/api/circle-wallet/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userToken: auth.userToken }),
      });
      const data = (await response.json()) as CircleWalletResponse;
      if (!response.ok) {
        throw new Error(apiError(data, "Could not initialize Circle wallet."));
      }

      if (data.wallets?.[0]) {
        setWallets(data.wallets);
        onWalletReady(data.wallets[0], auth);
        setStatus("Existing Arc wallet loaded.");
        return;
      }

      if (data.challengeId) {
        setChallengeId(data.challengeId);
        setStatus("Approve the Circle challenge to create your Arc wallet.");
        return;
      }

      setStatus("Circle did not return a wallet or creation challenge.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not initialize wallet.";
      setStatus(message);
      showToast("error", message);
    } finally {
      setIsBusy(false);
    }
  }, [auth, onWalletReady]);

  const executeChallenge = useCallback(() => {
    if (!auth || !challengeId || !sdkRef.current) return;

    setIsBusy(true);
    sdkRef.current.setAuthentication({
      userToken: auth.userToken,
      encryptionKey: auth.encryptionKey,
    });
    sdkRef.current.execute(challengeId, async (error) => {
      if (error) {
        const message = error.message || "Circle challenge failed.";
        setStatus(message);
        showToast("error", message);
        setIsBusy(false);
        return;
      }

      setChallengeId(null);
      try {
        const nextWallets = await loadWalletsWithRetry(auth);
        if (nextWallets.length > 0) {
          showToast("success", "Circle email wallet ready");
        }
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : "Wallet created, but not loaded.";
        setStatus(message);
      } finally {
        setIsBusy(false);
      }
    });
  }, [auth, challengeId, loadWalletsWithRetry]);

  useEffect(() => {
    if (!open || auth || !pendingAuth) return;
    const nextAuth = consumePendingAuth();
    if (!nextAuth) return;
    setAuth(nextAuth);
    setStatus("Sign in verified. Create or load your Arc wallet.");
  }, [auth, consumePendingAuth, open, pendingAuth]);

  useEffect(() => {
    if (!open || !auth || wallets.length > 0 || challengeId || autoInitRef.current) {
      return;
    }
    autoInitRef.current = true;
    void initializeWallet();
  }, [auth, challengeId, initializeWallet, open, wallets.length]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-lg border border-white/10 bg-[#090b0d] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.6)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-200/60">
              Circle wallet
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">
              Sign in
            </h2>
            <p className="mt-2 text-sm leading-6 text-white/50">
              Continue with Google, or verify your email with Circle, to create
              or load an Arc Testnet wallet.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/10 bg-white/[0.04] p-2 text-white/55 hover:text-white"
            aria-label="Close email wallet"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5">
          <GlassButton
            type="button"
            variant="primary"
            className="w-full"
            disabled={!googleClientId || !circleAppId || !deviceId || isBusy}
            title={
              !googleClientId
                ? "Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable Google sign in."
                : !deviceId
                  ? "Circle wallet is still initializing."
                  : undefined
            }
            onClick={() => void requestGoogleLogin()}
          >
            {isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
            )}
            Sign in with Google
          </GlassButton>
        </div>

        <div className="my-4 flex items-center gap-3">
          <span className="h-px flex-1 bg-white/[0.08]" />
          <span className="text-xs uppercase tracking-wide text-white/30">
            or
          </span>
          <span className="h-px flex-1 bg-white/[0.08]" />
        </div>

        <div className="rounded-md border border-white/[0.08] bg-white/[0.04] p-3">
          <p className="text-xs text-white/40">Email address</p>
          <div className="mt-2 flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/25"
            />
            <GlassButton
              type="button"
              variant="primary"
              className="px-3"
              disabled={!circleAppId || !deviceId || !email.trim() || isBusy}
              onClick={() => void requestOtp()}
            >
              {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Send
            </GlassButton>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <GlassButton
            type="button"
            variant="ghost"
            disabled={!otpTokens || isBusy}
            onClick={verifyOtp}
          >
            <CheckCircle2 className="h-4 w-4" />
            Verify OTP
          </GlassButton>
          <GlassButton
            type="button"
            variant="ghost"
            disabled={!auth || isBusy}
            onClick={() => void initializeWallet()}
          >
            <Wallet className="h-4 w-4" />
            Load wallet
          </GlassButton>
        </div>

        {challengeId ? (
          <GlassButton
            type="button"
            variant="primary"
            className="mt-3 w-full"
            disabled={!auth || isBusy}
            onClick={executeChallenge}
          >
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
            Approve wallet creation
          </GlassButton>
        ) : null}

        <div className="mt-4 rounded-md border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-white/55">
          {status}
        </div>

        {wallets.length > 0 ? (
          <div className="mt-4 grid gap-2">
            {wallets.map((wallet) => (
              <button
                key={wallet.id}
                type="button"
                className="rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-left hover:bg-white/[0.07]"
                onClick={() => {
                  if (auth) {
                    onWalletReady(wallet, auth);
                  }
                }}
              >
                <span className="block text-sm font-medium text-white">
                  {shortAddress(wallet.address)}
                </span>
                <span className="mt-1 block text-xs text-white/40">
                  {wallet.blockchain || "ARC-TESTNET"} {wallet.accountType ? `· ${wallet.accountType}` : ""}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {wallets[0] ? (
          <GlassButton
            type="button"
            variant="ghost"
            className="mt-3 w-full"
            onClick={async () => {
              await navigator.clipboard.writeText(wallets[0].address);
              showToast("success", "Email wallet address copied");
            }}
          >
            <Copy className="h-4 w-4" />
            Copy email wallet address
          </GlassButton>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
