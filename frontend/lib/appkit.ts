import { AppKit } from "@circle-fin/app-kit";
import {
  Arbitrum,
  Base,
  Ethereum,
  Polygon,
} from "@circle-fin/app-kit/chains";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { createPublicClient, http, type EIP1193Provider } from "viem";
import { createArcMainnetTransport } from "@/lib/wagmi";

export const ArcMainnet = {
  type: "evm",
  chain: "Arc",
  name: "Arc Mainnet",
  title: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  chainId: 5042,
  isTestnet: false,
  explorerUrl: "https://explorer.arc.io/tx/{hash}",
  rpcEndpoints: [
    process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL || "https://rpc.mainnet.arc.io",
  ],
  eurcAddress: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
  usdcAddress: "0x3600000000000000000000000000000000000000",
  usdtAddress: "0x175CdB1D338945f0D851A741ccF787D343E57952",
  cctp: {
    domain: 26,
    contracts: {
      v2: {
        type: "split",
        tokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
        messageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
        confirmations: 1,
        fastConfirmations: 1,
      },
    },
    forwarderSupported: { source: false, destination: true },
  },
  gateway: {
    domain: 26,
    contracts: {
      v1: { gatewayMinter: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" },
    },
    forwarderSupported: { source: true, destination: true },
  },
} as const;

export const appKit = new AppKit();

export const appKitChains = [
  ArcMainnet as any,
  Ethereum,
  Base,
  Polygon,
  Arbitrum,
];

export function createAppKitAdapter(provider: EIP1193Provider) {
  return createViemAdapterFromProvider({
    provider,
    getPublicClient: ({ chain }) =>
      createPublicClient({
        chain,
        transport:
          chain.id === ArcMainnet.chainId
            ? createArcMainnetTransport()
            : http(chain.rpcUrls.default.http[0], {
                retryCount: 2,
                retryDelay: 1_000,
                timeout: 12_000,
              }),
      }),
    capabilities: {
      addressContext: "user-controlled",
      supportedChains: appKitChains,
    },
  });
}
