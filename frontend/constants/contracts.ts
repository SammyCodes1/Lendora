import deployments from "@/constants/deployments.json";

export const ARC_TESTNET_CONTRACTS = {
  // USDC is native gas on Arc. Gas uses 18 decimals; ERC-20 USDC uses 6 decimals.
  USDC: "0x3600000000000000000000000000000000000000", // 6 decimals ERC-20 interface, 18 decimals native
  EURC: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", // 6 decimals
  USYC: "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C", // 6 decimals
  CCTP_TOKEN_MESSENGER_V2: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  CCTP_MESSAGE_TRANSMITTER_V2: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
  GATEWAY_WALLET: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
  PERMIT2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  MULTICALL3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  CREATE2_FACTORY: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
  STABLE_FX_ESCROW: "0x867650F5eAe8df91445971f14d89fd84F0C9a9f8",
} as const;

export const ARCLEND_PROTOCOL_CONTRACTS = {
  LENDING_POOL: deployments.lendingPool,
  INTEREST_RATE_MODEL: deployments.interestRateModel,
  PRICE_ORACLE: deployments.priceOracle,
  WALLET_DOMAIN: deployments.WalletDomain,
} as const;

export const ARC_TESTNET_METADATA = {
  chainId: 5042002,
  rpcUrl: "https://rpc.testnet.arc.network",
  explorerUrl: "https://testnet.arcscan.app",
  faucetUrl: "https://faucet.circle.com",
} as const;
