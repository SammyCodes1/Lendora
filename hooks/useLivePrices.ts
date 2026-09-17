"use client";

import { useEffect, useState, useCallback } from "react";

export interface PriceData {
  price: number;
  change24h: number;
  source: "coingecko" | "oracle" | "fallback";
}

export const FALLBACK_TOKEN_PRICES: Record<string, PriceData> = {
  USDC: { price: 1.0, change24h: 0, source: "fallback" },
  EURC: { price: 1.08, change24h: 0, source: "fallback" },
  USDT: { price: 1.0, change24h: 0, source: "fallback" },
  cirBTC: { price: 76140.0, change24h: 0, source: "fallback" },
};

export function useLivePrices() {
  const [prices, setPrices] = useState<Record<string, PriceData>>(FALLBACK_TOKEN_PRICES);
  const [isLoading, setIsLoading] = useState(true);

  const fetchPrices = useCallback(async () => {
    try {
      const res = await fetch("/api/prices", {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.success && data?.prices) {
        setPrices((prev) => ({
          ...prev,
          ...data.prices,
        }));
      }
    } catch {
      // Keep existing or fallback prices
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPrices();
    const interval = setInterval(() => {
      void fetchPrices();
    }, 15_000);
    return () => clearInterval(interval);
  }, [fetchPrices]);

  const getPrice = useCallback(
    (symbol: string): number => {
      return prices[symbol]?.price ?? FALLBACK_TOKEN_PRICES[symbol]?.price ?? 1.0;
    },
    [prices],
  );

  const getChange24h = useCallback(
    (symbol: string): number => {
      return prices[symbol]?.change24h ?? 0;
    },
    [prices],
  );

  const getUsdValue = useCallback(
    (symbol: string, amountStr: string): number => {
      const num = parseFloat(amountStr);
      if (isNaN(num) || num <= 0) return 0;
      const p = getPrice(symbol);
      return num * p;
    },
    [getPrice],
  );

  return {
    prices,
    isLoading,
    getPrice,
    getChange24h,
    getUsdValue,
    refetch: fetchPrices,
  };
}
