import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const USDC = 10n ** 6n;

async function deployProtocol() {
  const [owner, lender, borrower] = await ethers.getSigners();

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

  await pool.initReserve(
    await usdc.getAddress(),
    await aUsdc.getAddress(),
    await debtUsdc.getAddress(),
    7500,
    8000,
    500,
  );

  const EarnVault = await ethers.getContractFactory("EarnVault");
  const vault = await EarnVault.deploy(
    await usdc.getAddress(),
    poolAddress,
    "ArcLend Earn Vault USDC",
    "evUSDC",
    owner.address,
  );

  return { owner, lender, borrower, usdc, pool, vault };
}

describe("EarnVault", function () {
  it("supplies deposits into ArcLend and increases share value from borrower interest", async function () {
    const { lender, borrower, usdc, pool, vault } = await deployProtocol();
    const vaultDeposit = 2_000n * USDC;
    const collateral = 1_000n * USDC;
    const borrowed = 500n * USDC;

    await usdc.mint(lender.address, vaultDeposit);
    await usdc.connect(lender).approve(await vault.getAddress(), vaultDeposit);
    await expect(vault.connect(lender).deposit(vaultDeposit, lender.address))
      .to.emit(vault, "Deposit")
      .withArgs(lender.address, lender.address, vaultDeposit, vaultDeposit);

    await usdc.mint(borrower.address, collateral);
    await usdc.connect(borrower).approve(await pool.getAddress(), collateral);
    await pool.connect(borrower).supply(await usdc.getAddress(), collateral, borrower.address);
    await pool.connect(borrower).borrow(await usdc.getAddress(), borrowed, borrower.address);

    await time.increase(30 * 24 * 60 * 60);

    const shares = await vault.balanceOf(lender.address);
    expect(await vault.convertToAssets(shares)).to.be.greaterThan(vaultDeposit);
  });

  it("lets protocol rewards raise assets per share without minting shares", async function () {
    const { owner, lender, usdc, vault } = await deployProtocol();
    const vaultDeposit = 1_000n * USDC;
    const reward = 25n * USDC;

    await usdc.mint(lender.address, vaultDeposit);
    await usdc.connect(lender).approve(await vault.getAddress(), vaultDeposit);
    await vault.connect(lender).deposit(vaultDeposit, lender.address);

    const sharesBefore = await vault.totalSupply();
    await usdc.mint(owner.address, reward);
    await usdc.connect(owner).approve(await vault.getAddress(), reward);
    await expect(vault.connect(owner).depositRewards(reward))
      .to.emit(vault, "RewardsAdded")
      .withArgs(owner.address, reward);

    expect(await vault.totalSupply()).to.equal(sharesBefore);
    expect(await vault.convertToAssets(sharesBefore)).to.be.greaterThan(vaultDeposit);
    expect(await vault.convertToAssets(sharesBefore)).to.be.lessThanOrEqual(vaultDeposit + reward);
  });

  it("redeems shares back to the receiver", async function () {
    const { lender, usdc, vault } = await deployProtocol();
    const vaultDeposit = 250n * USDC;

    await usdc.mint(lender.address, vaultDeposit);
    await usdc.connect(lender).approve(await vault.getAddress(), vaultDeposit);
    await vault.connect(lender).deposit(vaultDeposit, lender.address);

    const balanceBefore = await usdc.balanceOf(lender.address);
    const shares = await vault.balanceOf(lender.address);
    await expect(vault.connect(lender).redeem(shares, lender.address, lender.address))
      .to.emit(vault, "Withdraw")
      .withArgs(lender.address, lender.address, lender.address, vaultDeposit, shares);

    expect(await usdc.balanceOf(lender.address)).to.equal(balanceBefore + vaultDeposit);
    expect(await vault.balanceOf(lender.address)).to.equal(0);
  });

  it("reports available pool liquidity for withdrawals", async function () {
    const { lender, usdc, pool, vault } = await deployProtocol();
    const vaultDeposit = 500n * USDC;

    await usdc.mint(lender.address, vaultDeposit);
    await usdc.connect(lender).approve(await vault.getAddress(), vaultDeposit);
    await vault.connect(lender).deposit(vaultDeposit, lender.address);

    expect(await vault.availableAssets()).to.equal(
      await usdc.balanceOf(await pool.getAddress()),
    );
    expect(await vault.maxWithdraw(lender.address)).to.equal(vaultDeposit);
  });

  it("rejects deposits below the minimum share-protection threshold", async function () {
    const { lender, usdc, vault } = await deployProtocol();
    const belowMinimum = USDC - 1n;

    await usdc.mint(lender.address, belowMinimum);
    await usdc.connect(lender).approve(await vault.getAddress(), belowMinimum);

    await expect(
      vault.connect(lender).deposit(belowMinimum, lender.address),
    ).to.be.revertedWith("EarnVault: deposit below minimum");
  });

  it("lets depositors enforce a minimum share amount", async function () {
    const { lender, usdc, vault } = await deployProtocol();
    const deposit = 10n * USDC;

    await usdc.mint(lender.address, deposit);
    await usdc.connect(lender).approve(await vault.getAddress(), deposit);
    await expect(
      vault.connect(lender)["deposit(uint256,address,uint256)"](
        deposit,
        lender.address,
        deposit + 1n,
      ),
    ).to.be.revertedWith("EarnVault: insufficient shares");
  });

  it("accounts for idle donations without allowing a profitable first-depositor attack", async function () {
    const { lender: attacker, borrower: victim, usdc, vault } =
      await deployProtocol();
    const initialDeposit = USDC;
    const donation = 1_000n * USDC;
    const victimDeposit = USDC;

    await usdc.mint(attacker.address, initialDeposit + donation);
    await usdc.connect(attacker).approve(await vault.getAddress(), initialDeposit);
    await vault.connect(attacker).deposit(initialDeposit, attacker.address);
    await usdc.connect(attacker).transfer(await vault.getAddress(), donation);

    expect(await vault.totalAssets()).to.equal(initialDeposit + donation);

    await usdc.mint(victim.address, victimDeposit);
    await usdc.connect(victim).approve(await vault.getAddress(), victimDeposit);
    await vault.connect(victim).deposit(victimDeposit, victim.address);

    const victimShares = await vault.balanceOf(victim.address);
    expect(victimShares).to.be.greaterThan(0);
    expect(await vault.convertToAssets(victimShares)).to.be.greaterThanOrEqual(
      victimDeposit - 1_000n,
    );

    const attackerShares = await vault.balanceOf(attacker.address);
    const attackerAssets = await vault.convertToAssets(attackerShares);
    expect(attackerAssets).to.be.lessThan(initialDeposit + donation);
  });
});
