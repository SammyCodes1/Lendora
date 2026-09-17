import { ethers } from "hardhat";

const ORACLE_ADDRESS = "0xbee561CF55b5976213325EdBa41839b6277908de";
const USDC_ASSET = "0x3600000000000000000000000000000000000000";
const EURC_ASSET = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1";
const USDT_ASSET = "0x175CdB1D338945f0D851A741ccF787D343E57952";
const CIRBTC_ASSET = "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Using deployer:", deployer.address);
  const oracle = await ethers.getContractAt("ChainlinkPriceOracle", ORACLE_ADDRESS);

  // Set USDT fallback price ($1.00 with 8 decimals = 100_000_000)
  console.log("Setting USDT fallback price to $1.00...");
  const txUsdt = await oracle.setFallbackPrice(USDT_ASSET, 100_000_000n);
  await txUsdt.wait();
  console.log("USDT price updated! Tx:", txUsdt.hash);

  // Set cirBTC fallback price ($76,140.00 with 8 decimals = 7614000000000)
  console.log("Setting cirBTC fallback price to $76,140.00...");
  const txBtc = await oracle.setFallbackPrice(CIRBTC_ASSET, 7614000000000n);
  await txBtc.wait();
  console.log("cirBTC price updated! Tx:", txBtc.hash);

  // Set EURC fallback price ($1.08 with 8 decimals = 108_000_000)
  console.log("Setting EURC fallback price to $1.08...");
  const txEurc = await oracle.setFallbackPrice(EURC_ASSET, 108_000_000n);
  await txEurc.wait();
  console.log("EURC price updated! Tx:", txEurc.hash);

  console.log("\n--- Verifying Prices ---");
  for (const [sym, addr] of [
    ["USDC", USDC_ASSET],
    ["EURC", EURC_ASSET],
    ["USDT", USDT_ASSET],
    ["cirBTC", CIRBTC_ASSET],
  ]) {
    const [price, decimals] = await oracle.getPrice(addr);
    console.log(`${sym} price: $${ethers.formatUnits(price, decimals)} (${price.toString()} raw, ${decimals} decimals)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
