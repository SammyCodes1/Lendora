import { formatUnits, parseUnits, type Address } from "viem";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
export const ARCSCAN_TX = "https://testnet.arcscan.app/tx/";

export function parseTokenAmount(value: string) {
  const normalized = value.trim().replace(/,/g, "");
  if (
    !normalized ||
    !/^(?:\d+|\d*\.\d{0,6})$/.test(normalized) ||
    Number(normalized) <= 0
  ) {
    return 0n;
  }

  try {
    return parseUnits(normalized, 6);
  } catch {
    return 0n;
  }
}

/** Full-precision amount string for MAX buttons (no locale grouping). */
export function formatExactTokenAmount(value?: bigint, decimals = 6) {
  if (value === undefined || value === 0n) {
    return "0";
  }
  return formatUnits(value, decimals);
}

export function formatTokenAmount(value?: bigint, digits = 2) {
  if (!value) {
    return "0.00";
  }

  return Number(formatUnits(value, 6)).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}

/**
 * Prefer short, user-facing revert reasons over full viem stack dumps.
 */
export function errorMessage(error: unknown) {
  if (!error) {
    return "";
  }

  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Transaction failed";

  const patterns = [
    /LendingPool:\s*([^\n"\\]+)/i,
    /AToken:\s*([^\n"\\]+)/i,
    /DebtToken:\s*([^\n"\\]+)/i,
    /MockPriceOracle:\s*([^\n"\\]+)/i,
    /reverted with the following reason:\s*\n?\s*([^\n]+)/i,
    /Error:\s*(LendingPool:[^\n]+)/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      const reason = match[1].trim();
      if (/insufficient liquidity/i.test(reason)) {
        return "Not enough free liquidity in the pool. Try a smaller amount or wait for repayments.";
      }
      if (/health factor too low/i.test(reason)) {
        return "This would drop your health factor below 1.0. Repay debt or reduce the amount.";
      }
      if (/insufficient aToken/i.test(reason)) {
        return "Amount exceeds your supplied balance.";
      }
      if (/insufficient collateral/i.test(reason)) {
        return "Not enough collateral borrowing power for this amount.";
      }
      if (/supply cap exceeded/i.test(reason)) {
        return "This amount exceeds the pool supply cap.";
      }
      if (/borrow cap exceeded/i.test(reason)) {
        return "This amount exceeds the pool borrow cap.";
      }
      if (/paused|EnforcedPause/i.test(reason)) {
        return "The protocol is paused. Try again later.";
      }
      if (/stale price/i.test(reason)) {
        return "Oracle price is stale. Try again shortly.";
      }
      return reason.startsWith("LendingPool:") || reason.startsWith("AToken:")
        ? reason
        : reason;
    }
  }

  if (/user rejected|denied|rejected the request/i.test(raw)) {
    return "Transaction was rejected in the wallet.";
  }

  // Collapse multi-line viem dumps to the first meaningful line.
  const firstLine = raw
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("Request Arguments"));
  if (firstLine && firstLine.length < 180) {
    return firstLine;
  }

  return "Transaction failed. Check amount, liquidity, and health factor.";
}
