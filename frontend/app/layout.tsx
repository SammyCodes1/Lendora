import type { Metadata } from "next";
import "@fontsource-variable/manrope";
import "@fontsource-variable/space-grotesk";
import "@fontsource/dm-serif-display/400.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "./globals.css";
import { Providers } from "./providers";
import { BackgroundCanvasGate } from "@/components/background/BackgroundCanvasGate";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { ClientErrorBoundary } from "@/components/layout/ClientErrorBoundary";
import { AppChrome } from "@/components/layout/AppChrome";

const siteUrl = new URL("https://lendora-alpha.vercel.app");

export const metadata: Metadata = {
  metadataBase: siteUrl,
  applicationName: "Lendora",
  title: "Lendora — DeFi Lending on Arc Network",
  description: "Supply and borrow stablecoins on Arc Network with instant settlement and predictable USDC gas fees.",
  icons: {
    icon: "/icon.svg",
  },
  appleWebApp: {
    title: "Lendora",
  },
  openGraph: {
    siteName: "Lendora",
    url: siteUrl,
    title: "Lendora — Stablecoin credit on Arc Network",
    description: "Supply, borrow, swap, and manage risk through Lendora's isolated stablecoin markets.",
    type: "website",
    images: [
      {
        url: "/og.jpg?v=lendora",
        width: 1200,
        height: 630,
        alt: "Lendora — Stablecoin credit on Arc Network",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Lendora — Stablecoin credit on Arc Network",
    description: "Supply, borrow, swap, and manage risk through Lendora's isolated stablecoin markets.",
    images: ["/og.jpg?v=lendora"],
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
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              '(function(){try{var h=location.hash||"";if(h.indexOf("id_token=")>0||h.indexOf("access_token=")>0){sessionStorage.setItem("arclend:oauth-hash",h);}}catch(e){}})();',
          }}
        />
      </head>
      <body className="min-h-screen bg-black text-white antialiased">
        <Providers>
          <div className="jitter-grid pointer-events-none fixed inset-0 z-0" aria-hidden="true" />
          <ClientErrorBoundary label="background canvas">
            <BackgroundCanvasGate />
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
