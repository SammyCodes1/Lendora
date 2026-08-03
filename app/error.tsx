"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("[ArcLend] Route rendering failed.", error);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl items-center px-4">
      <div className="w-full rounded-lg border border-red-300/15 bg-[#0d1012]/95 p-6 text-center">
        <AlertTriangle className="mx-auto h-7 w-7 text-red-200" />
        <h1 className="mt-4 text-xl font-semibold text-white">
          This page could not finish loading
        </h1>
        <p className="mt-2 text-sm leading-6 text-white/50">
          Your wallet and funds are unaffected. Retry the page without
          reloading the entire application.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-emerald-200/70 bg-emerald-200 px-4 py-2 text-sm font-semibold text-[#07100c]"
        >
          <RotateCcw className="h-4 w-4" />
          Retry page
        </button>
      </div>
    </div>
  );
}

