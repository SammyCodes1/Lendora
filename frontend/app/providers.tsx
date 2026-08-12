"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { useState } from "react";
import { CircleEmailWalletProvider } from "@/components/wallet/CircleEmailWalletProvider";
import { CircleGoogleAuthCompleter } from "@/components/wallet/CircleGoogleAuthCompleter";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <CircleEmailWalletProvider>
          <CircleGoogleAuthCompleter />
          {children}
        </CircleEmailWalletProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
