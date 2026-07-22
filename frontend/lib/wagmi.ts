import { createConfig } from 'wagmi'
import { defineChain, fallback, http } from 'viem'
import { arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors/injected'

export { arcTestnet }

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
  chains: [arcTestnet, sepolia, baseSepolia, polygonAmoy],
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: createArcTestnetTransport(),
    [sepolia.id]: http(),
    [baseSepolia.id]: http(),
    [polygonAmoy.id]: http(),
  },
})
