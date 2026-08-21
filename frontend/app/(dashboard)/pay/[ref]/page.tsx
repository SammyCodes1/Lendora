import type { Metadata } from "next";
import { HandCoins } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageTransition } from "@/components/layout/PageTransition";
import { PayRequestPay } from "@/components/features/PayRequestPay";
import {
  displayPayDomain,
  isStoredPayRequestId,
  parsePayAmount,
} from "@/lib/payRequest";
import { getPublicPayRequest } from "@/lib/server/payRequests";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PageProps = {
  params: Promise<{ ref: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { ref } = await params;
  const query = await searchParams;
  const decoded = decodeURIComponent(ref).trim();
  if (isStoredPayRequestId(decoded)) {
    const request = await getPublicPayRequest(decoded);
    if (request) {
      const payee = request.recipientDomain ?? "Lendora";
      const title = `Pay ${request.amount} ${request.asset} to ${payee}`;
      return {
        title,
        description: request.memo
          ? `${request.memo} — confirm once on Lendora.`
          : `Confirm once. Pays ${payee} on Arc Testnet.`,
        openGraph: {
          title,
          siteName: "Lendora",
          description: "Request to pay on Lendora.",
        },
      };
    }
  }
  const domain = displayPayDomain(decoded);
  const amount = parsePayAmount(first(query.a) ?? "");
  const asset = (first(query.t) ?? "USDC").toUpperCase();
  const payee = domain || "a Lendora wallet";
  const title = amount
    ? `Pay ${amount} ${asset} to ${payee}`
    : `Pay ${payee} on Lendora`;
  return {
    title,
    description: `Confirm once. Pays ${payee} on Arc Testnet with USDC gas.`,
    openGraph: { title, siteName: "Lendora" },
  };
}

export default async function PayRefPage({ params, searchParams }: PageProps) {
  const { ref } = await params;
  const query = await searchParams;
  return (
    <PageTransition>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={<HandCoins />}
          title="Pay this request"
          description="Review the name, amount, and memo, then confirm a single transfer. The address is resolved for you."
        />
        <PayRequestPay
          refValue={ref}
          amount={first(query.a)}
          asset={first(query.t)}
          memo={first(query.m)}
          to={first(query.to)}
          exp={first(query.exp)}
        />
      </div>
    </PageTransition>
  );
}
