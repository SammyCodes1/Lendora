import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const USDC_USD_FEED_ID =
  "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";
const EUR_USD_FEED_ID =
  "0xa995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b";

describe("PythPriceOracle", function () {
  async function deployFixture() {
    const [owner, stranger] = await ethers.getSigners();

    const MockPyth = await ethers.getContractFactory("MockPyth");
    const pyth = await MockPyth.deploy();

    const Oracle = await ethers.getContractFactory("PythPriceOracle");
    const oracle = await Oracle.deploy(await pyth.getAddress());

    const usdc = "0x3600000000000000000000000000000000000000";
    const eurc = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

    await oracle.setPriceFeedId(usdc, USDC_USD_FEED_ID);
    await oracle.setPriceFeedId(eurc, EUR_USD_FEED_ID);

    const now = await time.latest();
    // USDC ~ $1.00 at 8 decimals (price=100_000_000, expo=-8)
    await pyth.setPrice(USDC_USD_FEED_ID, 100_000_000n, -8, now);
    // EUR ~ $1.08
    await pyth.setPrice(EUR_USD_FEED_ID, 108_000_000n, -8, now);

    return { owner, stranger, pyth, oracle, usdc, eurc };
  }

  it("matches MockPriceOracle getPrice interface (price, 8 decimals)", async function () {
    const { oracle, usdc, eurc } = await deployFixture();

    const [usdcPrice, usdcDecimals] = await oracle.getPrice(usdc);
    expect(usdcDecimals).to.equal(8);
    expect(usdcPrice).to.equal(100_000_000n);

    const [eurcPrice, eurcDecimals] = await oracle.getPrice(eurc);
    expect(eurcDecimals).to.equal(8);
    expect(eurcPrice).to.equal(108_000_000n);
  });

  it("normalizes non-8-decimal Pyth expos to 8 decimals", async function () {
    const { oracle, pyth, usdc } = await deployFixture();
    const now = await time.latest();
    // price=1_000_000, expo=-6 → $1.00 → 100_000_000 at 8 decimals
    await pyth.setPrice(USDC_USD_FEED_ID, 1_000_000n, -6, now);

    const [price, decimals] = await oracle.getPrice(usdc);
    expect(decimals).to.equal(8);
    expect(price).to.equal(100_000_000n);
  });

  it("reverts for unregistered assets", async function () {
    const { oracle } = await deployFixture();
    await expect(
      oracle.getPrice("0x1111111111111111111111111111111111111111"),
    ).to.be.revertedWith("PythPriceOracle: asset not registered");
  });

  it("reverts when Pyth price is stale beyond maxStaleness", async function () {
    const { oracle, usdc } = await deployFixture();
    await time.increase(301);
    await expect(oracle.getPrice(usdc)).to.be.reverted;
  });

  it("refreshPrice is permissionless and refunds overpayment", async function () {
    const { oracle, pyth, stranger } = await deployFixture();
    await pyth.setUpdateFee(5n);

    const balanceBefore = await ethers.provider.getBalance(stranger.address);
    const tx = await oracle
      .connect(stranger)
      .refreshPrice(["0x1234"], { value: 20n });
    const receipt = await tx.wait();
    const gas = (receipt?.gasUsed ?? 0n) * (receipt?.gasPrice ?? 0n);
    const balanceAfter = await ethers.provider.getBalance(stranger.address);

    // Paid 5 fee, refunded 15 → net cost = gas + 5
    expect(balanceBefore - balanceAfter).to.equal(gas + 5n);
    expect(await pyth.updateCount()).to.equal(1n);
  });

  it("only owner can register feeds", async function () {
    const { oracle, stranger } = await deployFixture();
    await expect(
      oracle
        .connect(stranger)
        .setPriceFeedId(
          "0x2222222222222222222222222222222222222222",
          USDC_USD_FEED_ID,
        ),
    ).to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount");
  });

  it("works as LendingPool primary oracle without pool code changes", async function () {
    const { owner, oracle } = await deployFixture();

    const Stablecoin = await ethers.getContractFactory("MockStablecoin");
    const mockUsdc = await Stablecoin.deploy("USD Coin", "USDC");
    const mockEurc = await Stablecoin.deploy("Euro Coin", "EURC");

    // Re-register mock asset addresses on the oracle
    await oracle.setPriceFeedId(await mockUsdc.getAddress(), USDC_USD_FEED_ID);
    await oracle.setPriceFeedId(await mockEurc.getAddress(), EUR_USD_FEED_ID);

    const RateModel = await ethers.getContractFactory("InterestRateModel");
    const rateModel = await RateModel.deploy();

    const Pool = await ethers.getContractFactory("LendingPool");
    const pool = await Pool.deploy(await oracle.getAddress(), await rateModel.getAddress());

    const AToken = await ethers.getContractFactory("AToken");
    const DebtToken = await ethers.getContractFactory("DebtToken");
    const aUsdc = await AToken.deploy(await mockUsdc.getAddress(), await pool.getAddress());
    const debtUsdc = await DebtToken.deploy(await mockUsdc.getAddress(), await pool.getAddress());
    const aEurc = await AToken.deploy(await mockEurc.getAddress(), await pool.getAddress());
    const debtEurc = await DebtToken.deploy(await mockEurc.getAddress(), await pool.getAddress());

    await pool.initReserve(
      await mockUsdc.getAddress(),
      await aUsdc.getAddress(),
      await debtUsdc.getAddress(),
      7500,
      8000,
      500,
    );
    await pool.initReserve(
      await mockEurc.getAddress(),
      await aEurc.getAddress(),
      await debtEurc.getAddress(),
      7500,
      8000,
      500,
    );

    const reserve = await pool.getReserveData(await mockUsdc.getAddress());
    expect(reserve.aToken).to.equal(await aUsdc.getAddress());
    expect(await pool.priceOracle()).to.equal(await oracle.getAddress());

    // Accounting path: _assetToUSD → _getPrice → PythPriceOracle.getPrice
    const [price] = await oracle.getPrice(await mockUsdc.getAddress());
    expect(price).to.equal(100_000_000n);

    // getUserAccountData should not revert when reading Pyth prices for empty user
    const accountData = await pool.getUserAccountData(owner.address);
    expect(accountData.totalCollateralUSD).to.equal(0n);
  });
});
