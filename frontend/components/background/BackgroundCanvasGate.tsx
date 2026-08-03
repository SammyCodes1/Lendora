"use client";

import { usePathname } from "next/navigation";
import { BackgroundCanvas } from "@/components/background/BackgroundCanvas";

// The Telegram Mini App renders inside a Telegram WebView — skip the heavy
// WebGL scene there so the sign flow stays lean and performant on mobile.
export function BackgroundCanvasGate() {
  const pathname = usePathname();
  if (pathname.startsWith("/telegram")) return null;
  return <BackgroundCanvas />;
}
