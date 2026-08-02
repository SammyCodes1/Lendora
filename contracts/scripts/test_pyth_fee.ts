import { ethers } from "hardhat";

async function main() {
  const pythAddress = "0x2880aB155794e7179c9eE2e38200202908C17B43";
  const pyth = await ethers.getContractAt([
    "function getUpdateFee(bytes[] calldata updateData) external view returns (uint fee)",
    "function getUpdateFee(uint updateDataSize) external view returns (uint fee)"
  ], pythAddress);

  const res = await fetch("https://hermes.pyth.network/v2/updates/price/latest?ids[]=0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a");
  const data: any = await res.json();
  const updateBytes = data.binary.data.map((d: string) => "0x" + d);
  console.log("Update bytes count:", updateBytes.length, "byte len:", updateBytes[0].length);

  try {
    const fee = await pyth["getUpdateFee(bytes[])"](updateBytes);
    console.log("getUpdateFee(bytes[]) Success! Fee:", fee.toString());
  } catch (err: any) {
    console.error("getUpdateFee(bytes[]) failed:", err.message);
  }
}

main().catch(console.error);
