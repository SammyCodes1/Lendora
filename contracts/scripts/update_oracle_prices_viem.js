const { createWalletClient, createPublicClient, http, parseAbi } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const arcMainnet = {
  id: 5042,
  name: "Arc Mainnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.arc.io"] },
  },
};

const PK = "0xca034aee19e0648054afb16b805e1a0fc34cf6be0274550a12ffdb71f839d0d4";
const account = privateKeyToAccount(PK);

const publicClient = createPublicClient({
  chain: arcMainnet,
  transport: http("https://rpc.mainnet.arc.io", { retryCount: 5, retryDelay: 1000 }),
});

const walletClient = createWalletClient({
  account,
  chain: arcMainnet,
  transport: http("https://rpc.mainnet.arc.io", { retryCount: 5, retryDelay: 1000 }),
});

const ORACLE_ADDRESS = "0xbee561CF55b5976213325EdBa41839b6277908de";
const USDC_ASSET = "0x3600000000000000000000000000000000000000";
const EURC_ASSET = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1";
const USDT_ASSET = "0x175CdB1D338945f0D851A741ccF787D343E57952";
const CIRBTC_ASSET = "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF";

const abi = parseAbi([
  "function setFallbackPrice(address asset, uint256 price) external",
  "function getPrice(address token) external view returns (uint256 price, uint8 decimals)",
]);

async function updateFallback(assetName, assetAddress, price) {
  console.log(`Setting ${assetName} fallback price to ${price.toString()}...`);
  const hash = await walletClient.writeContract({
    address: ORACLE_ADDRESS,
    abi,
    functionName: "setFallbackPrice",
    args: [assetAddress, price],
  });
  console.log(`  Tx sent: ${hash}. Waiting for confirmation...`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  Tx confirmed in block ${receipt.blockNumber}! Status: ${receipt.status}`);
}

async function main() {
  console.log("Using account:", account.address);

  // 1. USDT: $1.00 (100_000_000n = 10^8)
  await updateFallback("USDT", USDT_ASSET, 100_000_000n);

  // 2. cirBTC: $76,140.00 (7614000000000n)
  await updateFallback("cirBTC", CIRBTC_ASSET, 7614000000000n);

  // 3. EURC: $1.08 (108_000_000n)
  await updateFallback("EURC", EURC_ASSET, 108_000_000n);

  console.log("\n--- Verifying Oracle Prices ---");
  for (const [sym, addr] of [
    ["USDC", USDC_ASSET],
    ["EURC", EURC_ASSET],
    ["USDT", USDT_ASSET],
    ["cirBTC", CIRBTC_ASSET],
  ]) {
    const [price, decimals] = await publicClient.readContract({
      address: ORACLE_ADDRESS,
      abi,
      functionName: "getPrice",
      args: [addr],
    });
    const formatted = Number(price) / 10 ** decimals;
    console.log(`${sym}: $${formatted.toLocaleString()} (${price.toString()}, ${decimals} decimals)`);
  }
}

main().catch(console.error);
