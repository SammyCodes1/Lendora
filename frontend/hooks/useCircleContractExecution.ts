"use client";

import { useCallback, useRef, useState } from "react";
import { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import type { ChallengeResult } from "@circle-fin/w3s-pw-web-sdk/dist/src/types";
import { installCircleSdkIframePatch } from "@/lib/circleW3sPatch";
import type { Address, Hex } from "viem";
import { useCircleEmailWallet } from "@/components/wallet/CircleEmailWalletProvider";

type ExecuteTransferInput = {
  destinationAddress: Address;
  amount: string;
  tokenAddress?: Address | "";
  refId?: string;
};

type ExecuteContractInput =
  | {
      contractAddress: Address;
      abiFunctionSignature: string;
      abiParameters?: unknown[];
      callData?: never;
      amount?: string;
      refId?: string;
    }
  | {
      contractAddress: Address;
      callData: Hex;
      abiFunctionSignature?: never;
      abiParameters?: never;
      amount?: string;
      refId?: string;
    };

type ExecuteContractResponse = {
  challengeId?: string;
  transactionId?: string;
  error?: string;
  message?: string;
};

const circleAppId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID ?? "";

export function useCircleContractExecution() {
  const emailWallet = useCircleEmailWallet();
  const sdkRef = useRef<W3SSdk | null>(null);
  const initializedRef = useRef(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const runChallenge = useCallback(
    async (challengeId: string) => {
      if (!emailWallet.auth) {
        throw new Error("Sign in with Google first.");
      }
      if (!circleAppId) {
        throw new Error("Circle App ID is not configured.");
      }
      installCircleSdkIframePatch();
      const activeSdk =
        sdkRef.current ??
        new W3SSdk({ appSettings: { appId: circleAppId } });
      sdkRef.current = activeSdk;
      if (!initializedRef.current) {
        await activeSdk.getDeviceId();
        initializedRef.current = true;
      }

      activeSdk.setAuthentication({
        userToken: emailWallet.auth.userToken,
        encryptionKey: emailWallet.auth.encryptionKey,
      });

      return new Promise<ChallengeResult | undefined>((resolve, reject) => {
        activeSdk.execute(challengeId, (challengeError, result) => {
          if (challengeError) {
            reject(
              new Error(challengeError.message || "Circle challenge failed."),
            );
            return;
          }
          resolve(result as ChallengeResult | undefined);
        });
      });
    },
    [emailWallet.auth],
  );

  const executeTransfer = useCallback(
    async (input: ExecuteTransferInput) => {
      if (!emailWallet.wallet || !emailWallet.auth) {
        throw new Error("Sign in with Google first.");
      }

      setIsPending(true);
      setError(null);
      try {
        const response = await fetch("/api/circle-wallet/transfer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...input,
            walletId: emailWallet.wallet.id,
            userToken: emailWallet.auth.userToken,
          }),
        });
        const data = (await response.json()) as ExecuteContractResponse;
        if (!response.ok || !data.challengeId) {
          throw new Error(
            data.error ?? data.message ?? "Could not create Circle transfer.",
          );
        }
        const challengeResult = await runChallenge(data.challengeId);
        return { ...data, challengeResult };
      } catch (caught) {
        const nextError =
          caught instanceof Error
            ? caught
            : new Error("Circle transfer failed.");
        setError(nextError);
        throw nextError;
      } finally {
        setIsPending(false);
      }
    },
    [emailWallet.auth, emailWallet.wallet, runChallenge],
  );

  const executeContract = useCallback(
    async (input: ExecuteContractInput) => {
      if (!emailWallet.wallet || !emailWallet.auth) {
        throw new Error("Sign in with email wallet first.");
      }
      if (!circleAppId) {
        throw new Error("Circle App ID is not configured.");
      }
      setIsPending(true);
      setError(null);
      try {
        const response = await fetch("/api/circle-wallet/execute-contract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...input,
            walletId: emailWallet.wallet.id,
            userToken: emailWallet.auth.userToken,
          }),
        });
        const data = (await response.json()) as ExecuteContractResponse;
        if (!response.ok || !data.challengeId) {
          throw new Error(
            data.error ?? data.message ?? "Could not create Circle transaction challenge.",
          );
        }

        const challengeResult = await runChallenge(data.challengeId);
        return { ...data, challengeResult };
      } catch (caught) {
        const nextError =
          caught instanceof Error ? caught : new Error("Circle contract execution failed.");
        setError(nextError);
        throw nextError;
      } finally {
        setIsPending(false);
      }
    },
    [emailWallet.auth, emailWallet.wallet, runChallenge],
  );

  return {
    executeContract,
    executeTransfer,
    isPending,
    error,
    isAvailable: Boolean(emailWallet.wallet && emailWallet.auth),
  };
}
