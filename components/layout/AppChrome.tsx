"use client";

import { usePathname } from "next/navigation";
import { AgentChat } from "@/components/agent/AgentChat";
import { ClientErrorBoundary } from "@/components/layout/ClientErrorBoundary";
import { Navbar } from "@/components/layout/Navbar";
import { WrongNetworkPrompt } from "@/components/wallet/WrongNetworkPrompt";

export function AppChrome() {
  const pathname = usePathname();

  if (pathname === "/") return null;

  return (
    <>
      <ClientErrorBoundary label="navigation">
        <Navbar />
      </ClientErrorBoundary>
      <ClientErrorBoundary label="network prompt">
        <WrongNetworkPrompt />
      </ClientErrorBoundary>
      <ClientErrorBoundary label="agent assistant">
        <AgentChat />
      </ClientErrorBoundary>
    </>
  );
}
