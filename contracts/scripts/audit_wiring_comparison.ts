import fs from "node:fs";
import path from "node:path";
import { ethers } from "hardhat";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function retryCall<T>(fn: () => Promise<T>, retries = 3, waitMs = 300): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      await delay(100);
      return await fn();
    } catch (e: any) {
      if (i === retries - 1) throw e;
      await delay(waitMs * (i + 1));
    }
  }
  throw new Error("Retry failed");
}

async function inspectNetwork(deploymentPath: string, expectedChainId: bigint) {
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  console.log(`\n=======================================================`);
  console.log(`AUDITING ON-CHAIN WIRING FOR CHAIN ${expectedChainId}`);
  console.log(`Manifest: ${deploymentPath}`);
  console.log(`=======================================================`);

  const results: Record<string, any> = {};

  // 1. LendingPoolAddressesProvider
  const addressesProvider = await ethers.getContractAt(
    "LendingPoolAddressesProvider",
    deployment.addressesProvider,
  );
  const ap_pool = await retryCall(() => addressesProvider.getLendingPool());
  const ap_oracle = await retryCall(() => addressesProvider.getPriceOracle());
  const ap_rate = await retryCall(() => addressesProvider.getInterestRateModel());
  results.AddressesProvider = {
    address: deployment.addressesProvider,
    getLendingPool: ap_pool,
    poolMatches: ap_pool.toLowerCase() === deployment.lendingPool.toLowerCase(),
    getPriceOracle: ap_oracle,
    oracleMatches: ap_oracle.toLowerCase() === deployment.priceOracle.toLowerCase(),
    getInterestRateModel: ap_rate,
    rateMatches: ap_rate.toLowerCase() === deployment.interestRateModel.toLowerCase(),
  };

  // 2. LendingPool
  const pool = await ethers.getContractAt("LendingPool", deployment.lendingPool);
  const pool_oracle = await retryCall(() => pool.priceOracle());
  const pool_fallbackOracle = await retryCall(() => pool.fallbackPriceOracle());
  const pool_rate = await retryCall(() => pool.interestRateModel());

  const usdcAsset = deployment.markets.USDC.asset;
  const eurcAsset = deployment.markets.EURC.asset;
  const usdcReserve = await retryCall(() => pool.reserves(usdcAsset));
  const eurcReserve = await retryCall(() => pool.reserves(eurcAsset));
  const usdcSupplyCap = await retryCall(() => pool.supplyCaps(usdcAsset));
  const usdcBorrowCap = await retryCall(() => pool.borrowCaps(usdcAsset));
  const eurcSupplyCap = await retryCall(() => pool.supplyCaps(eurcAsset));
  const eurcBorrowCap = await retryCall(() => pool.borrowCaps(eurcAsset));

  results.LendingPool = {
    address: deployment.lendingPool,
    priceOracle: pool_oracle,
    oracleMatches: pool_oracle.toLowerCase() === deployment.priceOracle.toLowerCase(),
    fallbackPriceOracle: pool_fallbackOracle,
    fallbackMatches: pool_fallbackOracle.toLowerCase() === (deployment.fallbackPriceOracle || "").toLowerCase(),
    interestRateModel: pool_rate,
    rateMatches: pool_rate.toLowerCase() === deployment.interestRateModel.toLowerCase(),
    reserves: {
      USDC: {
        asset: usdcAsset,
        aToken: usdcReserve.aToken,
        aTokenMatches: usdcReserve.aToken.toLowerCase() === deployment.markets.USDC.aToken.toLowerCase(),
        debtToken: usdcReserve.debtToken,
        debtTokenMatches: usdcReserve.debtToken.toLowerCase() === deployment.markets.USDC.debtToken.toLowerCase(),
        isActive: usdcReserve.isActive,
        isBorrowingEnabled: usdcReserve.isBorrowingEnabled,
        isCollateralEnabled: usdcReserve.isCollateralEnabled,
        ltv: Number(usdcReserve.ltv),
        liquidationThreshold: Number(usdcReserve.liquidationThreshold),
        liquidationBonus: Number(usdcReserve.liquidationBonus),
        supplyCap: usdcSupplyCap.toString(),
        borrowCap: usdcBorrowCap.toString(),
      },
      EURC: {
        asset: eurcAsset,
        aToken: eurcReserve.aToken,
        aTokenMatches: eurcReserve.aToken.toLowerCase() === deployment.markets.EURC.aToken.toLowerCase(),
        debtToken: eurcReserve.debtToken,
        debtTokenMatches: eurcReserve.debtToken.toLowerCase() === deployment.markets.EURC.debtToken.toLowerCase(),
        isActive: eurcReserve.isActive,
        isBorrowingEnabled: eurcReserve.isBorrowingEnabled,
        isCollateralEnabled: eurcReserve.isCollateralEnabled,
        ltv: Number(eurcReserve.ltv),
        liquidationThreshold: Number(eurcReserve.liquidationThreshold),
        liquidationBonus: Number(eurcReserve.liquidationBonus),
        supplyCap: eurcSupplyCap.toString(),
        borrowCap: eurcBorrowCap.toString(),
      },
    },
  };

  // 3. Tokens (aTokens and debtTokens)
  const aUsdc = await ethers.getContractAt("AToken", deployment.markets.USDC.aToken);
  const debtUsdc = await ethers.getContractAt("DebtToken", deployment.markets.USDC.debtToken);
  const aEurc = await ethers.getContractAt("AToken", deployment.markets.EURC.aToken);
  const debtEurc = await ethers.getContractAt("DebtToken", deployment.markets.EURC.debtToken);

  results.Tokens = {
    aUSDC: {
      address: deployment.markets.USDC.aToken,
      name: await retryCall(() => aUsdc.name()),
      symbol: await retryCall(() => aUsdc.symbol()),
      pool: await retryCall(() => aUsdc.pool()),
      poolMatches: (await aUsdc.pool()).toLowerCase() === deployment.lendingPool.toLowerCase(),
      underlying: await retryCall(() => aUsdc.underlyingAsset()),
      underlyingMatches: (await aUsdc.underlyingAsset()).toLowerCase() === usdcAsset.toLowerCase(),
      owner: await retryCall(() => aUsdc.owner()),
      renounced: (await aUsdc.owner()) === ethers.ZeroAddress,
    },
    debtUSDC: {
      address: deployment.markets.USDC.debtToken,
      name: await retryCall(() => debtUsdc.name()),
      symbol: await retryCall(() => debtUsdc.symbol()),
      pool: await retryCall(() => debtUsdc.pool()),
      poolMatches: (await debtUsdc.pool()).toLowerCase() === deployment.lendingPool.toLowerCase(),
      underlying: await retryCall(() => debtUsdc.underlyingAsset()),
      underlyingMatches: (await debtUsdc.underlyingAsset()).toLowerCase() === usdcAsset.toLowerCase(),
      owner: await retryCall(() => debtUsdc.owner()),
      renounced: (await debtUsdc.owner()) === ethers.ZeroAddress,
    },
    aEURC: {
      address: deployment.markets.EURC.aToken,
      name: await retryCall(() => aEurc.name()),
      symbol: await retryCall(() => aEurc.symbol()),
      pool: await retryCall(() => aEurc.pool()),
      poolMatches: (await aEurc.pool()).toLowerCase() === deployment.lendingPool.toLowerCase(),
      underlying: await retryCall(() => aEurc.underlyingAsset()),
      underlyingMatches: (await aEurc.underlyingAsset()).toLowerCase() === eurcAsset.toLowerCase(),
      owner: await retryCall(() => aEurc.owner()),
      renounced: (await aEurc.owner()) === ethers.ZeroAddress,
    },
    debtEURC: {
      address: deployment.markets.EURC.debtToken,
      name: await retryCall(() => debtEurc.name()),
      symbol: await retryCall(() => debtEurc.symbol()),
      pool: await retryCall(() => debtEurc.pool()),
      poolMatches: (await debtEurc.pool()).toLowerCase() === deployment.lendingPool.toLowerCase(),
      underlying: await retryCall(() => debtEurc.underlyingAsset()),
      underlyingMatches: (await debtEurc.underlyingAsset()).toLowerCase() === eurcAsset.toLowerCase(),
      owner: await retryCall(() => debtEurc.owner()),
      renounced: (await debtEurc.owner()) === ethers.ZeroAddress,
    },
  };

  // 4. Position NFT & Manager
  const positionNFT = await ethers.getContractAt("PositionNFT", deployment.PositionNFT);
  const positionManager = await ethers.getContractAt("PositionManager", deployment.PositionManager);
  results.Positions = {
    PositionNFT: {
      address: deployment.PositionNFT,
      name: await retryCall(() => positionNFT.name()),
      symbol: await retryCall(() => positionNFT.symbol()),
      minter: await retryCall(() => positionNFT.minter()),
      minterMatches: (await positionNFT.minter()).toLowerCase() === deployment.PositionManager.toLowerCase(),
    },
    PositionManager: {
      address: deployment.PositionManager,
      lendingPool: await retryCall(() => positionManager.lendingPool()),
      poolMatches: (await positionManager.lendingPool()).toLowerCase() === deployment.lendingPool.toLowerCase(),
      positionNFT: await retryCall(() => positionManager.positionNFT()),
      nftMatches: (await positionManager.positionNFT()).toLowerCase() === deployment.PositionNFT.toLowerCase(),
    },
  };

  // 5. WalletDomain & DomainMarketplace
  const walletDomain = await ethers.getContractAt("WalletDomain", deployment.WalletDomain);
  const marketplace = await ethers.getContractAt("DomainMarketplace", deployment.DomainMarketplace);
  results.Domains = {
    WalletDomain: {
      address: deployment.WalletDomain,
      name: await retryCall(() => walletDomain.name()),
      symbol: await retryCall(() => walletDomain.symbol()),
    },
    DomainMarketplace: {
      address: deployment.DomainMarketplace,
      walletDomain: await retryCall(() => marketplace.walletDomain()),
      domainMatches: (await marketplace.walletDomain()).toLowerCase() === deployment.WalletDomain.toLowerCase(),
      paymentToken: await retryCall(() => marketplace.paymentToken()),
      tokenMatches: (await marketplace.paymentToken()).toLowerCase() === usdcAsset.toLowerCase(),
    },
  };

  // 6. Earn Vaults
  const usdcVault = await ethers.getContractAt("EarnVault", deployment.earnVaults.USDC);
  const eurcVault = await ethers.getContractAt("EarnVault", deployment.earnVaults.EURC);
  results.EarnVaults = {
    USDC: {
      address: deployment.earnVaults.USDC,
      name: await retryCall(() => usdcVault.name()),
      symbol: await retryCall(() => usdcVault.symbol()),
      asset: await retryCall(() => usdcVault.asset()),
      assetMatches: (await usdcVault.asset()).toLowerCase() === usdcAsset.toLowerCase(),
      lendingPool: await retryCall(() => usdcVault.lendingPool()),
      poolMatches: (await usdcVault.lendingPool()).toLowerCase() === deployment.lendingPool.toLowerCase(),
      aToken: await retryCall(() => usdcVault.aToken()),
      aTokenMatches: (await usdcVault.aToken()).toLowerCase() === deployment.markets.USDC.aToken.toLowerCase(),
    },
    EURC: {
      address: deployment.earnVaults.EURC,
      name: await retryCall(() => eurcVault.name()),
      symbol: await retryCall(() => eurcVault.symbol()),
      asset: await retryCall(() => eurcVault.asset()),
      assetMatches: (await eurcVault.asset()).toLowerCase() === eurcAsset.toLowerCase(),
      lendingPool: await retryCall(() => eurcVault.lendingPool()),
      poolMatches: (await eurcVault.lendingPool()).toLowerCase() === deployment.lendingPool.toLowerCase(),
      aToken: await retryCall(() => eurcVault.aToken()),
      aTokenMatches: (await eurcVault.aToken()).toLowerCase() === deployment.markets.EURC.aToken.toLowerCase(),
    },
  };

  // 7. SwapPool
  const swapPool = await ethers.getContractAt("SwapPool", deployment.SwapPool);
  results.SwapPool = {
    address: deployment.SwapPool,
    name: await retryCall(() => swapPool.name()),
    symbol: await retryCall(() => swapPool.symbol()),
    tokenA: await retryCall(() => swapPool.tokenA()),
    tokenAMatches: (await swapPool.tokenA()).toLowerCase() === usdcAsset.toLowerCase(),
    tokenB: await retryCall(() => swapPool.tokenB()),
    tokenBMatches: (await swapPool.tokenB()).toLowerCase() === eurcAsset.toLowerCase(),
    feeBps: Number(await retryCall(() => swapPool.feeBps())),
    owner: await retryCall(() => swapPool.owner()),
  };

  // 8. SpokenPay
  const spokenPay = await ethers.getContractAt("SpokenPay", deployment.SpokenPay);
  results.SpokenPay = {
    address: deployment.SpokenPay,
    lendingPool: await retryCall(() => spokenPay.lendingPool()),
    poolMatches: (await spokenPay.lendingPool()).toLowerCase() === deployment.lendingPool.toLowerCase(),
    walletDomain: await retryCall(() => spokenPay.walletDomain()),
    domainsMatches: (await spokenPay.walletDomain()).toLowerCase() === deployment.WalletDomain.toLowerCase(),
    owner: await retryCall(() => spokenPay.owner()),
  };

  // 9. MultiSend & Lendrop/ArcDrop
  const multiSendCode = await retryCall(() => ethers.provider.getCode(deployment.MultiSend));
  const lendropCode = await retryCall(() => ethers.provider.getCode(deployment.ArcDrop));
  const lendrop = await ethers.getContractAt("Lendrop", deployment.ArcDrop);
  results.Peripherals = {
    MultiSend: {
      address: deployment.MultiSend,
      hasCode: multiSendCode.length > 2,
    },
    ArcDrop: {
      address: deployment.ArcDrop,
      hasCode: lendropCode.length > 2,
      name: await retryCall(() => lendrop.name()),
    },
  };

  // 10. RecurringOrderExecutor
  const executor = await ethers.getContractAt("RecurringOrderExecutor", deployment.RecurringOrderExecutor);
  const execOwner = await retryCall(() => executor.owner());
  const isDeployerRelayer = await retryCall(() => executor.relayers(deployment.deployer));
  results.RecurringOrderExecutor = {
    address: deployment.RecurringOrderExecutor,
    owner: execOwner,
    deployerIsRelayer: isDeployerRelayer,
  };

  console.log(JSON.stringify(results, null, 2));
  return results;
}

async function main() {
  const network = await ethers.provider.getNetwork();
  console.log(`Connected to network: ${network.name} (chainId: ${network.chainId})`);

  if (network.chainId === 5042n) {
    const mainnetPath = path.join(__dirname, "..", "deployments", "arc-mainnet.json");
    await inspectNetwork(mainnetPath, 5042n);
  } else if (network.chainId === 5042002n) {
    const testnetPath = path.join(__dirname, "..", "deployments", "arc-testnet.json");
    await inspectNetwork(testnetPath, 5042002n);
  } else {
    throw new Error(`Unsupported network chainId: ${network.chainId}`);
  }
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exitCode = 1;
});
