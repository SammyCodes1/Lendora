"use client";

import { HandCoins } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageTransition } from "@/components/layout/PageTransition";
import { PayRequestCreate } from "@/components/features/PayRequestCreate";

export default function PayRequestPage() {
  return (
    <PageTransition>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={<HandCoins />}
          title="Request to pay"
          description="Lock an amount to your .lendora name, share one link, and they confirm once. No address paste."
        />
        <PayRequestCreate />
      </div>
    </PageTransition>
  );
}
