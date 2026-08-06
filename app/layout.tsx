import type { Metadata } from "next";
import "@fontsource-variable/manrope";
import "@fontsource-variable/space-grotesk";
import "@fontsource/dm-serif-display/400.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "./globals.css";
import { Providers } from "./providers";
import { BackgroundCanvas } from "@/components/background/BackgroundCanvas";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { ClientErrorBoundary } from "@/components/layout/ClientErrorBoundary";
import { AppChrome } from "@/components/layout/AppChrome";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000",
  ),
  title: "ArcLend — DeFi Lending on Arc Network",
  description: "Supply and borrow stablecoins on Arc Network with instant settlement and predictable USDC gas fees.",
  icons: {
    icon: "/icon.svg",
  },
  openGraph: {
    title: "ArcLend — Stablecoin credit on Arc Network",
    description: "Supply, borrow, swap, and manage risk through ArcLend's isolated stablecoin markets.",
    type: "website",
    images: [{ url: "/og.jpg", width: 1200, height: 630, alt: "ArcLend — Stablecoin credit on Arc Network" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ArcLend — Stablecoin credit on Arc Network",
    description: "Supply, borrow, swap, and manage risk through ArcLend's isolated stablecoin markets.",
    images: ["/og.jpg"],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover" as const,
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className="min-h-screen bg-black text-white antialiased">
        <Providers>
          <div className="jitter-grid pointer-events-none fixed inset-0 z-0" aria-hidden="true" />
          <ClientErrorBoundary label="background canvas">
            <BackgroundCanvas />
          </ClientErrorBoundary>
          <AppChrome />
          <ToastProvider />
          <main className="relative z-10 min-h-screen pt-[calc(6.75rem+env(safe-area-inset-top,0px))] sm:pt-[calc(7rem+env(safe-area-inset-top,0px))]">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
