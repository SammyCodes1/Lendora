import { ethers } from "hardhat";

async function main() {
  const impl = "0xd8f4a467abec64bc944eee1325b9007879b6555b";
  const code = await ethers.provider.getCode(impl);
  const bytes = ethers.getBytes(code);
  const selectors: string[] = [];

  // Look for: PUSH4 <selector> (0x63), then DUP2/SWAP1/EQ
  for (let i = 0; i < Math.min(bytes.length, 3000); i++) {
    if (bytes[i] === 0x63 && (bytes[i + 5] === 0x14 || bytes[i + 6] === 0x14 || bytes[i + 7] === 0x14)) {
      selectors.push(ethers.hexlify(bytes.slice(i + 1, i + 5)));
    }
  }

  console.log(`Extracted ${selectors.length} dispatcher selectors:`);
  console.log(selectors);

  // Look up on 4byte directory or common signatures
  for (const sel of selectors) {
    try {
      const res = await fetch(`https://api.openchain.xyz/signature-database/v1/lookup?function=${sel}`);
      const data = await res.json();
      const name = data?.result?.function?.[sel]?.[0]?.name;
      console.log(`  ${sel} -> ${name || "unknown"}`);
    } catch {
      console.log(`  ${sel} -> lookup failed`);
    }
  }
}

main().catch(console.error);
