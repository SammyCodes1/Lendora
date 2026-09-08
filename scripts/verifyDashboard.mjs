import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatUnits } from "viem";

const ASSET_UNIT = 1_000_000n;
const USD_DECIMALS = 8;
const MAX_UINT256 =
  0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn;

function assetUsdValue(amount, price) {
  return (amount * price) / ASSET_UNIT;
}

function dashboardSuppliedMarkets(markets) {
  return markets.filter((market) => market.userSupply > 0n);
}

function dashboardBorrowedMarkets(markets) {
  return markets.filter((market) => market.userDebt > 0n);
}

function dashboardTotals(markets) {
  let suppliedUsd = 0n;
  let borrowedUsd = 0n;
  for (const market of markets) {
    suppliedUsd += assetUsdValue(market.userSupply, market.price);
    borrowedUsd += assetUsdValue(market.userDebt, market.price);
  }
  return {
    suppliedUsd,
    borrowedUsd,
    netWorthUsd: suppliedUsd - borrowedUsd,
  };
}

function dashboardWeightedRate(markets, field, rate) {
  const total = markets.reduce((sum, market) => sum + Number(market[field]), 0);
  if (total === 0) return 0;
  return (
    markets.reduce(
      (sum, market) => sum + Number(market[field]) * market[rate],
      0,
    ) / total
  );
}

function dashboardNetApyPercent(markets) {
  const { netWorthUsd } = dashboardTotals(markets);
  const netWorth = Number(formatUnits(netWorthUsd, USD_DECIMALS));
  if (!(netWorth > 0)) return null;

  const yearlyUsd = markets.reduce((sum, market) => {
    const supplyUsd = Number(
      formatUnits(assetUsdValue(market.userSupply, market.price), USD_DECIMALS),
    );
    const debtUsd = Number(
      formatUnits(assetUsdValue(market.userDebt, market.price), USD_DECIMALS),
    );
    return (
      sum +
      supplyUsd * (market.supplyApyValue / 100) -
      debtUsd * (market.borrowAprValue / 100)
    );
  }, 0);

  return (yearlyUsd / netWorth) * 100;
}

function dashboardHealthFactor(value) {
  if (value === undefined || value === null) return null;
  if (value === MAX_UINT256) return null;
  const numeric = Number(formatUnits(value, 18));
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function dashboardBorrowPowerUsedPercent(totalDebtUsd, availableBorrowsUsd) {
  const capacity = totalDebtUsd + availableBorrowsUsd;
  if (capacity <= 0n) return 0;
  return Number((totalDebtUsd * 10_000n) / capacity) / 100;
}

function maxBorrowableAmount(market, availableUsd) {
  const price = market.price > 0n ? market.price : 1n;
  const availableByCollateral = (availableUsd * 1_000_000n) / price;
  let maxBorrow =
    availableByCollateral < market.availableLiquidity
      ? availableByCollateral
      : market.availableLiquidity;
  if (market.isBorrowCapped && market.remainingBorrowCap < maxBorrow) {
    maxBorrow = market.remainingBorrowCap;
  }
  if (maxBorrow < 0n) return 0n;
  return maxBorrow;
}

let passed = 0;
let failed = 0;
function ok(name, detail = "") {
  passed += 1;
  console.log("PASS  " + name + (detail ? " — " + detail : ""));
}
function bad(name, error) {
  failed += 1;
  console.log("FAIL  " + name + " — " + error);
}

const PRICE = 100_000_000n; // $1, 8 decimals
const usdc = {
  symbol: "USDC",
  userSupply: 100_000_000n, // 100
  userDebt: 40_000_000n, // 40
  price: PRICE,
  supplyApyValue: 5,
  borrowAprValue: 8,
  availableLiquidity: 9_000_000n,
  isBorrowCapped: false,
  remainingBorrowCap: 0n,
};
const eurc = {
  symbol: "EURC",
  userSupply: 0n,
  userDebt: 0n,
  price: PRICE,
  supplyApyValue: 3,
  borrowAprValue: 4,
  availableLiquidity: 2_000_000n,
  isBorrowCapped: true,
  remainingBorrowCap: 1_000_000n,
};
const markets = [usdc, eurc];

try {
  if (markets.some((m) => m.symbol !== "USDC" && m.symbol !== "EURC")) {
    throw new Error("unexpected asset");
  }
  if (markets.length !== 2) throw new Error(markets.length);
  ok("USDC and EURC only");
} catch (error) {
  bad("USDC and EURC only", error);
}

try {
  const supplied = dashboardSuppliedMarkets(markets);
  const borrowed = dashboardBorrowedMarkets(markets);
  if (supplied.length !== 1 || supplied[0].symbol !== "USDC") {
    throw new Error("supplied");
  }
  if (borrowed.length !== 1 || borrowed[0].symbol !== "USDC") {
    throw new Error("borrowed");
  }
  if (dashboardSuppliedMarkets([eurc]).length !== 0) throw new Error("empty supply");
  if (dashboardBorrowedMarkets([eurc]).length !== 0) throw new Error("empty borrow");
  ok("position split hides zero balances");
} catch (error) {
  bad("position split hides zero balances", error);
}

try {
  const totals = dashboardTotals(markets);
  // 100 USDC - 40 USDC = $60 at $1
  if (totals.suppliedUsd !== 10_000_000_000n) throw new Error("supplied " + totals.suppliedUsd);
  if (totals.borrowedUsd !== 4_000_000_000n) throw new Error("borrowed " + totals.borrowedUsd);
  if (totals.netWorthUsd !== 6_000_000_000n) throw new Error("net " + totals.netWorthUsd);
  ok("net worth = supplied USD − borrowed USD");
} catch (error) {
  bad("net worth = supplied USD − borrowed USD", error);
}

try {
  const empty = dashboardTotals([]);
  if (empty.netWorthUsd !== 0n) throw new Error(empty.netWorthUsd);
  if (dashboardNetApyPercent([]) !== null) throw new Error("empty net apy");
  if (dashboardNetApyPercent([eurc]) !== null) throw new Error("zero position net apy");
  ok("empty wallet net APY is —");
} catch (error) {
  bad("empty wallet net APY is —", error);
}

try {
  // $100 @ 5% = $5; $40 @ 8% = $3.20; net $1.80 / $60 = 3%
  const netApy = dashboardNetApyPercent(markets);
  if (netApy === null) throw new Error("null");
  if (Math.abs(netApy - 3) > 1e-9) throw new Error(netApy);
  const supplyOnly = dashboardNetApyPercent([
    { ...usdc, userDebt: 0n },
  ]);
  if (supplyOnly === null || Math.abs(supplyOnly - 5) > 1e-9) {
    throw new Error("supply only " + supplyOnly);
  }
  ok("net APY matches Aave formula", "3.00% mixed, 5.00% supply-only");
} catch (error) {
  bad("net APY matches Aave formula", error);
}

try {
  const supplyRate = dashboardWeightedRate(markets, "userSupply", "supplyApyValue");
  const borrowRate = dashboardWeightedRate(markets, "userDebt", "borrowAprValue");
  if (Math.abs(supplyRate - 5) > 1e-9) throw new Error(supplyRate);
  if (Math.abs(borrowRate - 8) > 1e-9) throw new Error(borrowRate);
  if (dashboardWeightedRate([eurc], "userSupply", "supplyApyValue") !== 0) {
    throw new Error("zero weight");
  }
  ok("weighted supply/borrow APY");
} catch (error) {
  bad("weighted supply/borrow APY", error);
}

try {
  if (dashboardHealthFactor(undefined) !== null) throw new Error("undefined");
  if (dashboardHealthFactor(null) !== null) throw new Error("null");
  if (dashboardHealthFactor(MAX_UINT256) !== null) throw new Error("max uint");
  if (dashboardHealthFactor(0n) !== 0) throw new Error("zero");
  const hf = dashboardHealthFactor(2n * 10n ** 18n);
  if (hf === null || Math.abs(hf - 2) > 1e-9) throw new Error(hf);
  ok("health factor hidden with no borrows, 0 shown when liquidatable");
} catch (error) {
  bad("health factor hidden with no borrows, 0 shown when liquidatable", error);
}

try {
  if (dashboardBorrowPowerUsedPercent(0n, 0n) !== 0) throw new Error("empty");
  if (dashboardBorrowPowerUsedPercent(50n, 50n) !== 50) throw new Error("half");
  if (dashboardBorrowPowerUsedPercent(100n, 0n) !== 100) throw new Error("full");
  if (dashboardBorrowPowerUsedPercent(1n, 3n) !== 25) throw new Error("quarter");
  ok("borrow power used");
} catch (error) {
  bad("borrow power used", error);
}

try {
  const noPower = maxBorrowableAmount(usdc, 0n);
  if (noPower !== 0n) throw new Error("no collateral " + noPower);
  // $500 collateral vs 9 USDC liquidity → liquidity wins.
  const byLiq = maxBorrowableAmount(usdc, 50_000_000_000n);
  if (byLiq !== usdc.availableLiquidity) throw new Error("liq " + byLiq);
  // $5 collateral vs 9 USDC liquidity → collateral wins (5 tokens).
  const byCollateral = maxBorrowableAmount(usdc, 500_000_000n);
  if (byCollateral !== 5_000_000n) throw new Error("collateral " + byCollateral);
  const capped = maxBorrowableAmount(eurc, 50_000_000_000n);
  if (capped !== 1_000_000n) throw new Error("cap " + capped);
  ok("assets-to-borrow available uses collateral/liquidity/cap");
} catch (error) {
  bad("assets-to-borrow available uses collateral/liquidity/cap", error);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scanUi = process.argv.includes("--ui");

if (scanUi) {
  const pages = [
    join(root, "app", "(dashboard)", "dashboard", "page.tsx"),
    join(root, "frontend", "app", "(dashboard)", "dashboard", "page.tsx"),
  ];
  const required = [
    "Net worth",
    "Net APY",
    "Health factor",
    "Your supplies",
    "Your borrows",
    "Assets to supply",
    "Assets to borrow",
    "Nothing supplied yet",
    "Nothing borrowed yet",
    "Wallet balance",
    "Can be collateral",
    "APY, variable",
    "SupplyModal",
    "BorrowModal",
    "RepayModal",
    "WithdrawModal",
    "readPendingSupply",
    "My Transactions",
  ];
  const forbidden = [
    "aUSDC",
    "aEURC",
    "dUSDC",
    "dEURC",
    "aLNDR",
    "debtLNDR",
    "a{market.symbol}",
    "d{market.symbol}",
    "Protocol overview",
    "My Supplied",
    "My Borrowed",
    "Total Value Locked",
  ];

  for (const page of pages) {
    const label = page.slice(root.length + 1);
    let source = "";
    try {
      source = readFileSync(page, "utf8");
    } catch (error) {
      bad("read " + label, error);
      continue;
    }

    try {
      for (const needle of required) {
        if (!source.includes(needle)) throw new Error("missing " + needle);
      }
      ok(label + " Aave V3 sections");
    } catch (error) {
      bad(label + " Aave V3 sections", error);
    }

    try {
      for (const needle of forbidden) {
        if (source.includes(needle)) throw new Error("found " + needle);
      }
      if (/\baToken\b/.test(source)) throw new Error("aToken copy");
      ok(label + " no receipt-token or old protocol chrome");
    } catch (error) {
      bad(label + " no receipt-token or old protocol chrome", error);
    }

    try {
      if (!source.includes('symbol === "USDC"') && !source.includes("USDC") ) {
        throw new Error("no USDC");
      }
      if (!source.includes("EURC")) throw new Error("no EURC");
      if (source.includes("USDT") || source.includes("cirBTC")) {
        throw new Error("extra asset");
      }
      ok(label + " USDC/EURC only");
    } catch (error) {
      bad(label + " USDC/EURC only", error);
    }
  }
}

console.log("\nResult: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
