import { expect } from "chai";
import { ethers } from "hardhat";

describe("SpokenPay", function () {
  async function deployFixture() {
    const [owner, user, recipient, relayer, stranger] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockStablecoin");
    const token = await MockToken.deploy("USD Coin", "USDC");
    await token.waitForDeployment();

    const MockPool = await ethers.getContractFactory("MockSpokenPayPool");
    const pool = await MockPool.deploy();
    await pool.waitForDeployment();

    const MockDomain = await ethers.getContractFactory("MockSpokenPayDomain");
    const domain = await MockDomain.deploy();
    await domain.waitForDeployment();

    const SpokenPay = await ethers.getContractFactory("SpokenPay");
    const spokenPay = await SpokenPay.deploy(
      await pool.getAddress(),
      await domain.getAddress(),
      relayer.address,
    );
    await spokenPay.waitForDeployment();

    await token.mint(user.address, 1_000_000_000n);
    await token.connect(user).approve(await spokenPay.getAddress(), ethers.MaxUint256);
    await domain.set("ada", recipient.address);

    return { owner, user, recipient, relayer, stranger, token, pool, domain, spokenPay };
  }

  it("creates a spoken plan and pays a pinned .lendora name when health is safe", async function () {
    const { user, recipient, relayer, token, spokenPay } = await deployFixture();
    const amount = 40_000_000n;
    const interval = 7 * 24 * 60 * 60;

    const tx = await spokenPay.connect(user).createPlan(
      await token.getAddress(),
      ethers.ZeroAddress,
      "ada",
      amount,
      interval,
      0,
      ethers.parseEther("1.5"),
      true,
    );
    await expect(tx).to.emit(spokenPay, "PlanCreated");

    const plan = await spokenPay.plans(1);
    expect(plan.recipient).to.equal(recipient.address);

    await expect(spokenPay.connect(relayer).executePlan(1)).to.emit(
      spokenPay,
      "PlanExecuted",
    );

    expect(await token.balanceOf(recipient.address)).to.equal(amount);
    expect(await spokenPay.planIdsOf(user.address)).to.deep.equal([1n]);
  });

  it("skips and advances the next run when health factor is below the floor", async function () {
    const { user, relayer, token, pool, spokenPay } = await deployFixture();
    await spokenPay.connect(user).createPlan(
      await token.getAddress(),
      ethers.ZeroAddress,
      "ada",
      40_000_000n,
      7 * 24 * 60 * 60,
      0,
      ethers.parseEther("1.5"),
      true,
    );
    await pool.setHealthFactor(ethers.parseEther("1.2"));
    const before = (await spokenPay.plans(1)).nextRunAt;
    await expect(spokenPay.connect(relayer).executePlan(1)).to.emit(
      spokenPay,
      "PlanSkipped",
    );
    const after = (await spokenPay.plans(1)).nextRunAt;
    expect(after).to.be.greaterThan(before);
    expect(await spokenPay.lastOutcome(1)).to.equal(await spokenPay.OUTCOME_SKIPPED_HEALTH());
  });

  it("skips when the wallet has no idle funds for a yield plan", async function () {
    const { user, relayer, token, spokenPay } = await deployFixture();
    await spokenPay.connect(user).createPlan(
      await token.getAddress(),
      ethers.ZeroAddress,
      "ada",
      40_000_000n,
      7 * 24 * 60 * 60,
      0,
      ethers.parseEther("1.1"),
      true,
    );
    await token.connect(user).transfer(relayer.address, await token.balanceOf(user.address));
    await expect(spokenPay.connect(relayer).executePlan(1)).to.emit(
      spokenPay,
      "PlanSkipped",
    );
    expect(await spokenPay.lastOutcome(1)).to.equal(await spokenPay.OUTCOME_SKIPPED_BALANCE());
  });

  it("halts if the pinned .lendora name moves", async function () {
    const { user, relayer, stranger, token, domain, spokenPay } = await deployFixture();
    await spokenPay.connect(user).createPlan(
      await token.getAddress(),
      ethers.ZeroAddress,
      "ada",
      40_000_000n,
      7 * 24 * 60 * 60,
      0,
      ethers.parseEther("1.1"),
      false,
    );
    await domain.set("ada", stranger.address);
    await expect(spokenPay.connect(relayer).executePlan(1)).to.emit(
      spokenPay,
      "PlanHalted",
    );
    expect((await spokenPay.plans(1)).active).to.equal(false);
  });

  it("rejects creating a plan for an unregistered name", async function () {
    const { user, token, spokenPay } = await deployFixture();
    await expect(
      spokenPay.connect(user).createPlan(
        await token.getAddress(),
        ethers.ZeroAddress,
        "nobody",
        40_000_000n,
        7 * 24 * 60 * 60,
        0,
        ethers.parseEther("1.1"),
        false,
      ),
    ).to.be.revertedWithCustomError(spokenPay, "InvalidRecipient");
  });

  it("marks a moved name as due so the relayer will halt it", async function () {
    const { user, relayer, stranger, token, domain, spokenPay } = await deployFixture();
    await spokenPay.connect(user).createPlan(
      await token.getAddress(),
      ethers.ZeroAddress,
      "ada",
      40_000_000n,
      7 * 24 * 60 * 60,
      0,
      ethers.parseEther("1.1"),
      false,
    );
    await domain.set("ada", stranger.address);
    const preview = await spokenPay.previewPlan(1);
    expect(preview.due).to.equal(true);
    expect(preview.blocker).to.equal(await spokenPay.OUTCOME_HALTED_DOMAIN());
    await spokenPay.connect(relayer).executePlan(1);
    expect((await spokenPay.plans(1)).active).to.equal(false);
  });

  it("lets the owner run before the first cadence and blocks the relayer", async function () {
    const { user, relayer, token, spokenPay } = await deployFixture();
    const latest = await ethers.provider.getBlock("latest");
    const firstRunAt = Number(latest!.timestamp) + 86_400;
    await spokenPay.connect(user).createPlan(
      await token.getAddress(),
      ethers.ZeroAddress,
      "ada",
      40_000_000n,
      7 * 24 * 60 * 60,
      firstRunAt,
      ethers.parseEther("1.1"),
      false,
    );
    await expect(spokenPay.connect(relayer).executePlan(1)).to.be.revertedWithCustomError(
      spokenPay,
      "NotDue",
    );
    await expect(spokenPay.connect(user).executePlan(1)).to.emit(spokenPay, "PlanExecuted");
  });

  it("reverts for the owner when health is too low instead of silently skipping", async function () {
    const { user, token, pool, spokenPay } = await deployFixture();
    await spokenPay.connect(user).createPlan(
      await token.getAddress(),
      ethers.ZeroAddress,
      "ada",
      40_000_000n,
      7 * 24 * 60 * 60,
      0,
      ethers.parseEther("1.5"),
      true,
    );
    await pool.setHealthFactor(ethers.parseEther("1.2"));
    await expect(spokenPay.connect(user).executePlan(1)).to.be.revertedWithCustomError(
      spokenPay,
      "HealthTooLow",
    );
  });

  it("rejects a stranger and cancels from the owner", async function () {
    const { user, stranger, token, spokenPay } = await deployFixture();
    await spokenPay.connect(user).createPlan(
      await token.getAddress(),
      ethers.ZeroAddress,
      "ada",
      40_000_000n,
      7 * 24 * 60 * 60,
      0,
      ethers.parseEther("1.1"),
      false,
    );
    await expect(spokenPay.connect(stranger).executePlan(1)).to.be.revertedWithCustomError(
      spokenPay,
      "UnauthorizedExecutor",
    );
    await spokenPay.connect(user).cancelPlan(1);
    expect((await spokenPay.plans(1)).active).to.equal(false);
  });
});
