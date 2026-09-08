function capacityFilledPercent(used, cap, isCapped, fallbackUtilization) {
  if (isCapped && cap > 0n) {
    const percent = Number((used * 10_000n) / cap) / 100;
    return Math.max(0, Math.min(100, percent));
  }
  return Math.max(0, Math.min(100, fallbackUtilization));
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

function filterLendoraMarkets(markets, filter) {
  if (filter === "ALL") return markets;
  return markets.filter((market) => market.symbol === filter);
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

const markets = [
  { symbol: "USDC", name: "USD Coin" },
  { symbol: "EURC", name: "Euro Coin" },
];

try {
  const all = filterLendoraMarkets(markets, "ALL");
  if (all.length !== 2) throw new Error(all.length);
  const usdc = filterLendoraMarkets(markets, "USDC");
  if (usdc.length !== 1 || usdc[0].symbol !== "USDC") throw new Error("usdc");
  const eurc = filterLendoraMarkets(markets, "EURC");
  if (eurc.length !== 1 || eurc[0].symbol !== "EURC") throw new Error("eurc");
  if (filterLendoraMarkets(markets, "ALL").some((m) => m.symbol !== "USDC" && m.symbol !== "EURC")) {
    throw new Error("unexpected asset");
  }
  ok("filter USDC/EURC only");
} catch (error) {
  bad("filter USDC/EURC only", error);
}

try {
  const half = capacityFilledPercent(50n, 100n, true, 12);
  if (half !== 50) throw new Error(half);
  const full = capacityFilledPercent(100n, 100n, true, 12);
  if (full !== 100) throw new Error(full);
  const overflow = capacityFilledPercent(150n, 100n, true, 12);
  if (overflow !== 100) throw new Error(overflow);
  const uncapped = capacityFilledPercent(1n, 0n, false, 37.2);
  if (uncapped !== 37.2) throw new Error(uncapped);
  const zeroCap = capacityFilledPercent(10n, 0n, true, 8);
  if (zeroCap !== 8) throw new Error(zeroCap);
  ok("capacity filled percent");
} catch (error) {
  bad("capacity filled percent", error);
}

try {
  const price = 100_000_000n; // $1 at 8 decimals
  const availableUsd = 500_000_000n; // $5
  const byCollateral = (availableUsd * 1_000_000n) / price; // 5e6 = 5 tokens
  const liquidityLimited = maxBorrowableAmount(
    {
      price,
      availableLiquidity: 2_000_000n,
      isBorrowCapped: false,
      remainingBorrowCap: 0n,
    },
    availableUsd,
  );
  if (liquidityLimited !== 2_000_000n) throw new Error("liquidity " + liquidityLimited);
  const collateralLimited = maxBorrowableAmount(
    {
      price,
      availableLiquidity: 9_000_000n,
      isBorrowCapped: false,
      remainingBorrowCap: 0n,
    },
    availableUsd,
  );
  if (collateralLimited !== byCollateral) throw new Error("collateral " + collateralLimited);
  const capLimited = maxBorrowableAmount(
    {
      price,
      availableLiquidity: 9_000_000n,
      isBorrowCapped: true,
      remainingBorrowCap: 1_000_000n,
    },
    availableUsd,
  );
  if (capLimited !== 1_000_000n) throw new Error("cap " + capLimited);
  const zeroPower = maxBorrowableAmount(
    {
      price,
      availableLiquidity: 9_000_000n,
      isBorrowCapped: false,
      remainingBorrowCap: 0n,
    },
    0n,
  );
  if (zeroPower !== 0n) throw new Error("zero " + zeroPower);
  ok("max borrowable amount", "collateral/liquidity/cap");
} catch (error) {
  bad("max borrowable amount", error);
}

console.log("\nResult: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
