"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, X, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Toast = {
  id: number;
  type: "success" | "error";
  message: string;
};

declare global {
  interface WindowEventMap {
    "arclend:toast": CustomEvent<Omit<Toast, "id">>;
  }
}

export function ToastProvider() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    function handleToast(event: WindowEventMap["arclend:toast"]) {
      const id = Date.now();
      setToasts((current) => [...current, { id, ...event.detail }]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, 4000);
    }

    window.addEventListener("arclend:toast", handleToast);
    return () => window.removeEventListener("arclend:toast", handleToast);
  }, []);

  const dismissToast = (id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  };

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-4 top-[calc(6.25rem+env(safe-area-inset-top,0px))] z-[9999] flex flex-col items-center gap-2.5 sm:inset-x-auto sm:right-6 sm:top-[calc(6.5rem+env(safe-area-inset-top,0px))] sm:w-[380px] sm:items-stretch"
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => {
          const isSuccess = toast.type === "success";
          const Icon = isSuccess ? CheckCircle2 : XCircle;
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: -16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.96 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="pointer-events-auto relative w-full max-w-[380px] overflow-hidden rounded-2xl border border-white/20 bg-[#090d11]/95 text-white shadow-[0_16px_50px_rgba(0,0,0,0.85),0_0_30px_rgba(255,255,255,0.06)] backdrop-blur-2xl"
            >
              <div className="flex items-start gap-3 px-4 py-3.5">
                <div
                  className={cn(
                    "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                    isSuccess
                      ? "border-emerald-400/30 bg-emerald-400/15 text-emerald-300"
                      : "border-red-400/30 bg-red-400/15 text-red-300",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="break-words text-xs font-medium leading-relaxed sm:text-sm text-white/95">
                    {toast.message}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => dismissToast(toast.id)}
                  aria-label="Dismiss notification"
                  className="mt-0.5 -mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-white/40 transition hover:bg-white/10 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <motion.div
                className={isSuccess ? "h-0.5 bg-emerald-400" : "h-0.5 bg-red-400"}
                initial={{ width: "100%" }}
                animate={{ width: "0%" }}
                transition={{ duration: 4, ease: "linear" }}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
