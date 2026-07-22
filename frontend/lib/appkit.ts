import { AppKit } from "@circle-fin/app-kit";
import {
  ArcTestnet,
  BaseSepolia,
  EthereumSepolia,
  PolygonAmoy,
} from "@circle-fin/app-kit/chains";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { createPublicClient, http, type EIP1193Provider } from "viem";
import { createArcTestnetTransport } from "@/lib/wagmi";

export const appKit = new AppKit();

export const appKitChains = [
  ArcTestnet,
  EthereumSepolia,
  BaseSepolia,
  PolygonAmoy,
];

export function createAppKitAdapter(provider: EIP1193Provider) {
  return createViemAdapterFromProvider({
    provider,
    getPublicClient: ({ chain }) =>
      createPublicClient({
        chain,
        transport:
          chain.id === ArcTestnet.chainId
            ? createArcTestnetTransport()
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
