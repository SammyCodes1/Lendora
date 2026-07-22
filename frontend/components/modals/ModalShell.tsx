"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { GlassCard } from "@/components/ui/GlassCard";

type ModalShellProps = {
  open: boolean;
  title: React.ReactNode;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
};

export function ModalShell({ open, title, icon, children, onClose }: ModalShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const focusable =
      panel?.querySelector<HTMLElement>(
        'input, select, textarea, [data-autofocus="true"]',
      ) ??
      panel?.querySelector<HTMLElement>(
        'button, [href], [tabindex]:not([tabindex="-1"])',
      );

    focusable?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
      }

      if (event.key !== "Tab" || !panel) {
        return;
      }

      const elements = Array.from(
        panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      ).filter((element) => !element.hasAttribute("disabled"));

      if (elements.length === 0) {
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        last.focus();
        event.preventDefault();
      } else if (!event.shiftKey && document.activeElement === last) {
        first.focus();
        event.preventDefault();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
          initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
          animate={{ opacity: 1, backdropFilter: "blur(24px)" }}
          exit={{ opacity: 0 }}
          onMouseDown={onClose}
        >
          <GlassCard
            className="w-full max-w-lg rounded-b-none p-0 sm:rounded-b-2xl"
            glowOnHover={false}
          >
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="modal-title"
              drag="y"
              dragConstraints={{ top: 0, bottom: 120 }}
              dragElastic={0.18}
              onDragEnd={(_, info) => {
                if (info.offset.y > 90 || info.velocity.y > 650) {
                  onClose();
                }
              }}
              initial={{ opacity: 0, scale: 0.95, y: 28 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 28 }}
              transition={{ duration: 0.24, ease: "easeOut" }}
              onMouseDown={(event) => event.stopPropagation()}
              className="max-h-[92vh] overflow-y-auto rounded-t-2xl bg-black/70 p-5 backdrop-blur-3xl sm:rounded-2xl sm:p-6"
            >
              <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-white/20 sm:hidden" />
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl border border-white/10 bg-white/[0.055] p-2 text-white/75">{icon}</div>
                  <h2 id="modal-title" className="text-xl font-semibold text-white">
                    {title}
                  </h2>
                </div>
                <button
                  type="button"
                  aria-label="Close modal"
                  onClick={onClose}
                  className="rounded-md border border-white/10 bg-white/[0.045] p-2 text-white/60 transition hover:bg-white/[0.08] hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {children}
            </motion.div>
          </GlassCard>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
