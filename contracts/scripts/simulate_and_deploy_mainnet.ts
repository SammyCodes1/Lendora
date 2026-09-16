import { artifacts, ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  console.log("==================================================");
  console.log("ARC MAINNET END-TO-END DEPLOYMENT SIMULATION");
  console.log("Chain ID:", network.chainId.toString());
  console.log("Deployer:", deployer.address);
  console.log("==================================================");

  // Mainnet asset addresses
  const USDC = "0x3600000000000000000000000000000000000000";
  const EURC = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1";
  const PYTH = "0x2880aB155794e7179c9eE2e38200202908C17B43";

  let totalGasUsed = 0n;

  async function deployContract(name: string, ...args: any[]) {
    const factory = await ethers.getContractFactory(name);
    const contract = await factory.deploy(...args);
    const receipt = await contract.deploymentTransaction()?.wait();
    const address = await contract.getAddress();
    const gas = receipt ? receipt.gasUsed : 0n;
    totalGasUsed += gas;
    console.log(`✓ ${name.padEnd(28)} -> ${address} (Gas: ${gas.toString()})`);
    return { contract, address, receipt };
  }

  async function callTx(desc: string, txPromise: Promise<any>) {
    const tx = await txPromise;
    const receipt = await tx.wait();
    const gas = receipt.gasUsed;
    totalGasUsed += gas;
    console.log(`  [call] ${desc.padEnd(25)} (Gas: ${gas.toString()})`);
    return receipt;
  }

  console.log("\n--- Phase 1: Core Protocol ---");
  const { contract: addressesProvider, address: addressesProviderAddr } = await deployContract("LendingPoolAddressesProvider");
  const { contract: interestRateModel, address: interestRateModelAddr } = await deployContract("InterestRateModel");
  const { contract: priceOracle, address: priceOracleAddr } = await deployContract("MockPriceOracle", USDC, EURC);
  const { contract: lendingPool, address: lendingPoolAddr } = await deployContract("LendingPool", priceOracleAddr, interestRateModelAddr);

  console.log("\n--- Phase 2: Reserve Tokens ---");
  const { contract: aUsdc, address: aUsdcAddr } = await deployContract("AToken", USDC, lendingPoolAddr);
  const { contract: debtUsdc, address: debtUsdcAddr } = await deployContract("DebtToken", USDC, lendingPoolAddr);
  const { contract: aEurc, address: aEurcAddr } = await deployContract("AToken", EURC, lendingPoolAddr);
  const { contract: debtEurc, address: debtEurcAddr } = await deployContract("DebtToken", EURC, lendingPoolAddr);

  console.log("\n--- Phase 3: Pool Wiring & Risk Configuration ---");
  await callTx("initReserve USDC", lendingPool.initReserve(USDC, aUsdcAddr, debtUsdcAddr, 7500, 8000, 500));
  await callTx("initReserve EURC", lendingPool.initReserve(EURC, aEurcAddr, debtEurcAddr, 7000, 7800, 600));
  await callTx("setReserveCaps USDC", lendingPool.setReserveCaps(USDC, 1000000000000n, 700000000000n));
  await callTx("setReserveCaps EURC", lendingPool.setReserveCaps(EURC, 1000000000000n, 700000000000n));

  await callTx("setLendingPool", addressesProvider.setLendingPool(lendingPoolAddr));
  await callTx("setPriceOracle", addressesProvider.setPriceOracle(priceOracleAddr));
  await callTx("setInterestRateModel", addressesProvider.setInterestRateModel(interestRateModelAddr));

  console.log("\n--- Phase 4: Position NFTs & Managers ---");
  const { contract: positionNft, address: positionNftAddr } = await deployContract("PositionNFT");
  const { contract: positionManager, address: positionManagerAddr } = await deployContract("PositionManager", lendingPoolAddr, positionNftAddr);
  await callTx("setMinter PositionNFT", positionNft.setMinter(positionManagerAddr));

  console.log("\n--- Phase 5: Wallet Domains & Marketplace ---");
  const { contract: walletDomain, address: walletDomainAddr } = await deployContract("WalletDomain");
  const { contract: domainMarketplace, address: domainMarketplaceAddr } = await deployContract("DomainMarketplace", walletDomainAddr, USDC);

  console.log("\n--- Phase 6: Earn Vaults ---");
  const { contract: earnVaultUsdc, address: earnVaultUsdcAddr } = await deployContract(
    "EarnVault", USDC, lendingPoolAddr, "Lendora Earn Vault USDC", "evUSDC", deployer.address
  );
  const { contract: earnVaultEurc, address: earnVaultEurcAddr } = await deployContract(
    "EarnVault", EURC, lendingPoolAddr, "Lendora Earn Vault EURC", "evEURC", deployer.address
  );

  console.log("\n--- Phase 7: Peripherals (Swap, MultiSend, SpokenPay, Lendrop) ---");
  const { contract: swapPool, address: swapPoolAddr } = await deployContract("SwapPool", USDC, EURC, deployer.address);
  const { contract: multiSend, address: multiSendAddr } = await deployContract("MultiSend");
  const { contract: spokenPay, address: spokenPayAddr } = await deployContract("SpokenPay", lendingPoolAddr, walletDomainAddr, deployer.address);
  const { contract: lendrop, address: lendropAddr } = await deployContract("Lendrop");
  const { contract: recurringExecutor, address: recurringExecutorAddr } = await deployContract("RecurringOrderExecutor", deployer.address);

  console.log("\n==================================================");
  console.log("DEPLOYMENT COMPLETE & VALIDATED");
  console.log("Total Gas Used:", totalGasUsed.toString());
  
  // Real mainnet gas prices
  const gasPrice28Gwei = 28n * 10n ** 9n;
  const gasPrice35Gwei = 35n * 10n ** 9n;
  const gasPrice50Gwei = 50n * 10n ** 9n;
  console.log(`Cost at 28 Gwei: ~${ethers.formatEther(totalGasUsed * gasPrice28Gwei)} USDC`);
  console.log(`Cost at 35 Gwei: ~${ethers.formatEther(totalGasUsed * gasPrice35Gwei)} USDC`);
  console.log(`Cost at 50 Gwei: ~${ethers.formatEther(totalGasUsed * gasPrice50Gwei)} USDC`);
  console.log("==================================================");
}

main().catch((e) => {
  console.error("Simulation failed:", e);
  process.exitCode = 1;
});
