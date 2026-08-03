"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { useState } from "react";
import { CircleEmailWalletProvider } from "@/components/wallet/CircleEmailWalletProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <CircleEmailWalletProvider>{children}</CircleEmailWalletProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
