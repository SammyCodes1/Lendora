/**
 * SAFETY REVIEW CHECKLIST — every change to this file must re-review all rules:
 * 1. Block non-positive, NaN, or unparseable amounts.
 * 2. Block assets outside the live active ArcLend reserve list.
 * 3. Block supply amounts above the live wallet balance.
 * 4. Block withdrawals above the live aToken balance.
 * 5. Block repayments above the live outstanding debt.
 * 6. Block borrows above contract capacity or projected health factor < 1.10.
 * 7. Block swaps above the live tokenIn wallet balance.
 * 8. Block swap slippage above 500 bps (5%).
 * 9. Block bridges above the live source-chain USDC balance.
 * 10. Block sends to invalid/self addresses or above live token balance.
 * 11. Block when wallet/context/RPC/reserve/pause state cannot be verified.
 * 12. Block all actions after 3 validator rejections within 5 minutes.
 * 13. Block domain mints for invalid or already registered names.
 * 14. Block domain burns unless the connected wallet owns the unlisted domain.
 * 15. Block yield claims unless live reserve indexes show positive pending supply interest.
 *
 * This module is the single server-side safety boundary between natural-language
 * interpretation and a confirmable wallet transaction. A false result is final.
 */
import "server-only";

import {
  createPublicClient,
  defineChain,
  erc20Abi,
  fallback,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseUnits,
  type Address,
  type PublicClient,
} from "viem";
import { arcTestnet } from "viem/chains";
import lendingPoolAbi from "@/constants/abis/LendingPool.json";
import priceOracleAbi from "@/constants/abis/MockPriceOracle.json";
import deployments from "@/constants/deployments.json";
import {
  ARCANA_MARKETS_ADDRESS,
  ARC_USDC_ADDRESS,
  arcanaMarketsAbi,
} from "@/constants/arcana";
import {
  ARC_DEX_TOKENS,
  isStableSwapPair,
  synthraV3FeesForPair,
} from "@/lib/arcDex";
import type {
  AgentAction,
  AgentValidationResult,
  LendingAsset,
} from "@/lib/agentTypes";

type ValidationContext = {
  walletAddress: string | null;
};

type ReserveSnapshot = {
  asset: LendingAsset;
  address: Address;
  aToken: Address;
  debtToken: Address;
  liquidityIndex: bigint;
  lastUpdateTimestamp: bigint;
  totalLiquidity: bigint;
  totalBorrowed: bigint;
  liquidationThreshold: number;
  active: boolean;
  borrowingEnabled: boolean;
  collateralEnabled: boolean;
  price: bigint;
  priceDecimals: number;
  poolLiquidity: bigint;
  walletBalance: bigint;
  suppliedBalance: bigint;
  scaledSupplyBalance: bigint;
  debtBalance: bigint;
  collateralEnabledForUser: boolean;
};

const ASSET_UNIT = 1_000_000n;
const RAY = 1_000_000_000_000_000_000_000_000_000n;
const WAD = 1_000_000_000_000_000_000n;
const BPS = 10_000n;
const MIN_HEALTH_FACTOR = 1_100_000_000_000_000_000n;

const externalChains = {
  Ethereum_Sepolia: defineChain({
    id: 11_155_111,
    name: "Ethereum Sepolia",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: ["https://11155111.rpc.thirdweb.com"] },
    },
    testnet: true,
  }),
  Base_Sepolia: defineChain({
    id: 84_532,
    name: "Base Sepolia",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://sepolia.base.org"] } },
    testnet: true,
  }),
  Polygon_Amoy_Testnet: defineChain({
    id: 80_002,
    name: "Polygon Amoy",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    rpcUrls: {
      default: { http: ["https://rpc-amoy.polygon.technology"] },
    },
    testnet: true,
  }),
} as const;

const bridgeUsdc = {
  Ethereum_Sepolia:
    "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  Base_Sepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  Polygon_Amoy_Testnet:
    "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
} as const satisfies Record<keyof typeof externalChains, Address>;

const configuredReserves = {
  USDC: {
    asset: deployments.markets.USDC.asset as Address,
    aToken: deployments.markets.USDC.aToken as Address,
    debtToken: deployments.markets.USDC.debtToken as Address,
  },
  EURC: {
    asset: deployments.markets.EURC.asset as Address,
    aToken: deployments.markets.EURC.aToken as Address,
    debtToken: deployments.markets.EURC.debtToken as Address,
  },
} as const;

const poolAddress = deployments.lendingPool as Address;
const oracleAddress = deployments.priceOracle as Address;
const fallbackOracleAddress = (
  (deployments as typeof deployments & { fallbackPriceOracle?: Address })
    .fallbackPriceOracle ?? "0x0000000000000000000000000000000000000000"
) as Address;
const rateModelAddress = deployments.interestRateModel as Address;
const walletDomainAddress = deployments.WalletDomain as Address;
const domainMarketplaceAddress = (
  deployments as typeof deployments & { DomainMarketplace?: Address }
).DomainMarketplace;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const walletDomainAbi = parseAbi([
  "function isRegistered(string name) view returns (bool)",
  "function resolveDomain(string name) view returns (address)",
  "function tokenIdOf(string name) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
]);
const domainMarketplaceAbi = parseAbi([
  "function listings(uint256 tokenId) view returns (address seller,uint256 price)",
]);
const indexedBalanceAbi = parseAbi([
  "function scaledBalanceOf(address account) view returns (uint256)",
]);
const rateModelAbi = parseAbi([
  "function calculateSupplyRate(uint256 totalBorrowed,uint256 totalLiquidity) view returns (uint256)",
]);
const arcRpcUrls = Array.from(
  new Set(
    [
      process.env.ARC_TESTNET_RPC_URL,
      process.env.NEXT_PUBLIC_RPC_URL,
      ...arcTestnet.rpcUrls.default.http,
      "https://rpc.drpc.testnet.arc.network",
      "https://rpc.quicknode.testnet.arc.network",
      "https://rpc.blockdaemon.testnet.arc.network",
    ].filter((url): url is string => Boolean(url)),
  ),
);

const arcClient = createPublicClient({
  chain: arcTestnet,
  transport: fallback(
    arcRpcUrls.map((url) =>
      http(url, {
        retryCount: 0,
        timeout: 12_000,
      }),
    ),
    {
      retryCount: 1,
      retryDelay: 250,
    },
  ),
});

function hardBlock(_wallet: string, reason: string): AgentValidationResult {
  return { valid: false, reason };
}

function invalidContext(wallet?: string): AgentValidationResult {
  const reason = wallet
    ? "I can't verify live Arc data right now. Please try again in a moment."
    : "Please connect your wallet and try again.";
  return wallet
    ? hardBlock(wallet, reason)
    : { valid: false, reason };
}

function parseAmount(value: unknown, decimals = 6) {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d*)(\.\d+)?$/.test(value.trim())
  ) {
    return null;
  }

  try {
    const parsed = parseUnits(value.trim(), decimals);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

function isSwapToken(
  value: unknown,
): value is keyof typeof ARC_DEX_TOKENS {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ARC_DEX_TOKENS, value)
  );
}

function normalizeDomainName(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\.(?:arclend|arc)$/, "");
  if (!/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function displayDomainName(domain: string) {
  return `${domain}.arclend`;
}

function marketplaceListingTuple(value: unknown) {
  const listing = value as Record<string | number, unknown>;
  return {
    seller: (listing.seller ?? listing[0]) as Address,
    price: (listing.price ?? listing[1]) as bigint,
  };
}

async function resolveRecipient(value: string) {
  const trimmed = value.trim();
  if (isAddress(trimmed)) {
    return { address: getAddress(trimmed) };
  }

  const domain = normalizeDomainName(trimmed);
  if (!domain) {
    throw new Error("invalid-recipient");
  }

  const resolved = await arcClient.readContract({
    address: walletDomainAddress,
    abi: walletDomainAbi,
    functionName: "resolveDomain",
    args: [domain],
  });

  if (
    !isAddress(resolved) ||
    resolved === "0x0000000000000000000000000000000000000000"
  ) {
    throw new Error("unresolved-domain");
  }

  return { address: getAddress(resolved), domain };
}

function reserveTuple(value: unknown) {
  const reserve = value as Record<string | number, unknown>;
  return {
    aToken: (reserve.aToken ?? reserve[0]) as Address,
    debtToken: (reserve.debtToken ?? reserve[1]) as Address,
    liquidityIndex: (reserve.liquidityIndex ?? reserve[3]) as bigint,
    lastUpdateTimestamp: (reserve.lastUpdateTimestamp ?? reserve[5]) as bigint,
    totalLiquidity: (reserve.totalLiquidity ?? reserve[6]) as bigint,
    totalBorrowed: (reserve.totalBorrowed ?? reserve[7]) as bigint,
    liquidationThreshold: Number(
      reserve.liquidationThreshold ?? reserve[9],
    ),
    active: Boolean(reserve.isActive ?? reserve[11]),
    borrowingEnabled: Boolean(
      reserve.isBorrowingEnabled ?? reserve[12],
    ),
    collateralEnabled: Boolean(
      reserve.isCollateralEnabled ?? reserve[13],
    ),
  };
}

function accountTuple(value: unknown) {
  const account = value as Record<string | number, unknown>;
  return {
    totalCollateralUSD: (account.totalCollateralUSD ?? account[0]) as bigint,
    totalDebtUSD: (account.totalDebtUSD ?? account[1]) as bigint,
    availableBorrowsUSD: (account.availableBorrowsUSD ?? account[2]) as bigint,
    healthFactor: (account.healthFactor ?? account[3]) as bigint,
  };
}

function projectedIndex(
  storedIndex: bigint,
  ratePerSecond: bigint,
  lastUpdateTimestamp: bigint,
  nowSeconds: bigint,
) {
  if (nowSeconds <= lastUpdateTimestamp || ratePerSecond === 0n) {
    return storedIndex;
  }
  const elapsed = nowSeconds - lastUpdateTimestamp;
  const growth = RAY + ratePerSecond * elapsed;
  return (storedIndex * growth) / RAY;
}

/**
 * Mirrors LendingPool._getPrice: primary first, then fallback when primary is
 * stale, zero, or not 8-decimal USD.
 */
async function readOraclePrice(
  client: PublicClient,
  asset: Address,
  blockNumber: bigint,
): Promise<readonly [bigint, number]> {
  try {
    const primary = (await client.readContract({
      address: oracleAddress,
      abi: priceOracleAbi,
      functionName: "getPrice",
      args: [asset],
      blockNumber,
    })) as readonly [bigint, number];
    if (primary[0] > 0n && Number(primary[1]) === 8) {
      return primary;
    }
  } catch {
    // Primary may be stale; fall through to fallback oracle.
  }

  if (
    !fallbackOracleAddress ||
    fallbackOracleAddress === ZERO_ADDRESS ||
    fallbackOracleAddress.toLowerCase() === oracleAddress.toLowerCase()
  ) {
    throw new Error("No valid oracle price");
  }

  const fallback = (await client.readContract({
    address: fallbackOracleAddress,
    abi: priceOracleAbi,
    functionName: "getPrice",
    args: [asset],
    blockNumber,
  })) as readonly [bigint, number];
  if (fallback[0] <= 0n || Number(fallback[1]) !== 8) {
    throw new Error("No valid oracle price");
  }
  return fallback;
}

async function loadReserveSnapshot(
  client: PublicClient,
  wallet: Address,
  asset: LendingAsset,
  blockNumber: bigint,
): Promise<ReserveSnapshot> {
  const configured = configuredReserves[asset];
  const [
    reserveResult,
    priceResult,
    poolLiquidity,
    walletBalance,
    suppliedBalance,
    scaledSupplyBalance,
    debtBalance,
    collateralEnabledForUser,
  ] = await Promise.all([
    client.readContract({
      address: poolAddress,
      abi: lendingPoolAbi,
      functionName: "getReserveData",
      args: [configured.asset],
      blockNumber,
    }),
    readOraclePrice(client, configured.asset, blockNumber),
    client.readContract({
      address: configured.asset,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [poolAddress],
      blockNumber,
    }),
    client.readContract({
      address: configured.asset,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [wallet],
      blockNumber,
    }),
    client.readContract({
      address: configured.aToken,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [wallet],
      blockNumber,
    }),
    client.readContract({
      address: configured.aToken,
      abi: indexedBalanceAbi,
      functionName: "scaledBalanceOf",
      args: [wallet],
      blockNumber,
    }),
    client.readContract({
      address: configured.debtToken,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [wallet],
      blockNumber,
    }),
    client.readContract({
      address: poolAddress,
      abi: lendingPoolAbi,
      functionName: "userCollateralEnabled",
      args: [wallet, configured.asset],
      blockNumber,
    }),
  ]);

  const reserve = reserveTuple(reserveResult);
  const [price, priceDecimals] = priceResult;
  if (
    reserve.aToken.toLowerCase() !== configured.aToken.toLowerCase() ||
    reserve.debtToken.toLowerCase() !== configured.debtToken.toLowerCase() ||
    priceDecimals !== 8
  ) {
    throw new Error("Reserve configuration mismatch");
  }

  return {
    asset,
    address: configured.asset,
    aToken: configured.aToken,
    debtToken: configured.debtToken,
    liquidityIndex: reserve.liquidityIndex,
    lastUpdateTimestamp: reserve.lastUpdateTimestamp,
    totalLiquidity: reserve.totalLiquidity,
    totalBorrowed: reserve.totalBorrowed,
    liquidationThreshold: reserve.liquidationThreshold,
    active: reserve.active,
    borrowingEnabled: reserve.borrowingEnabled,
    collateralEnabled: reserve.collateralEnabled,
    price,
    priceDecimals,
    poolLiquidity: poolLiquidity as bigint,
    walletBalance: walletBalance as bigint,
    suppliedBalance: suppliedBalance as bigint,
    scaledSupplyBalance: scaledSupplyBalance as bigint,
    debtBalance: debtBalance as bigint,
    collateralEnabledForUser: collateralEnabledForUser as boolean,
  };
}

function normalizeBridgeSource(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const source = value.trim().toLowerCase();
  if (source.includes("base")) return "Base_Sepolia" as const;
  if (source.includes("polygon") || source.includes("amoy")) {
    return "Polygon_Amoy_Testnet" as const;
  }
  if (source.includes("ethereum") || source === "sepolia") {
    return "Ethereum_Sepolia" as const;
  }
  return null;
}

async function liveBridgeBalance(
  wallet: Address,
  source: keyof typeof externalChains,
) {
  const client = createPublicClient({
    chain: externalChains[source],
    transport: http(undefined, { retryCount: 2, timeout: 12_000 }),
  });
  return client.readContract({
    address: bridgeUsdc[source],
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [wallet],
  });
}

function supportedName(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : "That asset";
}

export async function validateAgentAction(
  action: AgentAction,
  context: ValidationContext,
): Promise<AgentValidationResult> {
  let wallet: Address;
  try {
    if (!context.walletAddress || !isAddress(context.walletAddress)) {
      return invalidContext();
    }
    wallet = getAddress(context.walletAddress);
  } catch {
    return invalidContext();
  }

  const walletKey = wallet.toLowerCase();

  const params = action.params as Record<string, unknown>;

  try {
    if (action.tool === "predict") {
      const amount = parseAmount(params.amount);
      if (amount === null) {
        return hardBlock(walletKey, "That prediction amount isn't valid.");
      }
      const marketId = Number(params.marketId);
      if (
        !Number.isSafeInteger(marketId) ||
        marketId < 1 ||
        marketId > 250
      ) {
        return hardBlock(walletKey, "Choose a valid Arcana market ID.");
      }
      if (params.side !== "YES" && params.side !== "NO") {
        return hardBlock(walletKey, "Choose either YES or NO.");
      }

      const blockNumber = await arcClient.getBlockNumber();
      const [marketCount, marketResult, walletBalance, configuredUsdc] =
        await Promise.all([
          arcClient.readContract({
            address: ARCANA_MARKETS_ADDRESS,
            abi: arcanaMarketsAbi,
            functionName: "marketCount",
            blockNumber,
          }),
          arcClient.readContract({
            address: ARCANA_MARKETS_ADDRESS,
            abi: arcanaMarketsAbi,
            functionName: "getMarket",
            args: [BigInt(marketId)],
            blockNumber,
          }),
          arcClient.readContract({
            address: ARC_USDC_ADDRESS,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [wallet],
            blockNumber,
          }),
          arcClient.readContract({
            address: ARCANA_MARKETS_ADDRESS,
            abi: arcanaMarketsAbi,
            functionName: "usdc",
            blockNumber,
          }),
        ]);

      if (
        BigInt(marketId) > marketCount ||
        configuredUsdc.toLowerCase() !== ARC_USDC_ADDRESS.toLowerCase()
      ) {
        return hardBlock(walletKey, "That Arcana market isn't available.");
      }
      const {
        title,
        endTime,
        resolved,
        cancelled,
      } = marketResult;
      const now = BigInt(Math.floor(Date.now() / 1_000));
      if (!title || resolved || cancelled || now >= endTime) {
        return hardBlock(
          walletKey,
          "That Arcana market is no longer open for predictions.",
        );
      }
      if (amount > walletBalance) {
        return hardBlock(
          walletKey,
          `You only have ${formatUnits(walletBalance, 6)} USDC available.`,
        );
      }

      return {
        valid: true,
        action: {
          ...action,
          params: {
            marketId,
            side: params.side,
            amount: String(params.amount),
            marketTitle: title,
          },
        },
        walletAddress: wallet,
        validatedAt: Date.now(),
      };
    }

    if (action.tool === "mintDomain") {
      if (typeof params.domain !== "string") {
        return hardBlock(walletKey, "Choose a valid .arclend domain to mint.");
      }
      const domain = normalizeDomainName(params.domain);
      if (!domain) {
        return hardBlock(walletKey, "Choose a valid .arclend domain to mint.");
      }

      let tokenId: bigint;
      let registered: boolean;
      try {
        [tokenId, registered] = await Promise.all([
          arcClient.readContract({
            address: walletDomainAddress,
            abi: walletDomainAbi,
            functionName: "tokenIdOf",
            args: [domain],
          }),
          arcClient.readContract({
            address: walletDomainAddress,
            abi: walletDomainAbi,
            functionName: "isRegistered",
            args: [domain],
          }),
        ]);
      } catch {
        return invalidContext(walletKey);
      }

      if (registered) {
        return hardBlock(walletKey, `${displayDomainName(domain)} is already registered.`);
      }

      return {
        valid: true,
        action: {
          ...action,
          params: {
            domain,
            displayDomain: displayDomainName(domain),
            tokenId: tokenId.toString(),
          },
        },
        walletAddress: wallet,
        validatedAt: Date.now(),
      };
    }

    if (action.tool === "burnDomain") {
      if (typeof params.domain !== "string") {
        return hardBlock(walletKey, "Choose a valid .arclend domain to burn.");
      }
      const domain = normalizeDomainName(params.domain);
      if (!domain) {
        return hardBlock(walletKey, "Choose a valid .arclend domain to burn.");
      }

      let tokenId: bigint;
      let owner: Address;
      let listingSeller: Address = ZERO_ADDRESS as Address;
      try {
        tokenId = await arcClient.readContract({
          address: walletDomainAddress,
          abi: walletDomainAbi,
          functionName: "tokenIdOf",
          args: [domain],
        });
        owner = await arcClient.readContract({
          address: walletDomainAddress,
          abi: walletDomainAbi,
          functionName: "ownerOf",
          args: [tokenId],
        });
        if (domainMarketplaceAddress) {
          const listing = marketplaceListingTuple(
            await arcClient.readContract({
              address: domainMarketplaceAddress,
              abi: domainMarketplaceAbi,
              functionName: "listings",
              args: [tokenId],
            }),
          );
          listingSeller = listing.seller;
        }
      } catch {
        return hardBlock(walletKey, `You don't own ${displayDomainName(domain)}.`);
      }

      if (owner.toLowerCase() !== walletKey) {
        return hardBlock(walletKey, `You don't own ${displayDomainName(domain)}.`);
      }
      if (listingSeller.toLowerCase() !== ZERO_ADDRESS) {
        return hardBlock(
          walletKey,
          `${displayDomainName(domain)} is listed for sale. Cancel the listing before burning it.`,
        );
      }

      return {
        valid: true,
        action: {
          ...action,
          params: {
            domain,
            displayDomain: displayDomainName(domain),
            tokenId: tokenId.toString(),
          },
        },
        walletAddress: wallet,
        validatedAt: Date.now(),
      };
    }

    if (action.tool === "listDomain") {
      if (!domainMarketplaceAddress) {
        return hardBlock(walletKey, "Domain marketplace is not deployed.");
      }
      if (typeof params.domain !== "string") {
        return hardBlock(walletKey, "Choose a valid .arclend domain to list.");
      }
      const domain = normalizeDomainName(params.domain);
      if (!domain) {
        return hardBlock(walletKey, "Choose a valid .arclend domain to list.");
      }
      const price = parseAmount(params.price);
      if (price === null) {
        return hardBlock(walletKey, "That listing price isn't valid.");
      }

      let tokenId: bigint;
      let owner: Address;
      let listingSeller: Address;
      try {
        tokenId = await arcClient.readContract({
          address: walletDomainAddress,
          abi: walletDomainAbi,
          functionName: "tokenIdOf",
          args: [domain],
        });
        owner = await arcClient.readContract({
          address: walletDomainAddress,
          abi: walletDomainAbi,
          functionName: "ownerOf",
          args: [tokenId],
        });
        const listing = marketplaceListingTuple(
          await arcClient.readContract({
            address: domainMarketplaceAddress,
            abi: domainMarketplaceAbi,
            functionName: "listings",
            args: [tokenId],
          }),
        );
        listingSeller = listing.seller;
      } catch {
        return hardBlock(walletKey, `You don't own ${displayDomainName(domain)}.`);
      }

      if (owner.toLowerCase() !== walletKey) {
        return hardBlock(walletKey, `You don't own ${displayDomainName(domain)}.`);
      }
      if (listingSeller.toLowerCase() !== ZERO_ADDRESS) {
        return hardBlock(walletKey, `${displayDomainName(domain)} is already listed.`);
      }

      return {
        valid: true,
        action: {
          ...action,
          params: {
            domain,
            price: String(params.price),
            displayDomain: displayDomainName(domain),
            tokenId: tokenId.toString(),
          },
        },
        walletAddress: wallet,
        validatedAt: Date.now(),
      };
    }

    if (action.tool === "delistDomain") {
      if (!domainMarketplaceAddress) {
        return hardBlock(walletKey, "Domain marketplace is not deployed.");
      }
      if (typeof params.domain !== "string") {
        return hardBlock(walletKey, "Choose a valid .arclend domain to delist.");
      }
      const domain = normalizeDomainName(params.domain);
      if (!domain) {
        return hardBlock(walletKey, "Choose a valid .arclend domain to delist.");
      }

      let tokenId: bigint;
      let listingSeller: Address;
      let listingPrice: bigint;
      try {
        tokenId = await arcClient.readContract({
          address: walletDomainAddress,
          abi: walletDomainAbi,
          functionName: "tokenIdOf",
          args: [domain],
        });
        const listing = marketplaceListingTuple(
          await arcClient.readContract({
            address: domainMarketplaceAddress,
            abi: domainMarketplaceAbi,
            functionName: "listings",
            args: [tokenId],
          }),
        );
        listingSeller = listing.seller;
        listingPrice = listing.price;
      } catch {
        return hardBlock(walletKey, `${displayDomainName(domain)} is not listed.`);
      }

      if (listingSeller.toLowerCase() === ZERO_ADDRESS || listingPrice <= 0n) {
        return hardBlock(walletKey, `${displayDomainName(domain)} is not listed.`);
      }
      if (listingSeller.toLowerCase() !== walletKey) {
        return hardBlock(
          walletKey,
          `You are not the seller for ${displayDomainName(domain)}.`,
        );
      }

      return {
        valid: true,
        action: {
          ...action,
          params: {
            domain,
            displayDomain: displayDomainName(domain),
            tokenId: tokenId.toString(),
            price: formatUnits(listingPrice, 6),
          },
        },
        walletAddress: wallet,
        validatedAt: Date.now(),
      };
    }

    if (action.tool === "buyDomain") {
      if (!domainMarketplaceAddress) {
        return hardBlock(walletKey, "Domain marketplace is not deployed.");
      }
      if (typeof params.domain !== "string") {
        return hardBlock(walletKey, "Choose a valid .arclend domain to buy.");
      }
      const domain = normalizeDomainName(params.domain);
      if (!domain) {
        return hardBlock(walletKey, "Choose a valid .arclend domain to buy.");
      }
      const maxPrice =
        params.maxPrice === undefined ? null : parseAmount(params.maxPrice);
      if (params.maxPrice !== undefined && maxPrice === null) {
        return hardBlock(walletKey, "That maximum purchase price isn't valid.");
      }

      let tokenId: bigint;
      let owner: Address;
      let listingSeller: Address;
      let listingPrice: bigint;
      let walletBalance: bigint;
      try {
        tokenId = await arcClient.readContract({
          address: walletDomainAddress,
          abi: walletDomainAbi,
          functionName: "tokenIdOf",
          args: [domain],
        });
        owner = await arcClient.readContract({
          address: walletDomainAddress,
          abi: walletDomainAbi,
          functionName: "ownerOf",
          args: [tokenId],
        });
        const listing = marketplaceListingTuple(
          await arcClient.readContract({
            address: domainMarketplaceAddress,
            abi: domainMarketplaceAbi,
            functionName: "listings",
            args: [tokenId],
          }),
        );
        listingSeller = listing.seller;
        listingPrice = listing.price;
        walletBalance = await arcClient.readContract({
          address: configuredReserves.USDC.asset,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [wallet],
        });
      } catch {
        return hardBlock(walletKey, `${displayDomainName(domain)} is not available to buy.`);
      }

      if (listingSeller.toLowerCase() === ZERO_ADDRESS || listingPrice <= 0n) {
        return hardBlock(walletKey, `${displayDomainName(domain)} is not listed for sale.`);
      }
      if (owner.toLowerCase() !== listingSeller.toLowerCase()) {
        return hardBlock(walletKey, `${displayDomainName(domain)} has a stale marketplace listing.`);
      }
      if (listingSeller.toLowerCase() === walletKey) {
        return hardBlock(walletKey, `You already own the listing for ${displayDomainName(domain)}.`);
      }
      if (maxPrice !== null && listingPrice > maxPrice) {
        return hardBlock(
          walletKey,
          `${displayDomainName(domain)} is listed for ${formatUnits(listingPrice, 6)} USDC, above your max price.`,
        );
      }
      if (listingPrice > walletBalance) {
        return hardBlock(
          walletKey,
          `You only have ${formatUnits(walletBalance, 6)} USDC available.`,
        );
      }

      return {
        valid: true,
        action: {
          ...action,
          params: {
            domain,
            displayDomain: displayDomainName(domain),
            tokenId: tokenId.toString(),
            price: formatUnits(listingPrice, 6),
            seller: listingSeller,
            ...(params.maxPrice ? { maxPrice: String(params.maxPrice) } : {}),
          },
        },
        walletAddress: wallet,
        validatedAt: Date.now(),
      };
    }

    if (action.tool === "bridge") {
      if (params.asset !== "USDC") {
        return hardBlock(
          walletKey,
          `${supportedName(params.asset)} isn't supported on ArcLend.`,
        );
      }
      const amount = parseAmount(params.amount);
      if (amount === null) {
        return hardBlock(walletKey, "That amount isn't valid.");
      }
      const source = normalizeBridgeSource(params.sourceChain);
      if (!source) {
        return invalidContext(walletKey);
      }
      let sourceBalance: bigint;
      try {
        sourceBalance = await liveBridgeBalance(wallet, source);
      } catch {
        return invalidContext(walletKey);
      }
      if (amount > sourceBalance) {
        return hardBlock(
          walletKey,
          `Insufficient balance on ${String(params.sourceChain)} to bridge that amount.`,
        );
      }
      return {
        valid: true,
        action,
        walletAddress: wallet,
        validatedAt: Date.now(),
      };
    }

    if (action.tool === "sendToken") {
      if (!isSwapToken(params.asset)) {
        return hardBlock(
          walletKey,
          `${supportedName(params.asset)} isn't supported for transfers.`,
        );
      }
      const recipientInput =
        typeof params.recipientDomain === "string"
          ? params.recipientDomain
          : params.recipient;
      if (typeof recipientInput !== "string") {
        return hardBlock(walletKey, "The recipient wallet address is invalid.");
      }
      let resolvedRecipient: Awaited<ReturnType<typeof resolveRecipient>>;
      try {
        resolvedRecipient = await resolveRecipient(recipientInput);
      } catch (error) {
        return hardBlock(
          walletKey,
          error instanceof Error && error.message === "unresolved-domain"
            ? `The .arclend domain "${recipientInput}" is not registered.`
            : "The recipient must be a valid 0x address or registered .arclend domain.",
        );
      }
      const recipient = resolvedRecipient.address;
      if (
        recipient === "0x0000000000000000000000000000000000000000" ||
        recipient.toLowerCase() === walletKey
      ) {
        return hardBlock(
          walletKey,
          "Choose a recipient address different from your connected wallet.",
        );
      }
      const token = ARC_DEX_TOKENS[params.asset];
      const amount = parseAmount(params.amount, token.decimals);
      if (amount === null) {
        return hardBlock(walletKey, "That amount isn't valid.");
      }
      let walletBalance: bigint;
      try {
        walletBalance = await arcClient.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [wallet],
        });
      } catch {
        return invalidContext(walletKey);
      }
      if (amount > walletBalance) {
        return hardBlock(
          walletKey,
          `You only have ${formatUnits(walletBalance, token.decimals)} ${params.asset} available to send.`,
        );
      }
      return {
        valid: true,
        action: {
          ...action,
          params: {
            ...params,
            recipient,
            ...(resolvedRecipient.domain
              ? {
                  recipientDomain: `${resolvedRecipient.domain}.arclend`,
                  recipientName:
                    typeof params.recipientName === "string"
                      ? params.recipientName
                      : `${resolvedRecipient.domain}.arclend`,
                }
              : {}),
          } as AgentAction["params"],
        },
        walletAddress: wallet,
        validatedAt: Date.now(),
      };
    }

    const blockNumber = await arcClient.getBlockNumber();
    const [paused, reservesList] = await Promise.all([
        arcClient.readContract({
          address: poolAddress,
          abi: lendingPoolAbi,
          functionName: "paused",
          blockNumber,
        }),
        arcClient.readContract({
          address: poolAddress,
          abi: lendingPoolAbi,
          functionName: "getReservesList",
          blockNumber,
        }),
      ]);

    const liveReserveAddresses = new Set(
      (reservesList as Address[]).map((address) => address.toLowerCase()),
    );
    if (paused) {
      return invalidContext(walletKey);
    }

    const liveAssets = (
      Object.keys(configuredReserves) as LendingAsset[]
    ).filter((asset) =>
      liveReserveAddresses.has(
        configuredReserves[asset].asset.toLowerCase(),
      ),
    );
    const loadRequiredAsset = async (asset: LendingAsset) => {
      if (!liveAssets.includes(asset)) {
        return null;
      }
      try {
        const snapshot = await loadReserveSnapshot(
          arcClient,
          wallet,
          asset,
          blockNumber,
        );
        return snapshot.active ? snapshot : null;
      } catch (error) {
        console.error(
          `[ArcLend agent validator] Failed to load ${asset} context.`,
          error,
        );
        return null;
      }
    };

    if (action.tool === "claimYield") {
      if (
        params.asset !== "USDC" &&
        params.asset !== "EURC" &&
        params.asset !== "ALL"
      ) {
        return hardBlock(
          walletKey,
          `${supportedName(params.asset)} isn't supported on ArcLend.`,
        );
      }

      const requestedAssets =
        params.asset === "ALL"
          ? liveAssets
          : [params.asset as LendingAsset];
      if (requestedAssets.length === 0) {
        return invalidContext(walletKey);
      }

      const block = await arcClient.getBlock({ blockNumber });
      const snapshots = await Promise.all(
        requestedAssets.map(loadRequiredAsset),
      );
      if (snapshots.some((snapshot) => snapshot === null)) {
        return invalidContext(walletKey);
      }

      const completeSnapshots = snapshots as ReserveSnapshot[];
      const supplyRates = await Promise.all(
        completeSnapshots.map((snapshot) =>
          arcClient.readContract({
            address: rateModelAddress,
            abi: rateModelAbi,
            functionName: "calculateSupplyRate",
            args: [snapshot.totalBorrowed, snapshot.totalLiquidity],
            blockNumber,
          }),
        ),
      );
      const claims = completeSnapshots
        .map((snapshot, index) => {
          const currentLiquidityIndex = projectedIndex(
            snapshot.liquidityIndex,
            supplyRates[index] as bigint,
            snapshot.lastUpdateTimestamp,
            block.timestamp,
          );
          const projectedSupplyBalance =
            (snapshot.scaledSupplyBalance * currentLiquidityIndex) / RAY;
          const amount =
            projectedSupplyBalance > snapshot.suppliedBalance
              ? projectedSupplyBalance - snapshot.suppliedBalance
              : 0n;
          return {
            asset: snapshot.asset,
            amount,
          };
        })
        .filter((claim) => claim.amount > 0n);

      if (claims.length === 0) {
        return hardBlock(
          walletKey,
          "You don't have pending supply interest to claim right now.",
        );
      }

      let validatedClaims = claims;
      if (params.claims !== undefined) {
        if (!Array.isArray(params.claims)) {
          return hardBlock(walletKey, "That pending yield claim isn't valid.");
        }
        const currentByAsset = new Map(
          claims.map((claim) => [claim.asset, claim.amount]),
        );
        const requestedClaims: typeof claims = [];
        for (const rawClaim of params.claims) {
          if (!rawClaim || typeof rawClaim !== "object") {
            return hardBlock(walletKey, "That pending yield claim isn't valid.");
          }
          const requestedClaim = rawClaim as Record<string, unknown>;
          if (
            requestedClaim.asset !== "USDC" &&
            requestedClaim.asset !== "EURC"
          ) {
            return hardBlock(
              walletKey,
              `${supportedName(requestedClaim.asset)} isn't supported on ArcLend.`,
            );
          }
          const requestedAmount = parseAmount(requestedClaim.amount);
          const currentAmount = currentByAsset.get(requestedClaim.asset) ?? 0n;
          if (requestedAmount === null || requestedAmount > currentAmount) {
            return hardBlock(
              walletKey,
              "The pending interest estimate changed. Please ask me to prepare the claim again.",
            );
          }
          requestedClaims.push({
            asset: requestedClaim.asset,
            amount: requestedAmount,
          });
        }
        validatedClaims = requestedClaims;
      }

      const amountLabel = validatedClaims
        .map((claim) => `${formatUnits(claim.amount, 6)} ${claim.asset}`)
        .join(" + ");

      return {
        valid: true,
        action: {
          ...action,
          params: {
            asset: params.asset,
            amount: amountLabel,
            claims: validatedClaims.map((claim) => ({
              asset: claim.asset,
              amount: formatUnits(claim.amount, 6),
            })),
          },
        },
        walletAddress: wallet,
        validatedAt: Date.now(),
      };
    }

    if (
      action.tool === "supply" ||
      action.tool === "withdraw" ||
      action.tool === "repay" ||
      action.tool === "borrow"
    ) {
      if (params.asset !== "USDC" && params.asset !== "EURC") {
        return hardBlock(
          walletKey,
          `${supportedName(params.asset)} isn't supported on ArcLend.`,
        );
      }
      const asset = params.asset;
      const amount = parseAmount(params.amount);
      if (amount === null) {
        return hardBlock(walletKey, "That amount isn't valid.");
      }
      const reserve = await loadRequiredAsset(asset);
      if (!reserve) {
        return invalidContext(walletKey);
      }

      if (
        action.tool === "supply" &&
        amount > reserve.walletBalance
      ) {
        return hardBlock(
          walletKey,
          `You only have ${formatUnits(reserve.walletBalance, 6)} ${asset} available.`,
        );
      }
      if (
        action.tool === "withdraw" &&
        amount > reserve.suppliedBalance
      ) {
        return hardBlock(
          walletKey,
          `You only have ${formatUnits(reserve.suppliedBalance, 6)} ${asset} supplied.`,
        );
      }
      if (action.tool === "withdraw") {
        if (amount > reserve.poolLiquidity) {
          return hardBlock(
            walletKey,
            `Only ${formatUnits(reserve.poolLiquidity, 6)} ${asset} is currently liquid in the pool.`,
          );
        }
        try {
          await arcClient.simulateContract({
            account: wallet,
            address: poolAddress,
            abi: lendingPoolAbi,
            functionName: "withdraw",
            args: [reserve.address, amount, wallet],
            blockNumber,
          });
        } catch {
          return hardBlock(
            walletKey,
            "That withdrawal would fail the current liquidity or health-factor checks.",
          );
        }
      }
      if (action.tool === "repay" && amount > reserve.debtBalance) {
        return hardBlock(
          walletKey,
          `Your outstanding ${asset} debt is only ${formatUnits(reserve.debtBalance, 6)}. Repaying more isn't needed.`,
        );
      }
      if (action.tool === "borrow") {
        if (!reserve.borrowingEnabled) {
          return invalidContext(walletKey);
        }

        const snapshots = await Promise.all(
          liveAssets.map(loadRequiredAsset),
        );
        if (snapshots.some((snapshot) => snapshot === null)) {
          return invalidContext(walletKey);
        }
        let accountResult: unknown;
        try {
          accountResult = await arcClient.readContract({
            address: poolAddress,
            abi: lendingPoolAbi,
            functionName: "getUserAccountData",
            args: [wallet],
            blockNumber,
          });
        } catch {
          return invalidContext(walletKey);
        }
        const account = accountTuple(accountResult);
        const completeSnapshots = snapshots as ReserveSnapshot[];
        const borrowValueUsd = (amount * reserve.price) / ASSET_UNIT;
        const availableLiquidity = reserve.poolLiquidity;
        if (amount > availableLiquidity) {
          return hardBlock(
            walletKey,
            "I can't verify your position right now. Please reconnect your wallet and try again.",
          );
        }

        // This reproduces LendingPool.getUserAccountData exactly with live
        // reserve balances, oracle prices, collateral flags, and thresholds.
        const liquidationAdjustedCollateralUsd = completeSnapshots.reduce(
          (sum, item) => {
            if (
              !item.collateralEnabledForUser ||
              !item.collateralEnabled ||
              item.suppliedBalance === 0n
            ) {
              return sum;
            }
            const collateralUsd =
              (item.suppliedBalance * item.price) / ASSET_UNIT;
            return (
              sum +
              (collateralUsd * BigInt(item.liquidationThreshold)) / BPS
            );
          },
          0n,
        );
        const projectedDebtUsd = account.totalDebtUSD + borrowValueUsd;
        const projectedHealth =
          projectedDebtUsd === 0n
            ? (2n ** 256n) - 1n
            : (liquidationAdjustedCollateralUsd * WAD) /
              projectedDebtUsd;
        if (
          borrowValueUsd > account.availableBorrowsUSD ||
          projectedHealth < MIN_HEALTH_FACTOR
        ) {
          return hardBlock(
            walletKey,
            `This borrow would drop your health factor to ${formatUnits(projectedHealth, 18)}, below the minimum safe threshold of 1.10.`,
          );
        }
      }
    } else if (action.tool === "swap") {
      if (!isSwapToken(params.tokenIn)) {
        return hardBlock(
          walletKey,
          `${supportedName(params.tokenIn)} isn't supported on ArcLend.`,
        );
      }
      if (
        !isSwapToken(params.tokenOut) ||
        params.tokenIn === params.tokenOut
      ) {
        return hardBlock(
          walletKey,
          `${supportedName(params.tokenOut)} isn't supported on ArcLend.`,
        );
      }
      const tokenIn = params.tokenIn;
      const tokenOut = params.tokenOut;
      if (
        !isStableSwapPair(tokenIn, tokenOut) &&
        synthraV3FeesForPair(tokenIn, tokenOut).length === 0
      ) {
        return hardBlock(
          walletKey,
          `No direct Arc swap route is available for ${tokenIn}/${tokenOut}.`,
        );
      }
      const inputToken = ARC_DEX_TOKENS[tokenIn];
      const amount = parseAmount(params.amountIn, inputToken.decimals);
      if (amount === null) {
        return hardBlock(walletKey, "That amount isn't valid.");
      }
      const slippageBps = Number(params.slippageBps);
      if (
        !Number.isFinite(slippageBps) ||
        slippageBps < 0 ||
        slippageBps > 500
      ) {
        return hardBlock(
          walletKey,
          "Slippage above 5% isn't allowed for safety. Try a smaller amount or different tokens.",
        );
      }
      let walletBalance: bigint;
      if (tokenIn === "USDC" || tokenIn === "EURC") {
        const inputReserve = await loadRequiredAsset(tokenIn);
        if (!inputReserve) {
          return invalidContext(walletKey);
        }
        walletBalance = inputReserve.walletBalance;
      } else {
        try {
          walletBalance = await arcClient.readContract({
            address: inputToken.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [wallet],
            blockNumber,
          });
        } catch {
          return invalidContext(walletKey);
        }
      }
      if (amount > walletBalance) {
        return hardBlock(
          walletKey,
          `You only have ${formatUnits(walletBalance, inputToken.decimals)} ${tokenIn} available to swap.`,
        );
      }
    } else {
      return hardBlock(
        walletKey,
        "That action isn't supported on ArcLend.",
      );
    }

    return {
      valid: true,
      action,
      walletAddress: wallet,
      validatedAt: Date.now(),
    };
  } catch {
    return invalidContext(walletKey);
  }
}
