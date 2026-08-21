"use client";

import { useEffect, useState } from "react";
import { CircleEmailWalletDialog } from "@/components/wallet/CircleEmailWalletDialog";
import { useCircleEmailWallet } from "@/components/wallet/CircleEmailWalletProvider";
import { isCircleOAuthReturn } from "@/lib/circleSocialLogin";

export function CircleSignInHost() {
  const { signInRequested, clearSignInRequest, setSession } =
    useCircleEmailWallet();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!signInRequested) return;
    if (isCircleOAuthReturn()) {
      clearSignInRequest();
      return;
    }
    setOpen(true);
    clearSignInRequest();
  }, [clearSignInRequest, signInRequested]);

  return (
    <CircleEmailWalletDialog
      open={open}
      onClose={() => setOpen(false)}
      onWalletReady={(wallet, auth) => {
        setSession(wallet, auth);
        setOpen(false);
      }}
    />
  );
}
