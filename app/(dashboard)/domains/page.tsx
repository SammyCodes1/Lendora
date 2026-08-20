"use client";

import { Globe } from "lucide-react";
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
          description="Resolve .arclend domain names to wallet addresses, reverse-lookup addresses, and browse the Lendora registry."
        />

        <div className="mt-8">
          <DomainMinting />
        </div>
      </div>
    </PageTransition>
  );
}
