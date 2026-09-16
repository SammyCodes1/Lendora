import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const provider = ethers.provider;
  const balance = await provider.getBalance(deployer.address);
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? 50000000000n;

  console.log("=== ARC MAINNET DEPLOYMENT PRE-FLIGHT ===");
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "USDC (raw:", balance.toString(), ")");
  console.log("Current Gas Price:", ethers.formatUnits(gasPrice, "gwei"), "gwei");

  const USDC = "0x3600000000000000000000000000000000000000";
  const EURC = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1";

  const contracts = [
    { name: "LendingPoolAddressesProvider", args: [] },
    { name: "InterestRateModel", args: [] },
    { name: "MockPriceOracle", args: [USDC, EURC] },
    { name: "PositionNFT", args: [] },
    { name: "WalletDomain", args: [] },
    { name: "MultiSend", args: [] },
    { name: "RecurringOrderExecutor", args: [deployer.address] },
    { name: "SwapPool", args: [USDC, EURC, deployer.address] },
    { name: "Lendrop", args: [] },
  ];

  let totalGas = 0n;
  for (const c of contracts) {
    const factory = await ethers.getContractFactory(c.name);
    const deployTx = await factory.getDeployTransaction(...c.args);
    const gas = await provider.estimateGas({ ...deployTx, from: deployer.address });
    console.log(`- ${c.name}: ${gas.toString()} gas (~${ethers.formatEther(gas * gasPrice)} USDC)`);
    totalGas += gas;
  }

  // Also estimate LendingPool, AToken, DebtToken, PositionManager, EarnVault, SpokenPay
  // using dummy addresses for estimation
  const dummy = "0x0000000000000000000000000000000000000001";
  const complex = [
    { name: "LendingPool", args: [dummy, dummy] },
    { name: "AToken", args: [USDC, dummy] },
    { name: "AToken", args: [EURC, dummy] },
    { name: "DebtToken", args: [USDC, dummy] },
    { name: "DebtToken", args: [EURC, dummy] },
    { name: "PositionManager", args: [dummy, dummy] },
    { name: "DomainMarketplace", args: [dummy, USDC] },
    { name: "EarnVault", args: [USDC, dummy, "ArcLend Earn Vault USDC", "evUSDC", deployer.address] },
    { name: "EarnVault", args: [EURC, dummy, "ArcLend Earn Vault EURC", "evEURC", deployer.address] },
    { name: "SpokenPay", args: [dummy, dummy, deployer.address] },
  ];

  for (const c of complex) {
    const factory = await ethers.getContractFactory(c.name);
    const deployTx = await factory.getDeployTransaction(...c.args);
    const gas = await provider.estimateGas({ ...deployTx, from: deployer.address });
    console.log(`- ${c.name}: ${gas.toString()} gas (~${ethers.formatEther(gas * gasPrice)} USDC)`);
    totalGas += gas;
  }

  console.log("========================================");
  console.log("Total Estimated Deployment Gas:", totalGas.toString());
  const totalCost = totalGas * gasPrice;
  console.log("Total Estimated Cost:", ethers.formatEther(totalCost), "USDC");
  console.log("Has Sufficient Balance?", balance >= totalCost ? "YES" : "NO");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
