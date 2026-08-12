"use client";

import { useEffect, useState } from "react";
import { CircleEmailWalletDialog } from "@/components/wallet/CircleEmailWalletDialog";
import { useCircleEmailWallet } from "@/components/wallet/CircleEmailWalletProvider";

export function CircleSignInHost() {
  const { signInRequested, clearSignInRequest, setSession } =
    useCircleEmailWallet();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!signInRequested) return;
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
