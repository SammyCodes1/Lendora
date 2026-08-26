export const PENDING_SUPPLY_STORAGE_KEY = "arclend:pending-supply";

export type PendingSupply = {
  marketAddress: string;
  amount: string;
};

export function readPendingSupply(): PendingSupply | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(PENDING_SUPPLY_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<PendingSupply>;
    if (
      typeof parsed.marketAddress !== "string" ||
      typeof parsed.amount !== "string"
    ) {
      return null;
    }

    return {
      marketAddress: parsed.marketAddress,
      amount: parsed.amount,
    };
  } catch {
    return null;
  }
}

export function writePendingSupply(marketAddress: string, amount: string) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(
      PENDING_SUPPLY_STORAGE_KEY,
      JSON.stringify({ marketAddress, amount }),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearPendingSupply() {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(PENDING_SUPPLY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}