import testnetDeployments from "@/constants/deployments-testnet.json";
import mainnetDeployments from "@/constants/deployments-mainnet.json";

export const ARC_TESTNET_CONTRACTS = {
  USDC: "0x3600000000000000000000000000000000000000",
  EURC: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  USYC: "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C",
  CCTP_TOKEN_MESSENGER_V2: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  CCTP_MESSAGE_TRANSMITTER_V2: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
  GATEWAY_WALLET: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
  PERMIT2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  MULTICALL3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  CREATE2_FACTORY: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
  STABLE_FX_ESCROW: "0x867650F5eAe8df91445971f14d89fd84F0C9a9f8",
} as const;

export const ARC_MAINNET_CONTRACTS = {
  USDC: "0x3600000000000000000000000000000000000000",
  EURC: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
  PERMIT2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  MULTICALL3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  TREASURY: "0x59eA806D4F33c48C68C400392D8D5754621Ea5dd",
} as const;

export const ARCLEND_PROTOCOL_CONTRACTS = {
  LENDING_POOL: mainnetDeployments.lendingPool,
  INTEREST_RATE_MODEL: mainnetDeployments.interestRateModel,
  PRICE_ORACLE: mainnetDeployments.priceOracle,
  WALLET_DOMAIN: mainnetDeployments.WalletDomain,
  TREASURY: mainnetDeployments.Treasury,
} as const;

export const ARC_TESTNET_METADATA = {
  chainId: 5042002,
  rpcUrl: "https://rpc.testnet.arc.network",
  explorerUrl: "https://testnet.arcscan.app",
  faucetUrl: "https://faucet.circle.com",
} as const;

export const ARC_MAINNET_METADATA = {
  chainId: 5042,
  rpcUrl: "https://rpc.mainnet.arc.io",
  explorerUrl: "https://arcscan.app",
} as const;

export function getArcContracts(chainId?: number) {
  return chainId === 5042002 ? ARC_TESTNET_CONTRACTS : ARC_MAINNET_CONTRACTS;
}

export function getArcMetadata(chainId?: number) {
  return chainId === 5042002 ? ARC_TESTNET_METADATA : ARC_MAINNET_METADATA;
}

export function getProtocolContracts(chainId?: number) {
  const dep = chainId === 5042002 ? testnetDeployments : mainnetDeployments;
  return {
    LENDING_POOL: dep.lendingPool,
    INTEREST_RATE_MODEL: dep.interestRateModel,
    PRICE_ORACLE: dep.priceOracle,
    WALLET_DOMAIN: dep.WalletDomain,
    TREASURY: (dep as typeof mainnetDeployments).Treasury,
  };
}
