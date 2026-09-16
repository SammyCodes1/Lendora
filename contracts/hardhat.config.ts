import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

const privateKey = process.env.PRIVATE_KEY;
const arcTestnetRpcUrl =
  process.env.ARC_TESTNET_RPC_URL ?? "https://rpc.testnet.arc.network";
// Blockscout/Arcscan does not require a real API key; any non-empty string works.
const arcscanApiKey = process.env.ARCSCAN_API_KEY ?? "arcscan";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: "paris",
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      ...(process.env.FORK === "true"
        ? {
            forking: {
              url: process.env.ARC_MAINNET_RPC_URL ?? "https://rpc.mainnet.arc.io",
            },
          }
        : {}),
      chainId: 5042,
    },
    arc_testnet: {
      url: arcTestnetRpcUrl,
      chainId: 5042002,
      accounts: privateKey ? [privateKey] : [],
      gasPrice: "auto",
    },
    arc_mainnet: {
      url: process.env.ARC_MAINNET_RPC_URL ?? "https://rpc.mainnet.arc.io",
      chainId: 5042,
      accounts: privateKey ? [privateKey] : [],
      gasPrice: "auto",
    },
  },
  etherscan: {
    apiKey: {
      arc_testnet: arcscanApiKey,
      arc_mainnet: arcscanApiKey,
    },
    customChains: [
      {
        network: "arc_testnet",
        chainId: 5042002,
        urls: {
          apiURL: "https://testnet.arcscan.app/api",
          browserURL: "https://testnet.arcscan.app",
        },
      },
      {
        network: "arc_mainnet",
        chainId: 5042,
        urls: {
          apiURL: "https://arcscan.app/api",
          browserURL: "https://arcscan.app",
        },
      },
    ],
  },
  sourcify: {
    enabled: false,
  },
};

export default config;
