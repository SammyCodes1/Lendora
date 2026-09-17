import { createConfig } from 'wagmi'
import { defineChain, fallback, http } from 'viem'
import { arcTestnet, arbitrum, base, mainnet, polygon } from 'viem/chains'
import { injected } from 'wagmi/connectors/injected'
import { walletConnect } from 'wagmi/connectors/walletConnect'

export { arcTestnet, arbitrum, base, mainnet, polygon }

export const arcMainnet = defineChain({
  id: 5042,
  name: 'Arc Mainnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL || 'https://rpc.mainnet.arc.io',
      ],
    },
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: 'https://explorer.arc.io' },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
      blockCreated: 0,
    },
  },
})

export function createArcMainnetTransport() {
  const directUrl = process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL || 'https://rpc.mainnet.arc.io';
  // Use direct RPC with same-origin Next.js proxy fallback for browser reliability
  if (typeof window !== 'undefined') {
    return fallback(
      [
        http(directUrl, { retryCount: 2, timeout: 12_000 }),
        http('/api/rpc/mainnet', { retryCount: 2, timeout: 15_000 }),
      ],
      { retryCount: 1 },
    );
  }
  return http(directUrl, { retryCount: 2, timeout: 15_000 });
}

const arcRpcUrls = [
  process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL,
  'https://rpc.testnet.arc.network',
  'https://rpc.blockdaemon.testnet.arc.network',
  'https://rpc.drpc.testnet.arc.network',
  'https://rpc.quicknode.testnet.arc.network',
].filter((url, index, urls): url is string => Boolean(url) && urls.indexOf(url) === index)

export function createArcTestnetTransport() {
  return fallback(
    arcRpcUrls.map((url) =>
      http(url, { retryCount: 0, timeout: 12_000 }),
    ),
    { retryCount: 1 },
  )
}

const sepolia = defineChain({
  id: 11155111,
  name: 'Sepolia',
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://11155111.rpc.thirdweb.com'] } },
  blockExplorers: { default: { name: 'Etherscan', url: 'https://sepolia.etherscan.io' } },
  testnet: true,
})

const baseSepolia = defineChain({
  id: 84532,
  name: 'Base Sepolia',
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://sepolia.base.org'] } },
  blockExplorers: { default: { name: 'BaseScan', url: 'https://sepolia.basescan.org' } },
  testnet: true,
})

const polygonAmoy = defineChain({
  id: 80002,
  name: 'Polygon Amoy',
  nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc-amoy.polygon.technology'] } },
  blockExplorers: { default: { name: 'PolygonScan', url: 'https://amoy.polygonscan.com' } },
  testnet: true,
})

export const wagmiConfig = createConfig({
  // Defer persisted wallet state until after React hydration so the server
  // and initial client markup remain identical.
  ssr: true,
  chains: [arcMainnet, mainnet, base, polygon, arbitrum, sepolia, baseSepolia, polygonAmoy, arcTestnet],
  connectors: [
    injected(),
    walletConnect({
      projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '',
      // The Telegram Mini App renders its own pairing UX (deep links / QR
      // fallback) inside the WebView, so we suppress the built-in QR modal.
      showQrModal: false,
    }),
  ],
  transports: {
    [arcMainnet.id]: createArcMainnetTransport(),
    [mainnet.id]: http(),
    [base.id]: http(),
    [polygon.id]: http(),
    [arbitrum.id]: http(),
    [arcTestnet.id]: createArcTestnetTransport(),
    [sepolia.id]: http(),
    [baseSepolia.id]: http(),
    [polygonAmoy.id]: http(),
  },
})
