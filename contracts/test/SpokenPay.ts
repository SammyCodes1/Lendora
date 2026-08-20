import { expect } from "chai";
import { ethers } from "hardhat";

describe("SpokenPay", function () {
  async function deployFixture() {
    const [owner, user, recipient, relayer] = await ethers.getSigners();

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

    return { owner, user, recipient, relayer, token, pool, domain, spokenPay };
  }

  it("creates a spoken plan and pays a .lendora name when health is safe", async function () {
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

    await expect(spokenPay.connect(relayer).executePlan(1)).to.emit(
      spokenPay,
      "PlanExecuted",
    );

    expect(await token.balanceOf(recipient.address)).to.equal(amount);
  });

  it("blocks execution when health factor is below the floor", async function () {
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
    await expect(spokenPay.connect(relayer).executePlan(1)).to.be.revertedWithCustomError(
      spokenPay,
      "HealthTooLow",
    );
  });
});
