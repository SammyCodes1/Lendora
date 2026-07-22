import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const USDC = 10n ** 6n;

async function deployProtocol() {
  const [owner, lender, borrower, liquidator] = await ethers.getSigners();

  const Stablecoin = await ethers.getContractFactory("MockStablecoin");
  const usdc = await Stablecoin.deploy("USD Coin", "USDC");
  const eurc = await Stablecoin.deploy("Euro Coin", "EURC");

  const Oracle = await ethers.getContractFactory("MockPriceOracle");
  const oracle = await Oracle.deploy(await usdc.getAddress(), await eurc.getAddress());

  const RateModel = await ethers.getContractFactory("InterestRateModel");
  const rateModel = await RateModel.deploy();

  const Pool = await ethers.getContractFactory("LendingPool");
  const pool = await Pool.deploy(await oracle.getAddress(), await rateModel.getAddress());
  const poolAddress = await pool.getAddress();

  const AToken = await ethers.getContractFactory("AToken");
  const aUsdc = await AToken.deploy(await usdc.getAddress(), poolAddress);

  const DebtToken = await ethers.getContractFactory("DebtToken");
  const debtUsdc = await DebtToken.deploy(await usdc.getAddress(), poolAddress);
  const aEurc = await AToken.deploy(await eurc.getAddress(), poolAddress);
  const debtEurc = await DebtToken.deploy(await eurc.getAddress(), poolAddress);

  await pool.initReserve(
    await usdc.getAddress(),
    await aUsdc.getAddress(),
    await debtUsdc.getAddress(),
    7500,
    8000,
    500,
  );

  await pool.initReserve(
    await eurc.getAddress(),
    await aEurc.getAddress(),
    await debtEurc.getAddress(),
    7500,
    8000,
    500,
  );

  return {
    owner,
    lender,
    borrower,
    liquidator,
    usdc,
    eurc,
    oracle,
    rateModel,
    pool,
    aUsdc,
    debtUsdc,
    aEurc,
    debtEurc,
  };
}

describe("ArcLend", function () {
  it("rejects fee-on-transfer assets instead of corrupting reserve accounting", async function () {
    const { lender, pool } = await deployProtocol();
    const FeeToken = await ethers.getContractFactory("FeeOnTransferToken");
    const feeToken = await FeeToken.deploy("Fee USD", "fUSD");
    const poolAddress = await pool.getAddress();
    const AToken = await ethers.getContractFactory("AToken");
    const DebtToken = await ethers.getContractFactory("DebtToken");
    const aToken = await AToken.deploy(await feeToken.getAddress(), poolAddress);
    const debtToken = await DebtToken.deploy(await feeToken.getAddress(), poolAddress);

    await pool.initReserve(
      await feeToken.getAddress(),
      await aToken.getAddress(),
      await debtToken.getAddress(),
      7500,
      8000,
      500,
    );

    const amount = 1_000n * USDC;
    await feeToken.mint(lender.address, amount);
    await feeToken.connect(lender).approve(poolAddress, amount);

    await expect(
      pool.connect(lender).supply(await feeToken.getAddress(), amount, lender.address),
    ).to.be.revertedWith("LendingPool: unsupported token");
    expect(await aToken.balanceOf(lender.address)).to.equal(0);
  });

  it("initializes a six-decimal reserve and enforces pause", async function () {
    const { owner, lender, usdc, pool } = await deployProtocol();
    const amount = 1_000n * USDC;

    await usdc.mint(lender.address, amount);
    await usdc.connect(lender).approve(await pool.getAddress(), amount);

    await expect(pool.connect(owner).pause()).to.emit(pool, "Paused");
    await expect(
      pool.connect(lender).supply(await usdc.getAddress(), amount, lender.address),
    ).to.be.revertedWithCustomError(pool, "EnforcedPause");

    await expect(pool.connect(owner).unpause()).to.emit(pool, "Unpaused");
    await expect(pool.connect(lender).supply(await usdc.getAddress(), amount, lender.address))
      .to.emit(pool, "Supply")
      .withArgs(await usdc.getAddress(), lender.address, lender.address, amount);
  });

  it("supports supply, borrow, indexed interest accrual, and full repayment", async function () {
    const { lender, borrower, usdc, pool, aUsdc, debtUsdc } = await deployProtocol();
    const liquidity = 2_000n * USDC;
    const collateral = 1_000n * USDC;
    const borrowed = 500n * USDC;

    await usdc.mint(lender.address, liquidity);
    await usdc.mint(borrower.address, collateral);
    await usdc.connect(lender).approve(await pool.getAddress(), ethers.MaxUint256);
    await usdc.connect(borrower).approve(await pool.getAddress(), ethers.MaxUint256);

    await pool.connect(lender).supply(await usdc.getAddress(), liquidity, lender.address);
    await pool.connect(borrower).supply(await usdc.getAddress(), collateral, borrower.address);
    await pool.connect(borrower).borrow(await usdc.getAddress(), borrowed, borrower.address);

    expect(await debtUsdc.balanceOf(borrower.address)).to.be.closeTo(borrowed, 1n);
    expect(await aUsdc.balanceOf(borrower.address)).to.equal(collateral);

    await time.increase(30 * 24 * 60 * 60);
    await usdc.mint(lender.address, USDC);
    await pool.connect(lender).supply(await usdc.getAddress(), USDC, lender.address);

    const accruedDebt = await debtUsdc.balanceOf(borrower.address);
    expect(accruedDebt).to.be.greaterThan(borrowed);

    await usdc.mint(borrower.address, accruedDebt);
    await expect(
      pool.connect(borrower).repay(await usdc.getAddress(), ethers.MaxUint256, borrower.address),
    ).to.emit(pool, "Repay");
    expect(await debtUsdc.balanceOf(borrower.address)).to.equal(0);
  });

  it("allows debt repayment while the protocol is paused", async function () {
    const { owner, lender, borrower, usdc, pool, debtUsdc } =
      await deployProtocol();
    const liquidity = 1_000n * USDC;
    const borrowed = 100n * USDC;

    await usdc.mint(lender.address, liquidity);
    await usdc.mint(borrower.address, liquidity);
    await usdc.connect(lender).approve(await pool.getAddress(), liquidity);
    await usdc.connect(borrower).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(lender).supply(await usdc.getAddress(), liquidity, lender.address);
    await pool.connect(borrower).supply(await usdc.getAddress(), liquidity, borrower.address);
    await pool.connect(borrower).borrow(await usdc.getAddress(), borrowed, borrower.address);

    await pool.connect(owner).pause();
    await expect(
      pool.connect(borrower).repay(await usdc.getAddress(), borrowed, borrower.address),
    ).to.emit(pool, "Repay");
    expect(await debtUsdc.balanceOf(borrower.address)).to.equal(0);
  });

  it("keeps reserve accounting synchronized with indexed token supplies", async function () {
    const { lender, borrower, usdc, pool, aUsdc, debtUsdc } =
      await deployProtocol();
    const liquidity = 2_000n * USDC;

    await usdc.mint(lender.address, liquidity);
    await usdc.mint(borrower.address, 1_000n * USDC);
    await usdc.connect(lender).approve(await pool.getAddress(), ethers.MaxUint256);
    await usdc.connect(borrower).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(lender).supply(await usdc.getAddress(), liquidity, lender.address);
    await pool.connect(borrower).supply(await usdc.getAddress(), 1_000n * USDC, borrower.address);
    await pool.connect(borrower).borrow(await usdc.getAddress(), 500n * USDC, borrower.address);

    await time.increase(30 * 24 * 60 * 60);
    await usdc.mint(borrower.address, 100n * USDC);
    await pool.connect(borrower).repay(await usdc.getAddress(), 100n * USDC, borrower.address);

    const reserve = await pool.getReserveData(await usdc.getAddress());
    expect(reserve.totalLiquidity).to.equal(await aUsdc.totalSupply());
    expect(reserve.totalBorrowed).to.equal(await debtUsdc.totalSupply());
  });

  it("rejects unauthorized borrow attempts against another user's collateral", async function () {
    const { lender, borrower, usdc, pool, debtUsdc } = await deployProtocol();
    const liquidity = 2_000n * USDC;
    const collateral = 1_000n * USDC;
    const borrowed = 500n * USDC;

    await usdc.mint(lender.address, liquidity);
    await usdc.mint(borrower.address, collateral);
    await usdc.connect(lender).approve(await pool.getAddress(), liquidity);
    await usdc.connect(borrower).approve(await pool.getAddress(), collateral);

    await pool.connect(lender).supply(await usdc.getAddress(), liquidity, lender.address);
    await pool.connect(borrower).supply(await usdc.getAddress(), collateral, borrower.address);

    await expect(
      pool.connect(lender).borrow(await usdc.getAddress(), borrowed, borrower.address),
    ).to.be.revertedWith("LendingPool: unauthorized borrow");
    expect(await debtUsdc.balanceOf(borrower.address)).to.equal(0);
  });

  it("prevents aToken transfers from bypassing collateral health checks", async function () {
    const { lender, borrower, usdc, pool, aUsdc } = await deployProtocol();
    const liquidity = 2_000n * USDC;
    const collateral = 1_000n * USDC;

    await usdc.mint(lender.address, liquidity);
    await usdc.mint(borrower.address, collateral);
    await usdc.connect(lender).approve(await pool.getAddress(), liquidity);
    await usdc.connect(borrower).approve(await pool.getAddress(), collateral);

    await pool.connect(lender).supply(await usdc.getAddress(), liquidity, lender.address);
    await pool.connect(borrower).supply(await usdc.getAddress(), collateral, borrower.address);

    await expect(aUsdc.connect(borrower).transfer(lender.address, collateral)).to.be.revertedWith(
      "AToken: non-transferable",
    );
    await expect(aUsdc.connect(borrower).approve(lender.address, collateral)).to.be.revertedWith(
      "AToken: non-transferable",
    );
  });

  it("enforces oracle price bounds", async function () {
    const { owner, usdc, oracle } = await deployProtocol();

    await expect(
      oracle.connect(owner).setPrice(await usdc.getAddress(), 120_000_000),
    ).to.be.revertedWith("MockPriceOracle: price above bounds");

    await expect(
      oracle.connect(owner).setPriceBounds(await usdc.getAddress(), 90_000_000, 120_000_000),
    ).to.be.revertedWith("MockPriceOracle: bounds too wide");

    await oracle.connect(owner).setPrice(await usdc.getAddress(), 100_500_000);
    expect((await oracle.getPrice(await usdc.getAddress()))[0]).to.equal(100_500_000);
  });

  it("keeps mock prices live by default and supports explicit expiry", async function () {
    const { owner, usdc, oracle } = await deployProtocol();

    await time.increase(2 * 24 * 60 * 60);
    expect((await oracle.getPrice(await usdc.getAddress()))[0]).to.equal(100_000_000);

    await oracle.connect(owner).setMaxPriceAge(60);
    await expect(oracle.getPrice(await usdc.getAddress())).to.be.revertedWith(
      "MockPriceOracle: stale price",
    );
    await oracle.connect(owner).setMaxPriceAge(0);
    expect((await oracle.getPrice(await usdc.getAddress()))[0]).to.equal(100_000_000);
  });

  it("uses a fallback oracle when the primary price expires", async function () {
    const { owner, borrower, usdc, eurc, oracle, pool } = await deployProtocol();
    const Oracle = await ethers.getContractFactory("MockPriceOracle");
    const fallback = await Oracle.deploy(await usdc.getAddress(), await eurc.getAddress());
    await pool.connect(owner).setFallbackPriceOracle(await fallback.getAddress());
    await oracle.connect(owner).setMaxPriceAge(60);

    await usdc.mint(borrower.address, 100n * USDC);
    await usdc.connect(borrower).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(borrower).supply(await usdc.getAddress(), 100n * USDC, borrower.address);
    await time.increase(61);
    await fallback.connect(owner).setPrice(await usdc.getAddress(), 100_000_000);

    expect((await pool.getUserAccountData(borrower.address)).totalCollateralUSD)
      .to.equal(100n * 100_000_000n);
  });

  it("preserves existing collateral and liquidation eligibility after global disable", async function () {
    const { owner, lender, borrower, liquidator, usdc, eurc, oracle, pool } =
      await deployProtocol();

    await usdc.mint(lender.address, 2_000n * USDC);
    await eurc.mint(borrower.address, 1_000n * USDC);
    await usdc.connect(lender).approve(await pool.getAddress(), ethers.MaxUint256);
    await eurc.connect(borrower).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(lender).supply(await usdc.getAddress(), 2_000n * USDC, lender.address);
    await pool.connect(borrower).supply(await eurc.getAddress(), 1_000n * USDC, borrower.address);
    await pool.connect(borrower).borrow(await usdc.getAddress(), 750n * USDC, borrower.address);

    await oracle.connect(owner).setPriceBounds(await eurc.getAddress(), 10_000_000, 12_000_000);
    await oracle.connect(owner).setPrice(await eurc.getAddress(), 10_000_000);
    await pool.connect(owner).setReserveCollateralEnabled(await eurc.getAddress(), false);
    await usdc.mint(liquidator.address, 500n * USDC);
    await usdc.connect(liquidator).approve(await pool.getAddress(), ethers.MaxUint256);

    expect((await pool.getUserAccountData(borrower.address)).totalCollateralUSD).to.be.greaterThan(0);
    await expect(
      pool
        .connect(liquidator)
        .liquidate(await eurc.getAddress(), await usdc.getAddress(), borrower.address, 500n * USDC),
    ).to.emit(pool, "LiquidationCall");
  });

  it("caps liquidation payment to available collateral and writes off only exhausted debt", async function () {
    const {
      owner,
      lender,
      borrower,
      liquidator,
      usdc,
      eurc,
      oracle,
      pool,
      aUsdc,
      debtUsdc,
      aEurc,
    } = await deployProtocol();

    await usdc.mint(lender.address, 2_000n * USDC);
    await eurc.mint(borrower.address, 1_000n * USDC);
    await usdc.connect(lender).approve(await pool.getAddress(), ethers.MaxUint256);
    await eurc.connect(borrower).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(lender).supply(await usdc.getAddress(), 2_000n * USDC, lender.address);
    await pool.connect(borrower).supply(await eurc.getAddress(), 1_000n * USDC, borrower.address);
    await pool.connect(borrower).borrow(await usdc.getAddress(), 750n * USDC, borrower.address);

    await oracle.connect(owner).setPriceBounds(await eurc.getAddress(), 10_000_000, 12_000_000);
    await oracle.connect(owner).setPrice(await eurc.getAddress(), 10_000_000);
    await usdc.mint(liquidator.address, 500n * USDC);
    await usdc.connect(liquidator).approve(await pool.getAddress(), ethers.MaxUint256);

    const liquidatorBefore = await usdc.balanceOf(liquidator.address);
    await pool
      .connect(liquidator)
      .liquidate(await eurc.getAddress(), await usdc.getAddress(), borrower.address, 500n * USDC);
    const paid = liquidatorBefore - (await usdc.balanceOf(liquidator.address));

    expect(paid).to.be.lessThan(500n * USDC);
    expect(paid).to.be.lessThanOrEqual(100n * USDC);
    expect(await aEurc.balanceOf(borrower.address)).to.equal(0);
    expect(await debtUsdc.balanceOf(borrower.address)).to.be.greaterThan(0);

    const supplierClaimsBefore = await aUsdc.totalSupply();
    const badDebtBefore = await debtUsdc.balanceOf(borrower.address);
    await expect(pool.connect(owner).writeOffBadDebt(await usdc.getAddress(), borrower.address))
      .to.emit(pool, "BadDebtWrittenOff");

    expect(await debtUsdc.balanceOf(borrower.address)).to.equal(0);
    expect(await aUsdc.totalSupply()).to.be.closeTo(
      supplierClaimsBefore - badDebtBefore,
      2n,
    );
  });

  it("does not write off debt while any aToken collateral remains", async function () {
    const { owner, lender, borrower, usdc, pool } = await deployProtocol();

    await usdc.mint(lender.address, 2_000n * USDC);
    await usdc.mint(borrower.address, 1_000n * USDC);
    await usdc.connect(lender).approve(await pool.getAddress(), ethers.MaxUint256);
    await usdc.connect(borrower).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(lender).supply(await usdc.getAddress(), 2_000n * USDC, lender.address);
    await pool.connect(borrower).supply(await usdc.getAddress(), 1_000n * USDC, borrower.address);
    await pool.connect(borrower).borrow(await usdc.getAddress(), 500n * USDC, borrower.address);
    await pool.connect(owner).setReserveCollateralEnabled(await usdc.getAddress(), false);

    await expect(
      pool.connect(owner).writeOffBadDebt(await usdc.getAddress(), borrower.address),
    ).to.be.revertedWith("LendingPool: collateral remains");
  });

  it("allows explicit borrow delegation and reserve emergency controls", async function () {
    const { owner, lender, borrower, usdc, pool, debtUsdc } = await deployProtocol();
    const liquidity = 2_000n * USDC;
    const collateral = 1_000n * USDC;
    const borrowed = 100n * USDC;

    await usdc.mint(lender.address, liquidity);
    await usdc.mint(borrower.address, collateral);
    await usdc.connect(lender).approve(await pool.getAddress(), liquidity);
    await usdc.connect(borrower).approve(await pool.getAddress(), collateral);
    await pool.connect(lender).supply(await usdc.getAddress(), liquidity, lender.address);
    await pool.connect(borrower).supply(await usdc.getAddress(), collateral, borrower.address);

    await expect(pool.connect(owner).setReserveBorrowingEnabled(await usdc.getAddress(), false))
      .to.emit(pool, "ReserveBorrowingUpdated")
      .withArgs(await usdc.getAddress(), false);
    await expect(
      pool.connect(borrower).borrow(await usdc.getAddress(), borrowed, borrower.address),
    ).to.be.revertedWith("LendingPool: borrowing disabled");

    await pool.connect(owner).setReserveBorrowingEnabled(await usdc.getAddress(), true);
    await pool.connect(borrower).setBorrowDelegate(lender.address, true);
    await pool.connect(lender).borrow(await usdc.getAddress(), borrowed, borrower.address);
    expect(await debtUsdc.balanceOf(borrower.address)).to.be.closeTo(borrowed, 1n);
  });

  it("enforces owner-configured supply and borrow caps", async function () {
    const { owner, lender, borrower, usdc, pool } = await deployProtocol();
    const poolAddress = await pool.getAddress();
    const asset = await usdc.getAddress();

    await pool.connect(owner).setReserveCaps(asset, 1_000n * USDC, 100n * USDC);
    await usdc.mint(lender.address, 1_001n * USDC);
    await usdc.connect(lender).approve(poolAddress, ethers.MaxUint256);
    await expect(pool.connect(lender).supply(asset, 1_001n * USDC, lender.address))
      .to.be.revertedWith("LendingPool: supply cap exceeded");
    await pool.connect(lender).supply(asset, 1_000n * USDC, lender.address);

    await usdc.mint(borrower.address, 1_000n * USDC);
    await usdc.connect(borrower).approve(poolAddress, ethers.MaxUint256);
    await pool.connect(owner).setReserveCaps(asset, 2_000n * USDC, 100n * USDC);
    await pool.connect(borrower).supply(asset, 1_000n * USDC, borrower.address);
    await expect(pool.connect(borrower).borrow(asset, 101n * USDC, borrower.address))
      .to.be.revertedWith("LendingPool: borrow cap exceeded");
  });

  it("accrues every reserve before replacing the interest rate model", async function () {
    const { owner, lender, borrower, usdc, pool, debtUsdc } = await deployProtocol();
    const asset = await usdc.getAddress();
    await usdc.mint(lender.address, 2_000n * USDC);
    await usdc.mint(borrower.address, 1_000n * USDC);
    await usdc.connect(lender).approve(await pool.getAddress(), ethers.MaxUint256);
    await usdc.connect(borrower).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(lender).supply(asset, 2_000n * USDC, lender.address);
    await pool.connect(borrower).supply(asset, 1_000n * USDC, borrower.address);
    await pool.connect(borrower).borrow(asset, 500n * USDC, borrower.address);
    const debtBefore = await debtUsdc.balanceOf(borrower.address);

    await time.increase(30 * 24 * 60 * 60);
    const RateModel = await ethers.getContractFactory("InterestRateModel");
    const replacement = await RateModel.deploy();
    await pool.connect(owner).setInterestRateModel(await replacement.getAddress());

    expect(await debtUsdc.balanceOf(borrower.address)).to.be.greaterThan(debtBefore);
    expect((await pool.getReserveData(asset)).lastUpdateTimestamp).to.equal(await time.latest());
  });

  it("allows aToken liquidation settlement during a pause and a collateral liquidity shortage", async function () {
    const { owner, lender, borrower, liquidator, usdc, eurc, oracle, pool, aEurc } =
      await deployProtocol();
    const poolAddress = await pool.getAddress();

    await usdc.mint(lender.address, 2_000n * USDC);
    await eurc.mint(borrower.address, 1_000n * USDC);
    await usdc.connect(lender).approve(poolAddress, ethers.MaxUint256);
    await eurc.connect(borrower).approve(poolAddress, ethers.MaxUint256);
    await pool.connect(lender).supply(await usdc.getAddress(), 2_000n * USDC, lender.address);
    await pool.connect(borrower).supply(await eurc.getAddress(), 1_000n * USDC, borrower.address);
    await pool.connect(borrower).borrow(await usdc.getAddress(), 750n * USDC, borrower.address);

    await oracle.connect(owner).setPriceBounds(await eurc.getAddress(), 10_000_000, 12_000_000);
    await oracle.connect(owner).setPrice(await eurc.getAddress(), 10_000_000);
    await usdc.mint(liquidator.address, 500n * USDC);
    await usdc.connect(liquidator).approve(poolAddress, ethers.MaxUint256);
    await pool.connect(owner).pause();

    await expect(
      pool.connect(liquidator)["liquidate(address,address,address,uint256,bool)"](
        await eurc.getAddress(),
        await usdc.getAddress(),
        borrower.address,
        500n * USDC,
        true,
      ),
    ).to.emit(pool, "LiquidationSettledInATokens");
    expect(await aEurc.balanceOf(liquidator.address)).to.be.greaterThan(0);
  });

  it("calculates the expected borrow APR at fifty percent utilization", async function () {
    const { rateModel } = await deployProtocol();
    const perSecond = await rateModel.calculateBorrowRate(500n * USDC, 1_000n * USDC);
    const annualRay = perSecond * 365n * 24n * 60n * 60n;

    expect(annualRay).to.be.closeTo(825n * 10n ** 23n, 365n * 24n * 60n * 60n);
  });
});
