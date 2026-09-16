import { ethers } from "hardhat";

async function main() {
  const impl = "0xd8f4a467abec64bc944eee1325b9007879b6555b";
  const code = await ethers.provider.getCode(impl);
  console.log("Implementation:", impl);
  console.log("Implementation code length on Arc Mainnet:", code.length);

  // Also check Pyth testnet address from script 15 on Arc mainnet:
  const testnetAddr = "0x2880aB155794e7179c9eE2e38200202908C17B43";
  const testnetCode = await ethers.provider.getCode(testnetAddr);
  console.log("Testnet Pyth address on Arc Mainnet code length:", testnetCode.length);

  // Check Hermes URL for Arc network:
  // Let's test if Pyth Hermes has price updates for Arc
  console.log("Querying Hermes API...");
  const res = await fetch("https://hermes.pyth.network/v2/updates/price/latest?ids[]=0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a");
  const data = await res.json();
  console.log("Hermes price response:", data?.parsed?.[0]?.price);
}

main().catch(console.error);
