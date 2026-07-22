const { createPublicClient, http, formatUnits, parseUnits, fallback, parseAbi } = require("viem");
const { arcTestnet } = require("viem/chains");
const deployments = require("../constants/deployments.json");
const poolAbi = require("../constants/abis/LendingPool.json");

const tokenAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

const client = createPublicClient({
  chain: arcTestnet,
  transport: fallback([
    http("https://rpc.drpc.testnet.arc.network", { retryCount: 0, timeout: 15000 }),
    http("https://rpc.blockdaemon.testnet.arc.network", { retryCount: 0, timeout: 15000 }),
  ], { retryCount: 1 }),
});

const pool = deployments.lendingPool;
const usdc = deployments.markets.USDC;

function reasonFrom(err) {
  const msg = err.shortMessage || err.message || String(err);
  const m1 = msg.match(/LendingPool: [^"'\n]+/);
  if (m1) return m1[0];
  const m2 = msg.match(/reverted with the following reason:\s*(.+)/i);
  if (m2) return m2[1].split("\n")[0].trim();
  return msg.slice(0, 220);
}

async function main() {
  const reserve = await client.readContract({
    address: pool,
    abi: poolAbi,
    functionName: "getReserveData",
    args: [usdc.asset],
  });
  const poolCash = await client.readContract({
    address: usdc.asset,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [pool],
  });
  const aTotal = await client.readContract({
    address: usdc.aToken,
    abi: tokenAbi,
    functionName: "totalSupply",
  });
  const paused = await client.readContract({
    address: pool,
    abi: poolAbi,
    functionName: "paused",
  });

  console.log("=== Pool withdraw constraints ===");
  console.log(JSON.stringify({
    paused,
    totalLiquidity: formatUnits(reserve.totalLiquidity, 6),
    totalBorrowed: formatUnits(reserve.totalBorrowed, 6),
    poolCash: formatUnits(poolCash, 6),
    aTokenTotalSupply: formatUnits(aTotal, 6),
    maxWithdrawByCash: formatUnits(poolCash, 6),
  }, null, 2));

  const user = deployments.deployer;
  const aBal = await client.readContract({
    address: usdc.aToken,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [user],
  });
  const debtBal = await client.readContract({
    address: usdc.debtToken,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [user],
  });
  let account = null;
  try {
    account = await client.readContract({
      address: pool,
      abi: poolAbi,
      functionName: "getUserAccountData",
      args: [user],
    });
  } catch (e) {
    console.log("getUserAccountData failed", reasonFrom(e));
  }
  const collateralEnabled = await client.readContract({
    address: pool,
    abi: poolAbi,
    functionName: "userCollateralEnabled",
    args: [user, usdc.asset],
  });

  console.log("=== User", user, "===");
  console.log(JSON.stringify({
    aTokenBalance: formatUnits(aBal, 6),
    debtBalance: formatUnits(debtBal, 6),
    collateralEnabled,
    totalCollateralUSD: account ? formatUnits(account.totalCollateralUSD, 8) : null,
    totalDebtUSD: account ? formatUnits(account.totalDebtUSD, 8) : null,
    availableBorrowsUSD: account ? formatUnits(account.availableBorrowsUSD, 8) : null,
    healthFactor: account
      ? (account.healthFactor > 10n ** 30n ? "MAX" : formatUnits(account.healthFactor, 18))
      : null,
    uiMaxFormatted2dp: Number(formatUnits(aBal, 6)).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    }),
  }, null, 2));

  const cases = [
    ["FULL_BALANCE", aBal],
    ["HALF", aBal / 2n],
    ["POOL_CASH_CAP", poolCash < aBal ? poolCash : aBal],
    ["1_USDC", parseUnits("1", 6)],
    ["0.01_USDC", parseUnits("0.01", 6)],
  ];

  for (const [label, amount] of cases) {
    if (!amount || amount <= 0n) continue;
    try {
      await client.simulateContract({
        address: pool,
        abi: poolAbi,
        functionName: "withdraw",
        args: [usdc.asset, amount, user],
        account: user,
      });
      console.log("OK ", label, formatUnits(amount, 6));
    } catch (e) {
      console.log("FAIL", label, formatUnits(amount, 6), "=>", reasonFrom(e));
    }
  }

  if (aBal > 0n) {
    let lo = 0n;
    let hi = aBal < poolCash ? aBal : poolCash;
    let best = 0n;
    while (lo <= hi) {
      const mid = (lo + hi) / 2n;
      if (mid === 0n) {
        lo = 1n;
        continue;
      }
      try {
        await client.simulateContract({
          address: pool,
          abi: poolAbi,
          functionName: "withdraw",
          args: [usdc.asset, mid, user],
          account: user,
        });
        best = mid;
        lo = mid + 1n;
      } catch {
        hi = mid - 1n;
      }
    }
    console.log("Max successful withdraw (by sim):", formatUnits(best, 6), "USDC");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
