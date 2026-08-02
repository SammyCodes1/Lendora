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
    arc_testnet: {
      url: arcTestnetRpcUrl,
      chainId: 5042002,
      accounts: privateKey ? [privateKey] : [],
      gasPrice: "auto",
    },
  },
  etherscan: {
    apiKey: {
      arc_testnet: arcscanApiKey,
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
    ],
  },
  sourcify: {
    enabled: false,
  },
};

export default config;
