import { ethers } from "hardhat";

const ORACLE_ADDRESS = "0xbee561CF55b5976213325EdBa41839b6277908de";
const CIRBTC_ASSET = "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF";
const CRCL_ASSET = "0x4352434C00000000000000000000000000000000";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Using deployer:", deployer.address);
  const oracle = await ethers.getContractAt("ChainlinkPriceOracle", ORACLE_ADDRESS);

  // Set cirBTC fallback price ($76,120.00 with 8 decimals = 7612000000000)
  console.log("Setting cirBTC fallback price to $76,120.00...");
  const tx1 = await oracle.setFallbackPrice(CIRBTC_ASSET, 7612000000000n);
  await tx1.wait();
  console.log("cirBTC price updated! Tx:", tx1.hash);

  // Set CRCL fallback price ($81.72 with 8 decimals = 8172000000)
  console.log("Setting CRCL fallback price to $81.72...");
  const tx2 = await oracle.setFallbackPrice(CRCL_ASSET, 8172000000n);
  await tx2.wait();
  console.log("CRCL price updated! Tx:", tx2.hash);

  const [btcPrice, btcDecimals] = await oracle.getPrice(CIRBTC_ASSET);
  console.log("Verified cirBTC price:", ethers.formatUnits(btcPrice, btcDecimals));

  const [crclPrice, crclDecimals] = await oracle.getPrice(CRCL_ASSET);
  console.log("Verified CRCL price:", ethers.formatUnits(crclPrice, crclDecimals));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
