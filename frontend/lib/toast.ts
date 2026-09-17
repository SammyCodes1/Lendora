"use client";

export type ToastType = "success" | "error";

export type ToastOptions = {
  txHash?: string;
  explorerUrl?: string;
};

export function showToast(
  type: ToastType,
  message: string,
  options?: ToastOptions,
) {
  const txHash = options?.txHash;
  const explorerUrl =
    options?.explorerUrl ??
    (txHash ? `https://explorer.arc.io/tx/${txHash}` : undefined);

  if (txHash) {
    console.info(
      `[ArcLend] On-chain transaction confirmed: ${explorerUrl ?? txHash}`,
    );
  }

  window.dispatchEvent(
    new CustomEvent("arclend:toast", {
      detail: { type, message, txHash, explorerUrl },
    }),
  );
}
