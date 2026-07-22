import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

const privateKey = process.env.PRIVATE_KEY;
const arcTestnetRpcUrl =
  process.env.ARC_TESTNET_RPC_URL ?? "https://rpc.testnet.arc.network";

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
};

export default config;
