import { ethers } from "hardhat";

async function main() {
  const address = "0xACeA761c27A909d4D3895128EBe6370FDE2dF481";
  const code = await ethers.provider.getCode(address);
  console.log("Address:", address);
  console.log("Code length:", code.length);

  // Check ERC-1967 implementation slot
  const implSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const impl = await ethers.provider.getStorage(address, implSlot);
  console.log("ERC-1967 Implementation:", ethers.stripZerosLeft(impl));

  // Check IPyth functions
  const pythAbi = [
    "function getValidTimePeriod() view returns (uint256)",
    "function getPriceUnsafe(bytes32 id) view returns (tuple(int64 price, uint64 conf, int32 expo, uint256 publishTime))",
    "function getUpdateFee(bytes[] calldata updateData) view returns (uint256)"
  ];
  const pyth = new ethers.Contract(address, pythAbi, ethers.provider);

  try {
    const fee = await pyth.getUpdateFee([]);
    console.log("Pyth getUpdateFee([]):", fee.toString());
  } catch (e: any) {
    console.log("getUpdateFee error:", e.message);
  }

  // USDC / USD feed ID: 0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a
  try {
    const usdcFeed = "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";
    const priceData = await pyth.getPriceUnsafe(usdcFeed);
    console.log("Pyth USDC price:", priceData.price.toString(), "expo:", priceData.expo);
  } catch (e: any) {
    console.log("getPriceUnsafe error:", e.message);
  }
}

main().catch(console.error);
