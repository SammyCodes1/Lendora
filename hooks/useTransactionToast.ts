"use client";

import { useEffect, useRef } from "react";
import { showToast } from "@/lib/toast";

type TransactionToastOptions = {
  isSuccess: boolean;
  error?: (Error & { shortMessage?: string }) | null;
  successMessage: string;
};

export function useTransactionToast({ isSuccess, error, successMessage }: TransactionToastOptions) {
  const successShown = useRef(false);
  const lastError = useRef<Error | null>(null);

  useEffect(() => {
    if (!isSuccess) {
      successShown.current = false;
      return;
    }

    if (!successShown.current) {
      showToast("success", successMessage);
      successShown.current = true;
    }
  }, [isSuccess, successMessage]);

  useEffect(() => {
    if (!error || lastError.current === error) {
      return;
    }

    showToast("error", error.shortMessage || error.message || "Transaction failed");
    lastError.current = error;
  }, [error]);
}
