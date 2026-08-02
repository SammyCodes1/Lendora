import { NextResponse } from 'next/server';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import deployments from '@/constants/deployments.json';

export const dynamic = 'force-dynamic';

// Arc Testnet chain configuration (matches existing DCA listener pattern)
const arcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  network: 'arc-testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'USDC',
    symbol: 'USDC',
  },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.arc.network'] },
    public: { http: ['https://rpc.testnet.arc.network'] },
  },
} as const;

// Pyth price feed IDs (confirmed from https://pyth.network/developers/price-feed-ids)
const PRICE_FEED_IDS = [
  'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a', // USDC/USD
  'a995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b', // EUR/USD
];

// PythPriceOracle ABI (only the functions we need)
const PYTH_ORACLE_ABI = [
  {
    inputs: [{ name: 'priceUpdateData', type: 'bytes[]' }],
    name: 'refreshPrice',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [{ name: 'priceUpdateData', type: 'bytes[]' }],
    name: 'getRefreshFee',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const HERMES_URL = process.env.PYTH_HERMES_URL || 'https://hermes.pyth.network';

export async function GET(request: Request) {
  // ── Auth: same CRON_SECRET pattern as DCA keeper ──
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const oracleAddress = (deployments as any).PythPriceOracle as `0x${string}` | undefined;
    if (!oracleAddress) {
      return NextResponse.json(
        { error: 'PythPriceOracle not found in deployments.json' },
        { status: 500 },
      );
    }

    const keeperKey = process.env.KEEPER_PRIVATE_KEY || process.env.PRIVATE_KEY;
    if (!keeperKey) {
      return NextResponse.json(
        { error: 'KEEPER_PRIVATE_KEY or PRIVATE_KEY not set' },
        { status: 500 },
      );
    }

    // ── Fetch latest price data from Pyth Hermes ──
    const hermesUrl =
      `${HERMES_URL}/v2/updates/price/latest?` +
      PRICE_FEED_IDS.map((id) => `ids[]=${id}`).join('&');

    const hermesResponse = await fetch(hermesUrl);
    if (!hermesResponse.ok) {
      return NextResponse.json(
        {
          error: `Hermes API error: ${hermesResponse.status}`,
          detail: await hermesResponse.text(),
        },
        { status: 502 },
      );
    }

    const hermesData = await hermesResponse.json();
    const updateData: `0x${string}`[] = hermesData.binary.data.map(
      (d: string) => `0x${d}` as `0x${string}`,
    );

    // ── Set up viem clients ──
    const publicClient = createPublicClient({
      chain: arcTestnet,
      transport: http(),
    });

    const account = privateKeyToAccount(`0x${keeperKey.replace('0x', '')}` as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain: arcTestnet,
      transport: http(),
    });

    // ── Get update fee ──
    const fee = await publicClient.readContract({
      address: oracleAddress,
      abi: PYTH_ORACLE_ABI,
      functionName: 'getRefreshFee',
      args: [updateData],
    });

    // ── Submit refresh transaction ──
    const hash = await walletClient.writeContract({
      address: oracleAddress,
      abi: PYTH_ORACLE_ABI,
      functionName: 'refreshPrice',
      args: [updateData],
      value: fee,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    console.log(`[Oracle Keeper] Price refresh tx: ${hash}, gas: ${receipt.gasUsed}`);

    return NextResponse.json({
      success: true,
      txHash: hash,
      gasUsed: receipt.gasUsed.toString(),
      feedsUpdated: PRICE_FEED_IDS.length,
      feeCharged: fee.toString(),
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[Oracle Keeper] Error refreshing prices:', error);
    return NextResponse.json(
      {
        error: 'Failed to refresh oracle prices',
        detail: error.message?.slice(0, 200),
      },
      { status: 500 },
    );
  }
}
