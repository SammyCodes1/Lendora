import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbi, type Address } from "viem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ARC_MAINNET_RPC = process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL || "https://rpc.mainnet.arc.io";
const ORACLE_ADDRESS: Address = "0xbee561CF55b5976213325EdBa41839b6277908de";

const TOKEN_ADDRESSES: Record<string, Address> = {
  USDC: "0x3600000000000000000000000000000000000000",
  EURC: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
  USDT: "0x175CdB1D338945f0D851A741ccF787D343E57952",
  cirBTC: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
};

const DEFAULT_PRICES: Record<string, number> = {
  USDC: 1.0,
  EURC: 1.08,
  USDT: 1.0,
  cirBTC: 76140.0,
};

const ORACLE_ABI = parseAbi([
  "function getPrice(address token) external view returns (uint256 price, uint8 decimals)",
]);

interface PriceItem {
  price: number;
  change24h: number;
  source: "coingecko" | "oracle" | "fallback";
}

let cachedResponse: {
  data: Record<string, PriceItem>;
  expiresAt: number;
} | null = null;

async function fetchFromCoinGecko(): Promise<Record<string, { price: number; change24h: number }> | null> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,euro-coin,tether,usd-coin&vs_currencies=usd&include_24hr_change=true",
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
      USDC: {
        price: Number(data?.["usd-coin"]?.usd ?? 1.0),
        change24h: Number(data?.["usd-coin"]?.usd_24h_change ?? 0),
      },
      EURC: {
        price: Number(data?.["euro-coin"]?.usd ?? 1.08),
        change24h: Number(data?.["euro-coin"]?.usd_24h_change ?? 0),
      },
      USDT: {
        price: Number(data?.tether?.usd ?? 1.0),
        change24h: Number(data?.tether?.usd_24h_change ?? 0),
      },
      cirBTC: {
        price: Number(data?.bitcoin?.usd ?? 76140.0),
        change24h: Number(data?.bitcoin?.usd_24h_change ?? 0),
      },
    };
  } catch {
    return null;
  }
}

async function fetchFromOnChainOracle(): Promise<Record<string, number> | null> {
  try {
    const client = createPublicClient({
      transport: http(ARC_MAINNET_RPC, { timeout: 4000 }),
    });

    const results = await Promise.all(
      Object.entries(TOKEN_ADDRESSES).map(async ([symbol, address]) => {
        try {
          const [rawPrice, decimals] = await client.readContract({
            address: ORACLE_ADDRESS,
            abi: ORACLE_ABI,
            functionName: "getPrice",
            args: [address],
          });
          const price = Number(rawPrice) / 10 ** decimals;
          return [symbol, price] as const;
        } catch {
          return [symbol, DEFAULT_PRICES[symbol]] as const;
        }
      }),
    );

    return Object.fromEntries(results);
  } catch {
    return null;
  }
}

export async function GET() {
  const now = Date.now();
  if (cachedResponse && cachedResponse.expiresAt > now) {
    return NextResponse.json(
      {
        success: true,
        prices: cachedResponse.data,
        cached: true,
        timestamp: now,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20",
        },
      },
    );
  }

  // 1. Try CoinGecko first for live market prices
  const cgData = await fetchFromCoinGecko();
  if (cgData) {
    const data: Record<string, PriceItem> = {
      USDC: { ...cgData.USDC, source: "coingecko" },
      EURC: { ...cgData.EURC, source: "coingecko" },
      USDT: { ...cgData.USDT, source: "coingecko" },
      cirBTC: { ...cgData.cirBTC, source: "coingecko" },
    };
    cachedResponse = { data, expiresAt: now + 15_000 };
    return NextResponse.json(
      { success: true, prices: data, cached: false, timestamp: now },
      {
        headers: {
          "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20",
        },
      },
    );
  }

  // 2. Fall back to on-chain ChainlinkPriceOracle
  const oracleData = await fetchFromOnChainOracle();
  if (oracleData) {
    const data: Record<string, PriceItem> = {
      USDC: { price: oracleData.USDC ?? 1.0, change24h: 0, source: "oracle" },
      EURC: { price: oracleData.EURC ?? 1.08, change24h: 0, source: "oracle" },
      USDT: { price: oracleData.USDT ?? 1.0, change24h: 0, source: "oracle" },
      cirBTC: { price: oracleData.cirBTC ?? 76140.0, change24h: 0, source: "oracle" },
    };
    cachedResponse = { data, expiresAt: now + 10_000 };
    return NextResponse.json(
      { success: true, prices: data, cached: false, timestamp: now },
      {
        headers: {
          "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20",
        },
      },
    );
  }

  // 3. Fallback defaults
  const data: Record<string, PriceItem> = {
    USDC: { price: DEFAULT_PRICES.USDC, change24h: 0, source: "fallback" },
    EURC: { price: DEFAULT_PRICES.EURC, change24h: 0, source: "fallback" },
    USDT: { price: DEFAULT_PRICES.USDT, change24h: 0, source: "fallback" },
    cirBTC: { price: DEFAULT_PRICES.cirBTC, change24h: 0, source: "fallback" },
  };

  return NextResponse.json(
    { success: true, prices: data, cached: false, timestamp: now },
    {
      headers: {
        "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20",
      },
    },
  );
}
