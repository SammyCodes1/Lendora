import { Suspense } from "react";
import type { Metadata } from "next";
import { TelegramMiniApp } from "@/app/telegram/TelegramMiniApp";

export const metadata: Metadata = {
  title: "Lendora — Telegram",
  description:
    "Sign Lendora transactions from your Telegram Mini App.",
  robots: { index: false, follow: false },
};

export default function TelegramPage() {
  return (
    <Suspense fallback={null}>
      <TelegramMiniApp />
    </Suspense>
  );
}
