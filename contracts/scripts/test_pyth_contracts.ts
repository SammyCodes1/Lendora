import { ethers } from "hardhat";

async function main() {
  const pythAbi = [
    "function getValidTimePeriod() view returns (uint256)",
    "function getPriceUnsafe(bytes32 id) view returns (tuple(int64 price, uint64 conf, int32 expo, uint256 publishTime))",
    "function getUpdateFee(bytes[] calldata updateData) view returns (uint256)",
    "function version() view returns (string)",
    "function chainId() view returns (uint256)"
  ];

  const addresses = [
    { name: "Universal EVM (0xACeA...)", addr: "0xACeA761c27A909d4D3895128EBe6370FDE2dF481" },
    { name: "Legacy / Testnet (0x2880...)", addr: "0x2880aB155794e7179c9eE2e38200202908C17B43" }
  ];

  for (const { name, addr } of addresses) {
    console.log(`\n=== Testing ${name} (${addr}) ===`);
    const c = new ethers.Contract(addr, pythAbi, ethers.provider);
    try {
      const p = await c.getValidTimePeriod();
      console.log("  ✓ getValidTimePeriod():", p.toString());
    } catch (e: any) {
      console.log("  ✗ getValidTimePeriod failed:", e.message.slice(0, 100));
    }

    try {
      const v = await c.version();
      console.log("  ✓ version():", v);
    } catch (e: any) {
      console.log("  ✗ version failed:", e.message.slice(0, 100));
    }

    try {
      const fee = await c.getUpdateFee([]);
      console.log("  ✓ getUpdateFee([]):", fee.toString());
    } catch (e: any) {
      console.log("  ✗ getUpdateFee failed:", e.message.slice(0, 100));
    }
  }
}

main().catch(console.error);
