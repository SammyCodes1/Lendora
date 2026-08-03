import {
  createPublicClient,
  fallback,
  formatUnits,
  http,
  type Abi,
  type Address,
  type PublicClient,
} from "viem";
import { arcTestnet } from "viem/chains";
import lendingPoolAbi from "../../frontend/constants/abis/LendingPool.json";
import interestRateModelAbi from "../../frontend/constants/abis/InterestRateModel.json";
import mockPriceOracleAbi from "../../frontend/constants/abis/MockPriceOracle.json";
import erc20Abi from "../../frontend/constants/abis/ERC20.json";
import deployments from "../../frontend/constants/deployments.json";
import type {
  AgentContext,
  AgentReserve,
} from "../../frontend/lib/agentTypes";

const SECONDS_PER_YEAR = 31_536_000;
const RAY = 1e27;
const RAY_BIGINT = 1_000_000_000_000_000_000_000_000_000n;
const ASSET_UNIT = 1_000_000n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

const lendingPoolAddress = deployments.lendingPool as Address;
const priceOracleAddress = deployments.priceOracle as Address;
const fallbackPriceOracleAddress = (
  deployments.fallbackPriceOracle ?? ZERO_ADDRESS
) as Address;
const rateModelAddress = deployments.interestRateModel as Address;

const usdc = deployments.markets.USDC;
const eurc = deployments.markets.EURC;

const poolAbi = lendingPoolAbi as Abi;
const oracleAbi = mockPriceOracleAbi as Abi;
const rateAbi = interestRateModelAbi as Abi;
const tokenAbi = erc20Abi as Abi;

const USDT_ADDRESS = "0x175CdB1D338945f0D851A741ccF787D343E57952" as Address;
const CIRBTC_ADDRESS = "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF" as Address;

const bridgeUsdc = {
  ethereum: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  base: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  polygon: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
} as const satisfies Record<string, Address>;

const BRIDGE_CHAINS = [
  {
    key: "Ethereum_Sepolia",
    rpc: "https://11155111.rpc.thirdweb.com",
    token: bridgeUsdc.ethereum,
  },
  {
    key: "Base_Sepolia",
    rpc: "https://sepolia.base.org",
    token: bridgeUsdc.base,
  },
  {
    key: "Polygon_Amoy_Testnet",
    rpc: "https://rpc-amoy.polygon.technology",
    token: bridgeUsdc.polygon,
  },
] as const;

function arcRpcUrls() {
  return [
    process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL,
    "https://rpc.testnet.arc.network",
    "https://rpc.blockdaemon.testnet.arc.network",
    "https://rpc.drpc.testnet.arc.network",
    "https://rpc.quicknode.testnet.arc.network",
  ].filter(
    (url, index, urls): url is string =>
      Boolean(url) && urls.indexOf(url) === index,
  );
}

function createArcClient(): PublicClient {
  return createPublicClient({
    chain: arcTestnet,
    transport: fallback(
      arcRpcUrls().map((url) =>
        http(url, { retryCount: 0, timeout: 12_000 }),
      ),
      { retryCount: 1 },
    ),
  });
}

type Resolved<T> = { ok: true; value: T } | { ok: false };

async function safe<T>(promise: Promise<T>): Promise<Resolved<T>> {
  try {
    return { ok: true, value: await promise };
  } catch {
    return { ok: false };
  }
}

function bigintResult(value: unknown) {
  if (typeof value === "bigint") return value;
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    try {
      return BigInt(value);
    } catch {
      return 0n;
    }
  }
  return 0n;
}

function rawBalance(value?: bigint, decimals = 6) {
  return value === undefined ? "0" : formatUnits(value, decimals);
}

const MAX_UINT256 = BigInt(
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
);

function healthFactor(value?: bigint) {
  if (value === undefined) {
    return "unavailable";
  }
  if (value === MAX_UINT256) {
    return "∞";
  }
  const numeric = Number(formatUnits(value, 18));
  if (!Number.isFinite(numeric)) {
    return "unavailable";
  }
  if (numeric > 9) {
    return "Max";
  }
  return numeric.toFixed(2);
}

type ReserveData = {
  aToken: Address;
  debtToken: Address;
  underlyingAsset: Address;
  totalLiquidity: bigint;
  totalBorrowed: bigint;
  ltv: number;
  liquidationThreshold: number;
  isActive: boolean;
  isBorrowingEnabled: boolean;
};

function mapReserveData(data: unknown): ReserveData | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const reserve = data as Partial<ReserveData> & Record<number, unknown>;
  const aToken = reserve.aToken ?? reserve[0];
  const debtToken = reserve.debtToken ?? reserve[1];
  const underlyingAsset = reserve.underlyingAsset ?? reserve[2];
  const totalLiquidity = bigintResult(reserve.totalLiquidity ?? reserve[6]);
  const totalBorrowed = bigintResult(reserve.totalBorrowed ?? reserve[7]);

  if (
    typeof aToken !== "string" ||
    typeof debtToken !== "string" ||
    typeof underlyingAsset !== "string"
  ) {
    return undefined;
  }

  return {
    aToken: aToken as Address,
    debtToken: debtToken as Address,
    underlyingAsset: underlyingAsset as Address,
    totalLiquidity,
    totalBorrowed,
    ltv: Number(reserve.ltv ?? reserve[8]),
    liquidationThreshold: Number(reserve.liquidationThreshold ?? reserve[9]),
    isActive: Boolean(reserve.isActive ?? reserve[11]),
    isBorrowingEnabled: Boolean(reserve.isBorrowingEnabled ?? reserve[12]),
  };
}

type OraclePrice = { price: bigint; priceDecimals: number };

function resolveOraclePrice(
  primaryTuple: readonly [bigint, number] | undefined,
  fallbackTuple: readonly [bigint, number] | undefined,
): OraclePrice {
  const primaryPrice = bigintResult(primaryTuple?.[0]);
  const primaryDecimals = Number(primaryTuple?.[1] ?? 0);
  if (primaryPrice > 0n && primaryDecimals === 8) {
    return { price: primaryPrice, priceDecimals: 8 };
  }
  const fallbackPrice = bigintResult(fallbackTuple?.[0]);
  const fallbackDecimals = Number(fallbackTuple?.[1] ?? 8);
  if (fallbackPrice > 0n && fallbackDecimals === 8) {
    return { price: fallbackPrice, priceDecimals: 8 };
  }
  return { price: 0n, priceDecimals: 8 };
}

async function readOraclePrice(
  client: PublicClient,
  asset: Address,
): Promise<Resolved<OraclePrice>> {
  const hasFallbackOracle =
    fallbackPriceOracleAddress !== ZERO_ADDRESS &&
    fallbackPriceOracleAddress.toLowerCase() !==
      priceOracleAddress.toLowerCase();
  const [primary, fallbackRes] = await Promise.all([
    safe(
      client.readContract({
        address: priceOracleAddress,
        abi: oracleAbi,
        functionName: "getPrice",
        args: [asset],
      }),
    ),
    hasFallbackOracle
      ? safe(
          client.readContract({
            address: fallbackPriceOracleAddress,
            abi: oracleAbi,
            functionName: "getPrice",
            args: [asset],
          }),
        )
      : Promise.resolve({ ok: false } as const),
  ]);
  if (!primary.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    value: resolveOraclePrice(
      primary.value as readonly [bigint, number],
      fallbackRes.ok
        ? (fallbackRes.value as readonly [bigint, number])
        : undefined,
    ),
  };
}

type TokenBalances = { wallet: bigint; supplied: bigint; debt: bigint };

async function readTokenBalances(
  client: PublicClient,
  asset: Address,
  aToken: Address,
  debtToken: Address,
  address: Address,
): Promise<Resolved<TokenBalances>> {
  const [wallet, supplied, debt] = await Promise.all([
    safe(
      client.readContract({
        address: asset,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [address],
      }),
    ),
    safe(
      client.readContract({
        address: aToken,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [address],
      }),
    ),
    safe(
      client.readContract({
        address: debtToken,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [address],
      }),
    ),
  ]);
  if (!wallet.ok || !supplied.ok || !debt.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    value: {
      wallet: bigintResult(wallet.value),
      supplied: bigintResult(supplied.value),
      debt: bigintResult(debt.value),
    },
  };
}

async function readWalletToken(
  client: PublicClient,
  token: Address,
  address: Address,
): Promise<Resolved<bigint>> {
  const result = await safe(
    client.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [address],
    }),
  );
  return result.ok ? { ok: true, value: bigintResult(result.value) } : result;
}

async function readBridgeBalances(address: Address) {
  const entries = await Promise.all(
    BRIDGE_CHAINS.map(async (chain) => {
      const client = createPublicClient({
        transport: http(chain.rpc, { retryCount: 0, timeout: 12_000 }),
      });
      const result = await safe(
        client.readContract({
          address: chain.token,
          abi: tokenAbi,
          functionName: "balanceOf",
          args: [address],
        }),
      );
      return result.ok ? bigintResult(result.value) : 0n;
    }),
  );
  return {
    Ethereum_Sepolia: rawBalance(entries[0]),
    Base_Sepolia: rawBalance(entries[1]),
    Polygon_Amoy_Testnet: rawBalance(entries[2]),
  };
}

type RateResult = { supplyRate: bigint; borrowRate: bigint };

async function readRates(
  client: PublicClient,
  reserve: ReserveData | undefined,
): Promise<RateResult> {
  const totalBorrowed = bigintResult(reserve?.totalBorrowed);
  const totalLiquidity = bigintResult(reserve?.totalLiquidity);
  const [supply, borrow] = await Promise.all([
    safe(
      client.readContract({
        address: rateModelAddress,
        abi: rateAbi,
        functionName: "calculateSupplyRate",
        args: [totalBorrowed, totalLiquidity],
      }),
    ),
    safe(
      client.readContract({
        address: rateModelAddress,
        abi: rateAbi,
        functionName: "calculateBorrowRate",
        args: [totalBorrowed, totalLiquidity],
      }),
    ),
  ]);
  return {
    supplyRate: supply.ok ? bigintResult(supply.value) : 0n,
    borrowRate: borrow.ok ? bigintResult(borrow.value) : 0n,
  };
}

function annualizedPercent(ratePerSecond?: bigint) {
  if (!ratePerSecond) {
    return 0;
  }
  return (Number(ratePerSecond) / RAY) * SECONDS_PER_YEAR * 100;
}

function formatRate(value: number) {
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function reserveContext(
  symbol: "USDC" | "EURC",
  asset: Address,
  reserve: ReserveData | undefined,
  price: OraclePrice | undefined,
  rates: RateResult | undefined,
): AgentReserve | undefined {
  if (!reserve || !price) {
    return undefined;
  }
  return {
    asset: symbol,
    address: asset,
    decimals: 6,
    supplyApy: formatRate(annualizedPercent(rates?.supplyRate)),
    borrowApr: formatRate(annualizedPercent(rates?.borrowRate)),
    availableLiquidity: rawBalance(
      reserve.totalLiquidity > reserve.totalBorrowed
        ? reserve.totalLiquidity - reserve.totalBorrowed
        : 0n,
    ),
    priceUsd: rawBalance(price.price, 8),
    liquidationThresholdBps: reserve.liquidationThreshold,
    active: reserve.isActive,
    borrowingEnabled: reserve.isBorrowingEnabled,
  };
}

export async function buildAgentContext(
  walletAddress: string,
): Promise<AgentContext> {
  const client = createArcClient();
  const address = walletAddress as Address;

  const [
    accountRes,
    usdcReserveRes,
    eurcReserveRes,
    usdcPriceRes,
    eurcPriceRes,
    usdcBalsRes,
    eurcBalsRes,
    usdtRes,
    cirBtcRes,
    bridgeBalances,
  ] = await Promise.all([
    safe(
      client.readContract({
        address: lendingPoolAddress,
        abi: poolAbi,
        functionName: "getUserAccountData",
        args: [address],
      }),
    ),
    safe(
      client.readContract({
        address: lendingPoolAddress,
        abi: poolAbi,
        functionName: "getReserveData",
        args: [usdc.asset as Address],
      }),
    ),
    safe(
      client.readContract({
        address: lendingPoolAddress,
        abi: poolAbi,
        functionName: "getReserveData",
        args: [eurc.asset as Address],
      }),
    ),
    readOraclePrice(client, usdc.asset as Address),
    readOraclePrice(client, eurc.asset as Address),
    readTokenBalances(
      client,
      usdc.asset as Address,
      usdc.aToken as Address,
      usdc.debtToken as Address,
      address,
    ),
    readTokenBalances(
      client,
      eurc.asset as Address,
      eurc.aToken as Address,
      eurc.debtToken as Address,
      address,
    ),
    readWalletToken(client, USDT_ADDRESS, address),
    readWalletToken(client, CIRBTC_ADDRESS, address),
    readBridgeBalances(address),
  ]);

  const usdcReserve = usdcReserveRes.ok
    ? mapReserveData(usdcReserveRes.value)
    : undefined;
  const eurcReserve = eurcReserveRes.ok
    ? mapReserveData(eurcReserveRes.value)
    : undefined;

  const [usdcRates, eurcRates] = await Promise.all([
    readRates(client, usdcReserve),
    readRates(client, eurcReserve),
  ]);

  const account = accountRes.ok
    ? (accountRes.value as {
        totalCollateralUSD: bigint;
        totalDebtUSD: bigint;
        availableBorrowsUSD: bigint;
        healthFactor: bigint;
      })
    : undefined;

  const usdcMarket = {
    userSupply: usdcBalsRes.ok ? usdcBalsRes.value.supplied : 0n,
    price: usdcPriceRes.ok ? usdcPriceRes.value.price : 0n,
    liquidationThreshold: usdcReserve?.liquidationThreshold ?? 0,
  };
  const eurcMarket = {
    userSupply: eurcBalsRes.ok ? eurcBalsRes.value.supplied : 0n,
    price: eurcPriceRes.ok ? eurcPriceRes.value.price : 0n,
    liquidationThreshold: eurcReserve?.liquidationThreshold ?? 0,
  };
  const liquidationCapacityUsd = [usdcMarket, eurcMarket].reduce(
    (sum, market) =>
      sum +
      (((market.userSupply * market.price) / ASSET_UNIT) *
        BigInt(market.liquidationThreshold)) /
        10_000n,
    0n,
  );

  const usdcBalance = usdcBalsRes.ok
    ? {
        wallet: rawBalance(usdcBalsRes.value.wallet),
        supplied: rawBalance(usdcBalsRes.value.supplied),
        debt: rawBalance(usdcBalsRes.value.debt),
      }
    : undefined;
  const eurcBalance = eurcBalsRes.ok
    ? {
        wallet: rawBalance(eurcBalsRes.value.wallet),
        supplied: rawBalance(eurcBalsRes.value.supplied),
        debt: rawBalance(eurcBalsRes.value.debt),
      }
    : undefined;
  const usdtBalance = usdtRes.ok
    ? { wallet: rawBalance(usdtRes.value, 18), supplied: "0", debt: "0" }
    : undefined;
  const cirBtcBalance = cirBtcRes.ok
    ? { wallet: rawBalance(cirBtcRes.value, 8), supplied: "0", debt: "0" }
    : undefined;

  const usdcReserveContext = reserveContext(
    "USDC",
    usdc.asset as Address,
    usdcReserve,
    usdcPriceRes.ok ? usdcPriceRes.value : undefined,
    usdcRates,
  );
  const eurcReserveContext = reserveContext(
    "EURC",
    eurc.asset as Address,
    eurcReserve,
    eurcPriceRes.ok ? eurcPriceRes.value : undefined,
    eurcRates,
  );

  return {
    walletAddress,
    positions: {
      totalCollateralUsd: rawBalance(account?.totalCollateralUSD, 8),
      totalDebtUsd: rawBalance(account?.totalDebtUSD, 8),
      availableBorrowsUsd: rawBalance(account?.availableBorrowsUSD, 8),
      healthFactor: healthFactor(account?.healthFactor),
      liquidationCapacityUsd: rawBalance(liquidationCapacityUsd, 8),
    },
    balances: {
      ...(usdcBalance ? { USDC: usdcBalance } : {}),
      ...(eurcBalance ? { EURC: eurcBalance } : {}),
      ...(usdtBalance ? { USDT: usdtBalance } : {}),
      ...(cirBtcBalance ? { cirBTC: cirBtcBalance } : {}),
    },
    contacts: [],
    bridgeBalances,
    reserves: {
      ...(usdcReserveContext ? { USDC: usdcReserveContext } : {}),
      ...(eurcReserveContext ? { EURC: eurcReserveContext } : {}),
    },
  };
}
