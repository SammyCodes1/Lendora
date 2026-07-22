import { expect } from "chai";
import { ethers } from "hardhat";

const UNIT = 10n ** 6n;

async function deployFixture() {
  const [owner, lender, borrower, legacyUser] = await ethers.getSigners();

  const Stablecoin = await ethers.getContractFactory("MockStablecoin");
  const usdc = await Stablecoin.deploy("USD Coin", "USDC");
  const eurc = await Stablecoin.deploy("Euro Coin", "EURC");

  const Oracle = await ethers.getContractFactory("MockPriceOracle");
  const oracle = await Oracle.deploy(
    await usdc.getAddress(),
    await eurc.getAddress(),
  );

  const RateModel = await ethers.getContractFactory("InterestRateModel");
  const rateModel = await RateModel.deploy();

  const Pool = await ethers.getContractFactory("LendingPool");
  const pool = await Pool.deploy(
    await oracle.getAddress(),
    await rateModel.getAddress(),
  );

  const AToken = await ethers.getContractFactory("AToken");
  const aUsdc = await AToken.deploy(
    await usdc.getAddress(),
    await pool.getAddress(),
  );
  const DebtToken = await ethers.getContractFactory("DebtToken");
  const debtUsdc = await DebtToken.deploy(
    await usdc.getAddress(),
    await pool.getAddress(),
  );

  await pool.initReserve(
    await usdc.getAddress(),
    await aUsdc.getAddress(),
    await debtUsdc.getAddress(),
    7500,
    8000,
    500,
  );

  const PositionNFT = await ethers.getContractFactory("PositionNFT");
  const positionNFT = await PositionNFT.deploy();
  const PositionManager = await ethers.getContractFactory("PositionManager");
  const positionManager = await PositionManager.deploy(
    await pool.getAddress(),
    await positionNFT.getAddress(),
  );
  await positionNFT.setMinter(await positionManager.getAddress());

  return {
    owner,
    lender,
    borrower,
    legacyUser,
    usdc,
    pool,
    aUsdc,
    debtUsdc,
    positionNFT,
    positionManager,
  };
}

describe("ArcLend Position Receipts", function () {
  it("supplies through the periphery, keeps aTokens with the user, and mints once", async function () {
    const { lender, usdc, aUsdc, positionNFT, positionManager } =
      await deployFixture();
    const amount = 1_000n * UNIT;

    await usdc.mint(lender.address, amount * 2n);
    await usdc
      .connect(lender)
      .approve(await positionManager.getAddress(), amount * 2n);

    await positionManager
      .connect(lender)
      .supply(await usdc.getAddress(), amount);

    expect(await aUsdc.balanceOf(lender.address)).to.equal(amount);
    expect(
      await aUsdc.balanceOf(await positionManager.getAddress()),
    ).to.equal(0);
    expect(
      await positionNFT.userPositionToken(
        lender.address,
        await usdc.getAddress(),
        0,
      ),
    ).to.equal(1);

    await positionManager
      .connect(lender)
      .supply(await usdc.getAddress(), amount);
    expect(await positionNFT.nextTokenId()).to.equal(2);
  });

  it("borrows through the periphery and immediately forwards funds without custody", async function () {
    const {
      lender,
      borrower,
      usdc,
      pool,
      debtUsdc,
      positionNFT,
      positionManager,
    } = await deployFixture();
    const liquidity = 2_000n * UNIT;
    const collateral = 1_000n * UNIT;
    const borrowed = 500n * UNIT;

    await usdc.mint(lender.address, liquidity);
    await usdc.mint(borrower.address, collateral);
    await usdc
      .connect(lender)
      .approve(await positionManager.getAddress(), liquidity);
    await usdc
      .connect(borrower)
      .approve(await positionManager.getAddress(), collateral);
    await positionManager
      .connect(lender)
      .supply(await usdc.getAddress(), liquidity);
    await positionManager
      .connect(borrower)
      .supply(await usdc.getAddress(), collateral);
    await pool
      .connect(borrower)
      .setBorrowDelegate(await positionManager.getAddress(), true);

    const walletBefore = await usdc.balanceOf(borrower.address);
    await positionManager
      .connect(borrower)
      .borrow(await usdc.getAddress(), borrowed);

    const actualDebt = await debtUsdc.balanceOf(borrower.address);
    expect(await usdc.balanceOf(borrower.address)).to.equal(
      walletBefore + actualDebt,
    );
    expect(
      await usdc.balanceOf(await positionManager.getAddress()),
    ).to.equal(0);
    expect(actualDebt).to.be.closeTo(borrowed, 1n);
    expect(
      await positionNFT.userPositionToken(
        borrower.address,
        await usdc.getAddress(),
        1,
      ),
    ).to.not.equal(0);
  });

  it("allows legacy users to claim, exposes inline metadata, and closes only at zero balance", async function () {
    const {
      legacyUser,
      usdc,
      pool,
      aUsdc,
      positionNFT,
      positionManager,
    } = await deployFixture();
    const amount = 100n * UNIT;

    await usdc.mint(legacyUser.address, amount);
    await usdc
      .connect(legacyUser)
      .approve(await pool.getAddress(), amount);
    await pool
      .connect(legacyUser)
      .supply(await usdc.getAddress(), amount, legacyUser.address);

    await expect(
      positionManager
        .connect(legacyUser)
        .claimExistingPosition(await usdc.getAddress(), 0),
    ).to.not.be.reverted;
    const tokenId = await positionNFT.userPositionToken(
      legacyUser.address,
      await usdc.getAddress(),
      0,
    );
    const uri = await positionNFT.tokenURI(tokenId);
    expect(uri).to.match(/^data:application\/json;base64,/);

    const metadata = JSON.parse(
      Buffer.from(uri.split(",")[1], "base64").toString("utf8"),
    );
    expect(metadata.name).to.include("SUPPLY USDC");
    expect(metadata.image).to.match(/^data:image\/svg\+xml;base64,/);

    await expect(
      positionManager
        .connect(legacyUser)
        .closePosition(await usdc.getAddress(), 0),
    ).to.be.revertedWith("Position still open");

    await pool
      .connect(legacyUser)
      .withdraw(await usdc.getAddress(), await aUsdc.balanceOf(legacyUser.address), legacyUser.address);
    await positionManager
      .connect(legacyUser)
      .closePosition(await usdc.getAddress(), 0);
    expect(
      await positionNFT.userPositionToken(
        legacyUser.address,
        await usdc.getAddress(),
        0,
      ),
    ).to.equal(0);
  });

  it("locks initial minter setup but supports two-step recovery", async function () {
    const { owner, lender, legacyUser, positionNFT, positionManager } = await deployFixture();
    await expect(
      positionNFT.connect(owner).setMinter(await positionManager.getAddress()),
    ).to.be.revertedWith("Minter already set");

    await positionNFT.connect(owner).proposeMinter(legacyUser.address);
    await expect(positionNFT.connect(lender).acceptMinter()).to.be.revertedWith(
      "Only pending minter",
    );
    await positionNFT.connect(legacyUser).acceptMinter();
    expect(await positionNFT.minter()).to.equal(legacyUser.address);
    expect(await positionNFT.pendingMinter()).to.equal(ethers.ZeroAddress);
  });

  it("prevents position receipt transfers", async function () {
    const { lender, borrower, usdc, positionNFT, positionManager } =
      await deployFixture();
    const amount = 100n * UNIT;

    await usdc.mint(lender.address, amount);
    await usdc.connect(lender).approve(await positionManager.getAddress(), amount);
    await positionManager.connect(lender).supply(await usdc.getAddress(), amount);

    const tokenId = await positionNFT.userPositionToken(
      lender.address,
      await usdc.getAddress(),
      0,
    );
    await expect(
      positionNFT
        .connect(lender)
        .transferFrom(lender.address, borrower.address, tokenId),
    ).to.be.revertedWithCustomError(positionNFT, "PositionReceiptNonTransferable");
  });
});
