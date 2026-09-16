import { getDeployment, testnetDeployments, mainnetDeployments } from "../constants/deployments";
import { getMarketDefinitions } from "../lib/markets";
import { ARC_MAINNET_CONTRACTS, ARC_TESTNET_CONTRACTS, getProtocolContracts, getArcContracts } from "../constants/contracts";
import assert from "node:assert";

console.log("==================================================");
console.log("RUNNING ARCLEND DUAL-NETWORK VALIDATION SUITE");
console.log("==================================================");

function ethers_isAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

// Test 1: Check Manifest Schemas & Core Contract Addresses
console.log("\n[Test 1] Manifest Schema & Core Contract Verification");
const coreContractKeys = [
  "addressesProvider",
  "lendingPool",
  "priceOracle",
  "fallbackPriceOracle",
  "interestRateModel",
  "PositionNFT",
  "PositionManager",
  "WalletDomain",
  "DomainMarketplace",
  "SwapPool",
  "MultiSend",
  "SpokenPay",
  "ArcDrop",
  "RecurringOrderExecutor",
] as const;

for (const key of coreContractKeys) {
  const tAddr = (testnetDeployments as any)[key];
  const mAddr = (mainnetDeployments as any)[key];
  assert.ok(tAddr, `Key ${key} missing from testnet deployments`);
  assert.ok(mAddr, `Key ${key} missing from mainnet deployments`);
  assert.ok(ethers_isAddress(tAddr), `Invalid testnet address for ${key}: ${tAddr}`);
  assert.ok(ethers_isAddress(mAddr), `Invalid mainnet address for ${key}: ${mAddr}`);
  assert.notStrictEqual(tAddr.toLowerCase(), mAddr.toLowerCase(), `Addresses for ${key} should differ between chains`);
}
console.log(`✓ Verified all ${coreContractKeys.length} core contracts exist with distinct valid addresses on both chains.`);

// Check Vaults and Markets
assert.ok(ethers_isAddress(testnetDeployments.earnVaults.USDC));
assert.ok(ethers_isAddress(testnetDeployments.earnVaults.EURC));
assert.ok(ethers_isAddress(mainnetDeployments.earnVaults.USDC));
assert.ok(ethers_isAddress(mainnetDeployments.earnVaults.EURC));
console.log("✓ EarnVaults for USDC and EURC verified on both chains.");

// Test 2: Dynamic getDeployment() routing
console.log("\n[Test 2] Dynamic getDeployment() Routing");
const resolvedMainnet = getDeployment(5042);
const resolvedTestnet = getDeployment(5042002);
const resolvedFallback = getDeployment(undefined);

assert.strictEqual(resolvedMainnet.chainId, 5042, "getDeployment(5042) must return chainId 5042");
assert.strictEqual(resolvedTestnet.chainId, 5042002, "getDeployment(5042002) must return chainId 5042002");
assert.strictEqual(resolvedFallback.chainId, 5042002, "getDeployment(undefined) must default to testnet");
assert.notStrictEqual(
  resolvedMainnet.lendingPool,
  resolvedTestnet.lendingPool,
  "Mainnet and Testnet LendingPool addresses must be distinct"
);
console.log(`✓ getDeployment(5042) -> Mainnet (Chain ID 5042, LendingPool: ${resolvedMainnet.lendingPool})`);
console.log(`✓ getDeployment(5042002) -> Testnet (Chain ID 5042002, LendingPool: ${resolvedTestnet.lendingPool})`);

// Test 3: Market Definitions for each chain
console.log("\n[Test 3] Market Definitions for Mainnet vs Testnet");
const mainnetMarkets = getMarketDefinitions(5042);
const testnetMarkets = getMarketDefinitions(5042002);

assert.strictEqual(mainnetMarkets.length, 2, "Mainnet must have 2 markets (USDC & EURC)");
assert.strictEqual(testnetMarkets.length, 2, "Testnet must have 2 markets (USDC & EURC)");

const mainnetUsdc = mainnetMarkets.find(m => m.symbol === "USDC");
const testnetUsdc = testnetMarkets.find(m => m.symbol === "USDC");
assert.ok(mainnetUsdc, "Mainnet USDC market must exist");
assert.ok(testnetUsdc, "Testnet USDC market must exist");
assert.strictEqual(
  mainnetUsdc?.address.toLowerCase(),
  "0x3600000000000000000000000000000000000000".toLowerCase(),
  "Mainnet USDC address must be verified Circle native USDC (0x36...)"
);
assert.strictEqual(
  testnetUsdc?.address.toLowerCase(),
  "0x3600000000000000000000000000000000000000".toLowerCase(),
  "Testnet USDC address is also Circle native USDC (0x36...)"
);
assert.notStrictEqual(
  mainnetUsdc?.aToken.toLowerCase(),
  testnetUsdc?.aToken.toLowerCase(),
  "USDC aToken must differ across networks"
);
assert.notStrictEqual(
  mainnetUsdc?.debtToken.toLowerCase(),
  testnetUsdc?.debtToken.toLowerCase(),
  "USDC debtToken must differ across networks"
);

const mainnetEurc = mainnetMarkets.find(m => m.symbol === "EURC");
const testnetEurc = testnetMarkets.find(m => m.symbol === "EURC");
assert.notStrictEqual(
  mainnetEurc?.address.toLowerCase(),
  testnetEurc?.address.toLowerCase(),
  "EURC underlying address must differ between testnet and mainnet"
);
console.log(`✓ Mainnet USDC underlying: ${mainnetUsdc?.address} (aToken: ${mainnetUsdc?.aToken})`);
console.log(`✓ Testnet USDC underlying: ${testnetUsdc?.address} (aToken: ${testnetUsdc?.aToken})`);
console.log(`✓ Mainnet EURC underlying: ${mainnetEurc?.address} vs Testnet EURC: ${testnetEurc?.address}`);

// Test 4: Dynamic contracts constant mapping
console.log("\n[Test 4] getProtocolContracts() & getArcContracts() Resolution");
const mainnetProtocol = getProtocolContracts(5042);
const testnetProtocol = getProtocolContracts(5042002);
assert.strictEqual(mainnetProtocol.LENDING_POOL, resolvedMainnet.lendingPool);
assert.strictEqual(testnetProtocol.LENDING_POOL, resolvedTestnet.lendingPool);
assert.notStrictEqual(mainnetProtocol.LENDING_POOL, testnetProtocol.LENDING_POOL);

const mainnetTokens = getArcContracts(5042);
const testnetTokens = getArcContracts(5042002);
assert.strictEqual(mainnetTokens.USDC, ARC_MAINNET_CONTRACTS.USDC);
assert.strictEqual(testnetTokens.USDC, ARC_TESTNET_CONTRACTS.USDC);
console.log("✓ getProtocolContracts() & getArcContracts() correctly synchronize with active chain.");

console.log("\n==================================================");
console.log("ALL 4 DUAL-NETWORK VALIDATION CHECKS PASSED (0 ERRORS)");
console.log("==================================================");
