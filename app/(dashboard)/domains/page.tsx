"use client";

import { Globe, ShieldCheck } from "lucide-react";
import { PageTransition } from "@/components/layout/PageTransition";
import { PageHeader } from "@/components/layout/PageHeader";
import { DomainMinting } from "@/components/features/DomainMinting";

export default function DomainsPage() {
  return (
    <PageTransition>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={<Globe />}
          title="Domain Router"
          description="Resolve .arclend domain names to wallet addresses, reverse-lookup addresses, and browse the ArcLend registry."
          stats={[
            { label: "Network", value: "Arc Testnet", tone: "positive" },
            { label: "Namespace", value: ".arclend" },
          ]}
          actions={
            <div className="flex items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-xs text-white/45">
              <ShieldCheck className="h-4 w-4 text-emerald-200" />
              Secured by ArcLend
            </div>
          }
        />

        <div className="mt-8">
          <DomainMinting />
        </div>
      </div>
    </PageTransition>
  );
}
