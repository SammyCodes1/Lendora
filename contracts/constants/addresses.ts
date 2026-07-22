export const ARC_TESTNET_ADDRESSES = {
  // USDC is native gas on Arc. All gas is paid in USDC, not ETH.
  // EVM compatible: deploy with Hardhat/Foundry, write Solidity normally.
  // Deterministic sub-second finality: no need to wait multiple confirmations.
  // Do NOT use SELFDESTRUCT opcode during deployment (Arc restriction).
  // block.prevrandao is always 0 - never use it for randomness.
  // USDC ERC-20 uses 6 decimals; native gas uses 18 decimals. Never mix.
  // Faucet for testnet USDC: https://faucet.circle.com
  // Block explorer: https://testnet.arcscan.app
  // For DeFi protocols: always use the ERC-20 interface for USDC (6 decimals).
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

export const ARC_TESTNET = {
  chainId: 5042002,
  rpcUrl: "https://rpc.testnet.arc.network",
  explorerUrl: "https://testnet.arcscan.app",
  faucetUrl: "https://faucet.circle.com",
} as const;
