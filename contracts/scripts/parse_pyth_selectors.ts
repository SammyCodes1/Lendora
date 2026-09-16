import { ethers } from "hardhat";

async function main() {
  const impl = "0xd8f4a467abec64bc944eee1325b9007879b6555b";
  const code = await ethers.provider.getCode(impl);
  console.log("Implementation bytecode length:", code.length);

  // Scan bytecode for PUSH4 (0x63) followed by EQ or JUMPI
  const selectors = new Set<string>();
  const bytes = ethers.getBytes(code);
  for (let i = 0; i < bytes.length - 5; i++) {
    if (bytes[i] === 0x63) { // PUSH4
      const sel = ethers.hexlify(bytes.slice(i + 1, i + 5));
      selectors.add(sel);
    }
  }

  console.log(`Found ${selectors.size} potential selectors in implementation.`);

  // Test known Pyth and Wormhole function signatures against selectors
  const signatures = [
    "updatePriceFeeds(bytes[])",
    "updatePriceFeedsIfNecessary(bytes[],bytes32[],uint64[])",
    "getUpdateFee(bytes[])",
    "getUpdateFee(uint256)",
    "getPrice(bytes32)",
    "getEmaPrice(bytes32)",
    "getPriceUnsafe(bytes32)",
    "getPriceNoOlderThan(bytes32,uint256)",
    "getEmaPriceUnsafe(bytes32)",
    "getEmaPriceNoOlderThan(bytes32,uint256)",
    "getValidTimePeriod()",
    "version()",
    "chainId()",
    "governanceDataSource()",
    "lastExecutedSequence()",
    // Wormhole receiver
    "parseAndVerifyVM(bytes)",
    "verifyVM(bytes)",
    // Proxy / Admin
    "upgradeTo(address)",
    "upgradeToAndCall(address,bytes)",
    "implementation()"
  ];

  for (const sig of signatures) {
    const hash = ethers.id(sig).slice(0, 10);
    if (selectors.has(hash)) {
      console.log(`  MATCH: ${sig} -> ${hash}`);
    }
  }
}

main().catch(console.error);
