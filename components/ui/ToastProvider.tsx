"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

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

  return (
    <div className="pointer-events-none fixed right-4 top-24 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-3">
      <AnimatePresence>
        {toasts.map((toast) => {
          const Icon = toast.type === "success" ? CheckCircle2 : XCircle;
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 24, scale: 0.98 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.98 }}
              className="overflow-hidden rounded-2xl border border-white/[0.08] bg-black/75 text-sm text-white shadow-[0_0_40px_rgba(255,255,255,0.05)] backdrop-blur-xl"
            >
              <div className="flex items-center gap-3 px-4 py-3">
                <Icon className={toast.type === "success" ? "h-4 w-4 text-white" : "h-4 w-4 text-red-300"} />
                <span>{toast.message}</span>
              </div>
              <motion.div
                className={toast.type === "success" ? "h-px bg-white/70" : "h-px bg-red-300/70"}
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
