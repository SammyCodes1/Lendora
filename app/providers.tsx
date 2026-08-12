"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { useState } from "react";
import { CircleEmailWalletProvider } from "@/components/wallet/CircleEmailWalletProvider";
import { CircleGoogleAuthCompleter } from "@/components/wallet/CircleGoogleAuthCompleter";
import { CircleSignInHost } from "@/components/wallet/CircleSignInHost";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <CircleEmailWalletProvider>
          <CircleGoogleAuthCompleter />
          <CircleSignInHost />
          {children}
        </CircleEmailWalletProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
