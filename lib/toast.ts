"use client";

export type ToastType = "success" | "error";

export function showToast(type: ToastType, message: string) {
  window.dispatchEvent(
    new CustomEvent("arclend:toast", {
      detail: { type, message },
    }),
  );
}
