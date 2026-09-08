"use client";

import {
  Bitcoin,
  CircleDollarSign,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function UsdcIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      className={className}
      aria-label="USDC"
    >
      <g fill="none">
        <circle cx="16" cy="16" r="16" fill="#2775C9" />
        <path
          fill="#FFF"
          d="M15.75 27.5A11.75 11.75 0 1 1 27.5 15.75 11.75 11.75 0 0 1 15.75 27.5zm-.7-16.11a2.58 2.58 0 0 0-2.45 2.47c0 1.21.74 2 2.31 2.33l1.1.26c1.07.25 1.51.61 1.51 1.22s-.77 1.21-1.77 1.21a1.9 1.9 0 0 1-1.8-.91.68.68 0 0 0-.61-.39h-.59a.35.35 0 0 0-.28.41 2.73 2.73 0 0 0 2.61 2.08v.84a.7.7 0 0 0 1.41 0v-.85a2.62 2.62 0 0 0 2.59-2.58c0-1.27-.73-2-2.46-2.37l-1-.22c-1-.25-1.47-.58-1.47-1.14 0-.56.6-1.18 1.6-1.18a1.64 1.64 0 0 1 1.59.81.8.8 0 0 0 .72.46h.47a.42.42 0 0 0 .31-.5 2.65 2.65 0 0 0-2.38-2v-.69a.7.7 0 0 0-1.41 0v.74zm-8.11 4.36a8.79 8.79 0 0 0 6 8.33h.14a.45.45 0 0 0 .45-.45v-.21a.94.94 0 0 0-.58-.87 7.36 7.36 0 0 1 0-13.65.93.93 0 0 0 .58-.86v-.23a.42.42 0 0 0-.56-.4 8.79 8.79 0 0 0-6.03 8.34zm17.62 0a8.79 8.79 0 0 0-6-8.32h-.15a.47.47 0 0 0-.47.47v.15a1 1 0 0 0 .61.9 7.36 7.36 0 0 1 0 13.64 1 1 0 0 0-.6.89v.17a.47.47 0 0 0 .62.44 8.79 8.79 0 0 0 5.99-8.34z"
        />
      </g>
    </svg>
  );
}

export function EurcIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 223.576 223.576"
      className={className}
      aria-label="EURC"
    >
      <path
        d="M111.788 0c61.74 0 111.788 50.05 111.788 111.788s-50.049 111.788-111.788 111.788S0 173.527 0 111.788 50.05 0 111.788 0Z"
        style={{ strokeWidth: 0, fillRule: "evenodd", fill: "#2775ca" }}
      />
      <path
        d="M137.33 33.073c-2.52-.805-4.581.691-4.581 3.338v6.509c0 1.774 1.337 3.794 3.003 4.404 26.757 9.8 45.904 35.519 45.904 65.629s-19.147 55.827-45.904 65.628c-1.827.67-3.003 2.459-3.003 4.405v6.508c0 2.646 2.06 4.143 4.582 3.338 33.813-10.804 58.298-42.482 58.298-79.88s-24.485-69.075-58.298-79.878ZM90.828 36.41c0-2.646-2.061-4.142-4.582-3.337-33.814 10.804-58.299 42.482-58.299 79.88s24.485 69.075 58.299 79.879c2.52.805 4.582-.692 4.582-3.338v-6.508c0-1.775-1.337-3.795-3.004-4.405-26.756-9.8-45.903-35.519-45.903-65.628s19.147-55.828 45.903-65.629c1.667-.61 3.004-2.63 3.004-4.404v-6.51Z"
        style={{ fillRule: "evenodd", strokeWidth: 0, fill: "#fff" }}
      />
      <path
        d="m140.376 134.769-6.395-2.857a2.873 2.873 0 0 0-3.75 1.343c-3.018 6.125-8.034 10.029-14.66 10.029-6 0-10.812-2.938-14.5-8.875-1.441-2.297-2.587-4.86-3.46-7.67h17.173a2.885 2.885 0 0 0 2.575-1.585l4.097-5.53c.97-1.918-.425-4.185-2.574-4.185H95.679a64.514 64.514 0 0 1-.107-3.653c-.013-1.24.022-2.453.086-3.649h19.126a2.885 2.885 0 0 0 2.575-1.584l4.097-5.53c.97-1.919-.425-4.185-2.574-4.185H97.59c3.114-10.153 9.615-16.805 17.98-16.674 6.373 0 11.32 3.49 14.495 9.204.711 1.281 2.312 1.772 3.652 1.18l6.428-2.837c1.538-.68 2.192-2.54 1.378-4.01-5.934-10.716-14.585-16.099-25.954-16.099-10.374 0-18.686 4.125-24.998 12.312-3.69 4.822-6.257 10.48-7.781 16.924h-9.338a2.885 2.885 0 0 0-2.575 1.584l-4.097 5.53c-.97 1.919.425 4.185 2.575 4.185h11.892a75.682 75.682 0 0 0-.112 3.65 63.987 63.987 0 0 0 .066 3.652h-7.749a2.885 2.885 0 0 0-2.575 1.584l-4.097 5.53c-.97 1.92.425 4.186 2.575 4.186h13.407c4.24 17.526 16.448 29.479 32.807 29.231 11.615 0 20.37-5.774 26.213-17.271.744-1.464.092-3.26-1.407-3.93Z"
        style={{ fill: "#fff", strokeWidth: 0 }}
      />
    </svg>
  );
}

export function UsdtIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      className={className}
      aria-label="USDT"
    >
      <g fill="none" fillRule="evenodd">
        <circle cx="16" cy="16" r="16" fill="#26A17B" />
        <path
          fill="#FFF"
          d="M17.922 17.383v-.002c-.11.008-.677.042-1.942.042-1.01 0-1.721-.03-1.971-.042v.003c-3.888-.171-6.79-.848-6.79-1.658 0-.809 2.902-1.486 6.79-1.66v2.644c.254.018.982.061 1.988.061 1.207 0 1.812-.05 1.925-.06v-2.643c3.88.173 6.775.85 6.775 1.658 0 .81-2.895 1.485-6.775 1.657m0-3.59v-2.366h5.414V7.819H8.595v3.608h5.414v2.365c-4.4.202-7.709 1.074-7.709 2.118 0 1.044 3.309 1.915 7.709 2.118v7.582h3.913v-7.584c4.393-.202 7.694-1.073 7.694-2.116 0-1.043-3.301-1.914-7.694-2.117"
        />
      </g>
    </svg>
  );
}

export function CirBtcIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 90 90"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="cirBTC"
    >
      <g fill="none" fillRule="evenodd">
        <circle cx="45" cy="45" r="45" fill="#1D132F" />
        <circle cx="45" cy="45" r="41" fill="#F6F6F6" />
        <path
          d="M52.732 38.77c0 4.979-7.778 4.375-10.245 4.375v-8.773c2.472 0 10.245-.78 10.245 4.397m2.03 13.618c0 5.441-9.315 4.82-12.284 4.82v-9.635c2.969 0 12.285-.863 12.285 4.837m6.135-15.581c-.497-5.221-4.973-6.947-10.638-7.491v-7.158h-4.35v7.016c-1.155 0-2.33 0-3.5.043v-7.06h-4.374v7.202h-8.87v4.686s3.232-.056 3.184 0a2.26 2.26 0 0 1 2.485 1.925v19.723a1.544 1.544 0 0 1-1.642 1.45c.056.051-3.185 0-3.185 0l-.864 5.234h8.836v7.335h4.377v-7.227h3.496v7.18h4.377v-7.237c7.393-.431 12.53-2.274 13.196-9.199.523-5.58-2.096-8.064-6.283-9.061 2.545-1.295 4.144-3.577 3.764-7.374"
          fill="#F6A73F"
        />
        <path
          d="M21.31 18.683a35.25 35.25 0 0 1 33.306-7.732l.5.143c.251.073.498.15.744.233.354.112.709.233 1.054.358l.346.125c.471.172.942.358 1.404.552l.056.026a39.808 39.808 0 0 1 10.159 6.317l1.927-2.08c-.26-.259-.527-.496-.79-.742A38.243 38.243 0 0 0 46.051 6.58h-1.512a39.93 39.93 0 0 0-8.499 1.036l-.57.138-.475.125a38.15 38.15 0 0 0-8.003 3.146 30.428 30.428 0 0 0-7.505 5.674l1.823 1.984Zm-2.44 2.421-2.118-1.851c-14.363 15.033-12.271 39.494 0 51.153l2.16-1.687C6.53 55.262 6.513 34.582 18.873 21.104h-.004Zm55.406-.914a24.27 24.27 0 0 0-1.02-1.01l-1.854 2.028c10.889 12.353 13.187 31.964.341 47.062l1.807 2.18c12.76-14.226 13.077-35.665.743-50.26h-.017Zm-5.259 50.967a60.281 60.281 0 0 1-3.746 2.589 35.19 35.19 0 0 1-15.248 6.075 31.68 31.68 0 0 1-8.495.199A35.21 35.21 0 0 1 22.2 71.873l-.865-.626-1.992 1.783c6.97 6.873 16.523 10.178 25.926 10.174h.722a38.235 38.235 0 0 0 23.803-9.117c.302-.285.609-.566.899-.863l-1.677-2.067Z"
          fill="#534F60"
          fillRule="nonzero"
        />
      </g>
    </svg>
  );
}

type TokenVisual = {
  Icon: LucideIcon;
  colorClassName: string;
};

const tokenVisuals: Record<string, TokenVisual> = {
  USDC: {
    Icon: CircleDollarSign,
    colorClassName: "border-[#2775C9]/40 bg-[#2775C9]",
  },
  EURC: {
    Icon: CircleDollarSign,
    colorClassName: "border-[#2775CA]/40 bg-[#2775CA]",
  },
  USDT: {
    Icon: CircleDollarSign,
    colorClassName: "border-[#26A17B]/40 bg-[#26A17B]",
  },
  CIRBTC: {
    Icon: Bitcoin,
    colorClassName: "border-[#F6A73F]/40 bg-[#F6A73F]",
  },
};

const fallbackVisual: TokenVisual = {
  Icon: CircleDollarSign,
  colorClassName:
    "border-white/15 bg-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]",
};

export function TokenMark({
  symbol,
  className,
  iconClassName,
  strokeWidth = 1.75,
}: {
  symbol: string;
  className?: string;
  iconClassName?: string;
  strokeWidth?: number;
}) {
  const norm = symbol.toUpperCase();

  if (norm === "USDC") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full overflow-hidden shadow-[0_2px_8px_rgba(39,117,201,0.25)]",
          className,
        )}
      >
        <UsdcIcon className="h-full w-full" />
      </span>
    );
  }

  if (norm === "EURC") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full overflow-hidden shadow-[0_2px_8px_rgba(39,117,202,0.25)]",
          className,
        )}
      >
        <EurcIcon className="h-full w-full" />
      </span>
    );
  }

  if (norm === "USDT") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full overflow-hidden shadow-[0_2px_8px_rgba(38,161,123,0.25)]",
          className,
        )}
      >
        <UsdtIcon className="h-full w-full" />
      </span>
    );
  }

  if (norm === "CIRBTC" || norm === "BTC" || norm === "WBTC") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full overflow-hidden shadow-[0_2px_8px_rgba(246,167,63,0.25)]",
          className,
        )}
      >
        <CirBtcIcon className="h-full w-full" />
      </span>
    );
  }

  const visual = tokenVisuals[norm] ?? fallbackVisual;
  const Icon = visual.Icon;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-white",
        visual.colorClassName,
        className,
      )}
    >
      <Icon
        className={cn("h-5 w-5", iconClassName)}
        strokeWidth={strokeWidth}
      />
    </span>
  );
}
