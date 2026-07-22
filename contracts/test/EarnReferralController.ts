import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const USDC = 10n ** 6n;

async function deployProtocol() {
  const [owner, depositor, referrer, other] = await ethers.getSigners();

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

  const Controller = await ethers.getContractFactory("EarnReferralController");
  const controller = await Controller.deploy(owner.address);
  await controller.configureVault(await vault.getAddress(), await usdc.getAddress(), true);

  return { owner, depositor, referrer, other, usdc, vault, controller };
}

describe("EarnReferralController", function () {
  it("routes deposits, accrues level-based asset rewards, and awards points", async function () {
    const { owner, depositor, referrer, usdc, vault, controller } =
      await deployProtocol();
    const deposit = 1_000n * USDC;
    const rewardReserve = 10n * USDC;

    await controller.connect(owner).setReferralLevel(referrer.address, 5);
    await usdc.mint(owner.address, rewardReserve);
    await usdc.connect(owner).approve(await controller.getAddress(), rewardReserve);
    await controller.connect(owner).fundRewards(await usdc.getAddress(), rewardReserve);

    await usdc.mint(depositor.address, deposit);
    await usdc.connect(depositor).approve(await controller.getAddress(), deposit);

    await expect(
      controller
        .connect(depositor)
        .depositWithReferral(
          await vault.getAddress(),
          deposit,
          depositor.address,
          referrer.address,
        ),
    ).to.emit(controller, "ReferralDeposit");

    const expectedReward = (deposit * 25n) / 10_000n;
    expect(await controller.referrerOf(depositor.address)).to.equal(referrer.address);
    expect(await controller.referralLevel(referrer.address)).to.equal(5);
    expect(await controller.pendingRewards(referrer.address, await usdc.getAddress())).to.equal(0);
    const rewardPosition = await controller.referralRewardPositions(
      depositor.address,
      await vault.getAddress(),
    );
    expect(rewardPosition.referrer).to.equal(referrer.address);
    expect(rewardPosition.qualifyingAssets).to.equal(deposit);
    expect(rewardPosition.reward).to.equal(expectedReward);
    expect(rewardPosition.finalized).to.equal(false);
    expect(await controller.pendingPoints(referrer.address)).to.equal(5_000);
    expect(await controller.pendingPoints(depositor.address)).to.equal(1_000);
    expect(await controller.claimedPoints(referrer.address)).to.equal(0);
    expect(await controller.referredVolume(referrer.address, await usdc.getAddress())).to.equal(deposit);
  });

  it("lets referrers claim points into a non-transferable claimed counter", async function () {
    const { depositor, referrer, usdc, vault, controller } =
      await deployProtocol();
    const deposit = 300n * USDC;

    await usdc.mint(depositor.address, deposit);
    await usdc.connect(depositor).approve(await controller.getAddress(), deposit);
    await controller
      .connect(depositor)
      .depositWithReferral(
        await vault.getAddress(),
        deposit,
        depositor.address,
        referrer.address,
      );

    const pending = await controller.pendingPoints(referrer.address);
    await expect(controller.connect(referrer).claimPoints())
      .to.emit(controller, "ReferralPointsClaimed")
      .withArgs(referrer.address, pending);
    expect(await controller.pendingPoints(referrer.address)).to.equal(0);
    expect(await controller.claimedPoints(referrer.address)).to.equal(pending);
  });

  it("lets referrers claim funded rewards", async function () {
    const { owner, depositor, referrer, usdc, vault, controller } =
      await deployProtocol();
    const deposit = 200n * USDC;
    const rewardReserve = USDC;

    await usdc.mint(owner.address, rewardReserve);
    await usdc.connect(owner).approve(await controller.getAddress(), rewardReserve);
    await controller.connect(owner).fundRewards(await usdc.getAddress(), rewardReserve);

    await usdc.mint(depositor.address, deposit);
    await usdc.connect(depositor).approve(await controller.getAddress(), deposit);
    await controller
      .connect(depositor)
      .depositWithReferral(
        await vault.getAddress(),
        deposit,
        depositor.address,
        referrer.address,
      );

    await time.increase(30 * 24 * 60 * 60);
    await controller.finalizeReferralReward(await vault.getAddress(), depositor.address);
    const pending = await controller.pendingRewards(referrer.address, await usdc.getAddress());
    expect(pending).to.equal((deposit * 5n) / 10_000n);
    await expect(
      controller.connect(referrer).claimRewards(await usdc.getAddress(), referrer.address),
    ).to.emit(controller, "ReferralRewardClaimed")
      .withArgs(referrer.address, await usdc.getAddress(), referrer.address, pending);
    expect(await usdc.balanceOf(referrer.address)).to.equal(pending);
    expect(await controller.pendingRewards(referrer.address, await usdc.getAddress())).to.equal(0);
  });

  it("allows a new reward schedule after an earlier reward is finalized", async function () {
    const { owner, depositor, referrer, usdc, vault, controller } = await deployProtocol();
    const firstDeposit = 200n * USDC;
    const secondDeposit = 100n * USDC;
    await usdc.mint(owner.address, 10n * USDC);
    await usdc.connect(owner).approve(await controller.getAddress(), 10n * USDC);
    await controller.connect(owner).fundRewards(await usdc.getAddress(), 10n * USDC);
    await usdc.mint(depositor.address, firstDeposit + secondDeposit);
    await usdc.connect(depositor).approve(await controller.getAddress(), ethers.MaxUint256);

    await controller.connect(depositor).depositWithReferral(
      await vault.getAddress(), firstDeposit, depositor.address, referrer.address,
    );
    await time.increase(30 * 24 * 60 * 60);
    await controller.finalizeReferralReward(await vault.getAddress(), depositor.address);
    expect((await controller.referralRewardPositions(
      depositor.address, await vault.getAddress(),
    )).referrer).to.equal(ethers.ZeroAddress);

    await controller.connect(depositor).depositWithReferral(
      await vault.getAddress(), secondDeposit, depositor.address, ethers.ZeroAddress,
    );
    expect((await controller.referralRewardPositions(
      depositor.address, await vault.getAddress(),
    )).qualifyingAssets).to.be.greaterThan(0);
  });

  it("does not reward recycled principal and forfeits rewards when the holding requirement is broken", async function () {
    const { owner, depositor, referrer, usdc, vault, controller } =
      await deployProtocol();
    const deposit = 1_000n * USDC;
    const rewardReserve = 10n * USDC;

    await usdc.mint(owner.address, rewardReserve);
    await usdc.connect(owner).approve(await controller.getAddress(), rewardReserve);
    await controller.connect(owner).fundRewards(await usdc.getAddress(), rewardReserve);
    await usdc.mint(depositor.address, deposit);
    await usdc.connect(depositor).approve(await controller.getAddress(), deposit);

    await controller
      .connect(depositor)
      .depositWithReferral(
        await vault.getAddress(),
        deposit,
        depositor.address,
        referrer.address,
      );

    const pointsAfterFirstDeposit = await controller.pendingPoints(referrer.address);
    const volumeAfterFirstDeposit = await controller.referredVolume(
      referrer.address,
      await usdc.getAddress(),
    );
    const reserveAfterFirstDeposit = await controller.rewardReserves(await usdc.getAddress());

    await vault.connect(depositor).redeem(
      await vault.balanceOf(depositor.address),
      depositor.address,
      depositor.address,
    );
    await usdc.connect(depositor).approve(await controller.getAddress(), deposit);
    await controller
      .connect(depositor)
      .depositWithReferral(
        await vault.getAddress(),
        deposit,
        depositor.address,
        referrer.address,
      );

    expect(await controller.rewardedPrincipal(depositor.address, await vault.getAddress())).to.equal(deposit);
    expect(await controller.pendingPoints(referrer.address)).to.equal(pointsAfterFirstDeposit);
    expect(
      await controller.referredVolume(referrer.address, await usdc.getAddress()),
    ).to.equal(volumeAfterFirstDeposit);
    expect(await controller.rewardReserves(await usdc.getAddress())).to.equal(reserveAfterFirstDeposit);

    await vault.connect(depositor).redeem(
      await vault.balanceOf(depositor.address),
      depositor.address,
      depositor.address,
    );
    await time.increase(30 * 24 * 60 * 60);

    await expect(
      controller.finalizeReferralReward(await vault.getAddress(), depositor.address),
    ).to.be.revertedWith("ReferralController: holding requirement");
    await expect(
      controller.forfeitReferralReward(await vault.getAddress(), depositor.address),
    ).to.emit(controller, "ReferralRewardForfeited");
    expect(await controller.pendingRewards(referrer.address, await usdc.getAddress())).to.equal(0);
    expect(await controller.rewardReserves(await usdc.getAddress())).to.equal(rewardReserve);
  });

  it("records activity points for approved recorders and blocks duplicate events", async function () {
    const { owner, depositor, other, controller } = await deployProtocol();
    const lendActivity = await controller.ACTIVITY_LEND_DEPOSIT();
    const eventId = ethers.id("lend-deposit-tx-1");
    const amount = 250n * USDC;

    await expect(
      controller
        .connect(other)
        .recordActivity(eventId, depositor.address, lendActivity, amount),
    ).to.be.revertedWith("ReferralController: not activity recorder");

    await expect(
      controller
        .connect(owner)
        .recordActivity(eventId, depositor.address, lendActivity, amount),
    ).to.emit(controller, "ActivityRecorded")
      .withArgs(eventId, depositor.address, lendActivity, amount, 250);

    expect(await controller.pendingPoints(depositor.address)).to.equal(250);
    expect(await controller.userActivityVolume(depositor.address, lendActivity)).to.equal(amount);
    expect(await controller.userActivityPoints(depositor.address, lendActivity)).to.equal(250);

    await expect(
      controller
        .connect(owner)
        .recordActivity(eventId, depositor.address, lendActivity, amount),
    ).to.be.revertedWith("ReferralController: activity recorded");
  });

  it("lets the owner approve activity recorders and set fixed domain point rates", async function () {
    const { owner, depositor, other, controller } = await deployProtocol();
    const domainMintActivity = await controller.ACTIVITY_DOMAIN_MINT();
    const eventId = ethers.id("domain-mint-tx-1");

    await controller.connect(owner).setActivityRecorder(other.address, true);
    await controller.connect(owner).setActivityPointMultiplier(domainMintActivity, 75);

    await expect(
      controller
        .connect(other)
        .recordActivity(eventId, depositor.address, domainMintActivity, USDC),
    ).to.emit(controller, "ActivityRecorded")
      .withArgs(eventId, depositor.address, domainMintActivity, USDC, 75);

    expect(await controller.pendingPoints(depositor.address)).to.equal(75);
  });

  it("blocks self referrals and keeps an existing referrer immutable", async function () {
    const { depositor, referrer, other, controller } = await deployProtocol();

    await expect(
      controller.connect(depositor).registerReferrer(depositor.address),
    ).to.be.revertedWith("ReferralController: self referral");

    await controller.connect(depositor).registerReferrer(referrer.address);
    await expect(
      controller.connect(depositor).registerReferrer(other.address),
    ).to.be.revertedWith("ReferralController: referrer set");
  });

  it("blocks circular referral relationships", async function () {
    const { depositor, referrer, controller } = await deployProtocol();

    await controller.connect(depositor).registerReferrer(referrer.address);
    await expect(
      controller.connect(referrer).registerReferrer(depositor.address),
    ).to.be.revertedWith("ReferralController: circular referral");
  });

  it("does not let a third party assign a receiver's referrer", async function () {
    const { depositor, referrer, other, usdc, vault, controller } =
      await deployProtocol();
    const deposit = 10n * USDC;

    await usdc.mint(other.address, deposit);
    await usdc.connect(other).approve(await controller.getAddress(), deposit);

    await expect(
      controller
        .connect(other)
        .depositWithReferral(
          await vault.getAddress(),
          deposit,
          depositor.address,
          referrer.address,
        ),
    ).to.be.revertedWith("ReferralController: receiver must register");
    expect(await controller.referrerOf(depositor.address)).to.equal(
      ethers.ZeroAddress,
    );
  });
});
