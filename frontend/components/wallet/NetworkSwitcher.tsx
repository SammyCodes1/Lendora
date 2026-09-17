"use client";

import { Check, ChevronDown, Loader2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useChainId, useSwitchChain } from "wagmi";
import { useDismissibleDropdown } from "@/hooks/useDismissibleDropdown";
import { useCloseOnResume } from "@/hooks/useCloseOnResume";
import { cn } from "@/lib/utils";

const networkNames: Record<number, string> = {
  5042: "Arc Mainnet",
  1: "Ethereum",
  42161: "Arbitrum One",
  8453: "Base",
  137: "Polygon",
  5042002: "Arc Testnet",
};

// Chains allowed in the switcher dropdown, in precise order:
// Arc Mainnet, Ethereum, Arbitrum One, Base, Polygon, with Arc Testnet as the ONLY testnet at the end.
const DROPDOWN_CHAIN_ORDER = [5042, 1, 42161, 8453, 137, 5042002];

function NetworkLogo({
  chainId,
  className = "h-4 w-4",
}: {
  chainId: number;
  className?: string;
}) {
  if (chainId === 5042) {
    return (
      <span className={cn("inline-flex items-center justify-center rounded-full bg-[#1a1d24] p-0.5 shrink-0", className)}>
        <svg className="h-full w-full" viewBox="0 0 31 32" fill="none" aria-label="Arc Mainnet">
          <path
            d="M0 32C.26 24.17 1.59 16.85 3.82 11.17 6.64 3.97 10.73 0 15.32 0s8.68 3.97 11.5 11.17c1.47 3.75 2.55 8.2 3.19 13.04.06.43.11.87.16 1.31.02.03.03.05.02.07 0 0 .38 2.34.46 6.41h-.04c-.56-.46-7.14-5.61-18.04-4.12.16-1.84.39-3.63.68-5.34l.05-.26c4.28-.13 8.02.37 10.89 1.02l-.03-.21c-.59-3.66-1.46-7.01-2.58-9.88-1.84-4.68-4.23-7.59-6.25-7.59s-4.41 2.91-6.25 7.59c-.44 1.13-.85 2.34-1.21 3.62-.51 1.79-.94 3.7-1.28 5.71-.51 2.97-.82 6.16-.94 9.46H0Z"
            fill="white"
          />
        </svg>
      </span>
    );
  }

  if (chainId === 5042002) {
    return (
      <span className={cn("inline-flex items-center justify-center rounded-full bg-[#1a1d24] p-0.5 shrink-0 ring-1 ring-amber-500/40", className)}>
        <svg className="h-full w-full" viewBox="0 0 31 32" fill="none" aria-label="Arc Testnet">
          <path
            d="M0 32C.26 24.17 1.59 16.85 3.82 11.17 6.64 3.97 10.73 0 15.32 0s8.68 3.97 11.5 11.17c1.47 3.75 2.55 8.2 3.19 13.04.06.43.11.87.16 1.31.02.03.03.05.02.07 0 0 .38 2.34.46 6.41h-.04c-.56-.46-7.14-5.61-18.04-4.12.16-1.84.39-3.63.68-5.34l.05-.26c4.28-.13 8.02.37 10.89 1.02l-.03-.21c-.59-3.66-1.46-7.01-2.58-9.88-1.84-4.68-4.23-7.59-6.25-7.59s-4.41 2.91-6.25 7.59c-.44 1.13-.85 2.34-1.21 3.62-.51 1.79-.94 3.7-1.28 5.71-.51 2.97-.82 6.16-.94 9.46H0Z"
            fill="white"
          />
        </svg>
      </span>
    );
  }

  if (chainId === 1 || chainId === 11155111) {
    return (
      <span className={cn("inline-flex items-center justify-center rounded-full bg-[#627EEA]/20 p-0.5 shrink-0", className)}>
        <svg className="h-full w-full" viewBox="0 0 24 24" fill="none" aria-label="Ethereum">
          <path d="M12 2L5.8 12.2L12 15.8L18.2 12.2L12 2Z" fill="#8C8CFF" />
          <path d="M12 2V15.8L18.2 12.2L12 2Z" fill="#627EEA" />
          <path d="M12 17L5.8 13.4L12 22L18.2 13.4L12 17Z" fill="#8C8CFF" />
          <path d="M12 17V22L18.2 13.4L12 17Z" fill="#627EEA" />
          <path d="M12 14.8L5.8 12.2L12 8.6L18.2 12.2L12 14.8Z" fill="#454A75" opacity="0.4" />
        </svg>
      </span>
    );
  }

  if (chainId === 42161 || chainId === 421614) {
    return (
      <span className={cn("inline-flex items-center justify-center rounded-full bg-[#213147] p-0.5 shrink-0", className)}>
        <svg className="h-full w-full" viewBox="0 0 2500 2500" fill="none" aria-label="Arbitrum One">
          <path fill="#213147" d="M226 760v980c0 63 33 120 88 152l849 490c54 31 121 31 175 0l849-490c54-31 88-89 88-152V760c0-63-33-120-88-152l-849-490c-54-31-121-31-175 0L314 608c-54 31-87 89-87 152h-1z" />
          <path fill="#12AAFF" d="M1435 1440l-121 332c-3 9-3 19 0 29l208 571 241-139-289-793c-7-18-32-18-39 0z" />
          <path fill="#12AAFF" d="M1678 882c-7-18-32-18-39 0l-121 332c-3 9-3 19 0 29l341 935 241-139L1678 882z" />
          <path fill="#9DCCED" d="M1250 155c6 0 12 2 17 5l918 530c11 6 17 18 17 30v1060c0 12-7 24-17 30l-918 530c-5 3-11 5-17 5s-12-2-17-5l-918-530c-11-6-17-18-17-30V719c0-12 7-24 17-30l918-530c5-3 11-5 17-5V155zm0-155c-33 0-65 8-95 25L237 555c-59 34-95 96-95 164v1060c0 68 36 130 95 164l918 530c29 17 62 25 95 25s65-8 95-25l918-530c59-34 95-96 95-164V719c0-68-36-130-95-164L1344 25c-29-17-62-25-95-25h-94z" />
          <path fill="#FFFFFF" d="M1172 644H939c-17 0-33 11-39 27L401 2039l241 139 550-1507c5-14-5-28-19-28h-1z" />
          <path fill="#FFFFFF" d="M1580 644h-233c-17 0-33 11-39 27L738 2233l241 139 620-1701c5-14-5-28-19-28v-99z" />
        </svg>
      </span>
    );
  }

  if (chainId === 8453 || chainId === 84532) {
    return (
      <span className={cn("inline-flex items-center justify-center rounded-full bg-[#0052FF]/20 p-0.5 shrink-0", className)}>
        <svg className="h-full w-full" viewBox="0 0 24 24" fill="none" aria-label="Base">
          <circle cx="12" cy="12" r="10" fill="#0052FF" />
          <path d="M6.4 12A5.6 5.6 0 0 1 17.5 10.9h-3.1A2.8 2.8 0 1 0 14.4 13h3.1A5.6 5.6 0 0 1 6.4 12Z" fill="white" />
        </svg>
      </span>
    );
  }

  if (chainId === 80002 || chainId === 137) {
    return (
      <span className={cn("inline-flex items-center justify-center rounded-full bg-[#8247E5]/20 p-0.5 shrink-0", className)}>
        <svg className="h-full w-full" viewBox="0 0 24 24" fill="none" aria-label="Polygon">
          <path
            d="m8.3 9.1 2.5-1.5a2.4 2.4 0 0 1 2.4 0l2.5 1.5a2.4 2.4 0 0 1 1.2 2.1v2.9l2.2-1.3v-2.9L16.6 8.4a2.4 2.4 0 0 0-2.4 0l-2.5 1.5a2.4 2.4 0 0 0-1.2 2.1v2.9l-2.2 1.3-2.2-1.3V12l2.2-1.3 1.3.8V8.9L9.5 8a2.4 2.4 0 0 0-2.4 0l-2.5 1.5a2.4 2.4 0 0 0-1.2 2.1v2.9a2.4 2.4 0 0 0 1.2 2.1l2.5 1.5a2.4 2.4 0 0 0 2.4 0l2.5-1.5a2.4 2.4 0 0 0 1.2-2.1v-2.9l2.2-1.3 2.2 1.3v2.9l-2.2 1.3-1.3-.8v2.6l.1.1a2.4 2.4 0 0 0 2.4 0l2.5-1.5a2.4 2.4 0 0 0 1.2-2.1v-2.9a2.4 2.4 0 0 0-1.2-2.1l-2.5-1.5a2.4 2.4 0 0 0-2.4 0l-2.5 1.5a2.4 2.4 0 0 0-1.2 2.1v2.9l-2.2 1.3-2.2-1.3v-2.9l2.2-1.3Z"
            fill="#8247E5"
          />
        </svg>
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center justify-center rounded-full bg-[#1a1d24] p-0.5 shrink-0", className)}>
      <svg className="h-full w-full" viewBox="0 0 31 32" fill="none" aria-label="Arc">
        <path
          d="M0 32C.26 24.17 1.59 16.85 3.82 11.17 6.64 3.97 10.73 0 15.32 0s8.68 3.97 11.5 11.17c1.47 3.75 2.55 8.2 3.19 13.04.06.43.11.87.16 1.31.02.03.03.05.02.07 0 0 .38 2.34.46 6.41h-.04c-.56-.46-7.14-5.61-18.04-4.12.16-1.84.39-3.63.68-5.34l.05-.26c4.28-.13 8.02.37 10.89 1.02l-.03-.21c-.59-3.66-1.46-7.01-2.58-9.88-1.84-4.68-4.23-7.59-6.25-7.59s-4.41 2.91-6.25 7.59c-.44 1.13-.85 2.34-1.21 3.62-.51 1.79-.94 3.7-1.28 5.71-.51 2.97-.82 6.16-.94 9.46H0Z"
          fill="white"
        />
      </svg>
    </span>
  );
}

export function NetworkSwitcher({ mobile = false }: { mobile?: boolean }) {
  const [open, setOpen] = useState(false);
  const closeDropdown = useCallback(() => setOpen(false), []);
  const containerRef = useDismissibleDropdown(open, closeDropdown);
  useCloseOnResume(closeDropdown, open);
  const chainId = useChainId();
  const { chains, switchChain, isPending } = useSwitchChain();
  const currentName = networkNames[chainId] ?? `Chain ${chainId}`;

  // Filter to supported chains in explicit order:
  // Arc Mainnet, Ethereum, Arbitrum One, Base, Polygon, and ONLY Arc Testnet as the last chain.
  const availableChains = useMemo(() => {
    const chainMap = new Map(chains.map((c) => [c.id, c]));
    return DROPDOWN_CHAIN_ORDER
      .map((id) => chainMap.get(id))
      .filter((c): c is (typeof chains)[number] => Boolean(c));
  }, [chains]);

  return (
    <div ref={containerRef} className={cn("relative", mobile && "w-full")}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex touch-manipulation items-center justify-center gap-1.5 px-2 py-2 text-xs text-white/65 transition hover:text-white",
          mobile && "min-h-10 w-full justify-between rounded-lg border border-white/10 bg-white/[0.045] px-3 hover:bg-white/[0.075]",
        )}
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <NetworkLogo chainId={chainId} className="h-5 w-5" />}
        <span>{currentName}</span>
        <ChevronDown className="h-3.5 w-3.5 text-white/40" />
      </button>

      {open ? (
        <div
          role="menu"
          className={cn(
            "absolute z-50 mt-2 min-w-56 rounded-lg border border-white/15 bg-[#090b0d] p-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.75)]",
            mobile ? "left-0 right-0" : "right-0",
          )}
        >
          {availableChains.map((chain) => {
            const active = chain.id === chainId;

            return (
              <button
                key={chain.id}
                type="button"
                onClick={() => {
                  switchChain({ chainId: chain.id });
                  setOpen(false);
                }}
                className="flex w-full touch-manipulation items-center justify-between rounded-md px-3 py-2.5 text-left text-sm text-white/65 transition hover:bg-white/[0.07] hover:text-white"
              >
                <span className="flex items-center gap-3">
                  <NetworkLogo chainId={chain.id} className="h-5 w-5" />
                  {networkNames[chain.id] ?? chain.name}
                </span>
                {active ? <Check className="h-4 w-4 text-emerald-200" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
