import { expect } from "chai";
import { ethers } from "hardhat";
import { parseUnits } from "ethers";

describe("SwapPool", function () {
  async function deployFixture() {
    const [owner, lp, trader, attacker] = await ethers.getSigners();

    const Mock = await ethers.getContractFactory("MockStablecoin");
    const usdc = await Mock.deploy("USD Coin", "USDC");
    const eurc = await Mock.deploy("Euro Coin", "EURC");
    await usdc.waitForDeployment();
    await eurc.waitForDeployment();

    const Pool = await ethers.getContractFactory("SwapPool");
    const pool = await Pool.deploy(
      await usdc.getAddress(),
      await eurc.getAddress(),
      owner.address,
    );
    await pool.waitForDeployment();

    const mintAndApprove = async (
      who: typeof lp,
      amountA: bigint,
      amountB: bigint,
    ) => {
      await usdc.mint(who.address, amountA);
      await eurc.mint(who.address, amountB);
      await usdc.connect(who).approve(await pool.getAddress(), amountA);
      await eurc.connect(who).approve(await pool.getAddress(), amountB);
    };

    return { owner, lp, trader, attacker, usdc, eurc, pool, mintAndApprove };
  }

  it("seeds liquidity and quotes independent of lending pool", async function () {
    const { lp, pool, mintAndApprove, usdc, eurc } = await deployFixture();
    const amountA = parseUnits("10000", 6);
    const amountB = parseUnits("9200", 6); // ~0.92 EURC per USDC
    await mintAndApprove(lp, amountA, amountB);

    await expect(pool.connect(lp).addLiquidity(amountA, amountB, 0n))
      .to.emit(pool, "LiquidityAdded");

    expect(await pool.reserveA()).to.equal(amountA);
    expect(await pool.reserveB()).to.equal(amountB);
    expect(await pool.balanceOf(lp.address)).to.be.gt(0n);

    // Pool holds its own tokens
    expect(await usdc.balanceOf(await pool.getAddress())).to.equal(amountA);
    expect(await eurc.balanceOf(await pool.getAddress())).to.equal(amountB);
  });

  it("swaps with fee and reverts on minAmountOut slippage", async function () {
    const { lp, trader, pool, mintAndApprove, usdc, eurc } =
      await deployFixture();
    await mintAndApprove(lp, parseUnits("10000", 6), parseUnits("10000", 6));
    await pool
      .connect(lp)
      .addLiquidity(parseUnits("10000", 6), parseUnits("10000", 6), 0n);

    const amountIn = parseUnits("100", 6);
    await usdc.mint(trader.address, amountIn);
    await usdc.connect(trader).approve(await pool.getAddress(), amountIn);

    const quote = await pool.getQuote(await usdc.getAddress(), amountIn);
    expect(quote).to.be.gt(0n);

    await expect(
      pool
        .connect(trader)
        .swap(await usdc.getAddress(), amountIn, quote + 1n),
    ).to.be.revertedWith("Slippage: output below minimum");

    await expect(
      pool.connect(trader).swap(await usdc.getAddress(), amountIn, quote),
    )
      .to.emit(pool, "Swap")
      .withArgs(
        trader.address,
        await usdc.getAddress(),
        amountIn,
        await eurc.getAddress(),
        quote,
      );

    expect(await eurc.balanceOf(trader.address)).to.equal(quote);
  });

  it("addLiquidity requires proportional deposits (excess B not fully absorbed)", async function () {
    const { lp, pool, mintAndApprove } = await deployFixture();
    await mintAndApprove(lp, parseUnits("1000", 6), parseUnits("1000", 6));
    await pool
      .connect(lp)
      .addLiquidity(parseUnits("1000", 6), parseUnits("1000", 6), 0n);

    // Try 2:1 deposit — only 1:1 of the larger side should be taken.
    const a2 = parseUnits("200", 6);
    const b2 = parseUnits("100", 6);
    await mintAndApprove(lp, a2, b2);
    const balABefore = await (
      await ethers.getContractAt("MockStablecoin", await pool.tokenA())
    ).balanceOf(lp.address);

    await pool.connect(lp).addLiquidity(a2, b2, 0n);

    // reserve growth should be ~100 / 100 (binding side B)
    expect(await pool.reserveA()).to.equal(parseUnits("1100", 6));
    expect(await pool.reserveB()).to.equal(parseUnits("1100", 6));

    // Excess A refunded by never transferring it
    const usdc = await ethers.getContractAt(
      "MockStablecoin",
      await pool.tokenA(),
    );
    // lp still holds the unused 100 USDC from the lopsided attempt
    expect(await usdc.balanceOf(lp.address)).to.equal(
      balABefore - parseUnits("100", 6),
    );
  });

  it("removeLiquidity returns proportional share", async function () {
    const { lp, pool, mintAndApprove, usdc, eurc } = await deployFixture();
    await mintAndApprove(lp, parseUnits("1000", 6), parseUnits("1000", 6));
    await pool
      .connect(lp)
      .addLiquidity(parseUnits("1000", 6), parseUnits("1000", 6), 0n);

    const lpBal = await pool.balanceOf(lp.address);
    await pool.connect(lp).removeLiquidity(lpBal / 2n, 0n, 0n);

    expect(await pool.reserveA()).to.equal(parseUnits("500", 6));
    expect(await pool.reserveB()).to.equal(parseUnits("500", 6));
    expect(await usdc.balanceOf(lp.address)).to.equal(parseUnits("500", 6));
    expect(await eurc.balanceOf(lp.address)).to.equal(parseUnits("500", 6));
  });

  it("setFeeBps enforces hard cap", async function () {
    const { owner, pool } = await deployFixture();
    await expect(pool.connect(owner).setFeeBps(101)).to.be.revertedWith(
      "SwapPool: fee too high",
    );
    await pool.connect(owner).setFeeBps(50);
    expect(await pool.feeBps()).to.equal(50n);
  });

  it("getQuote returns 0 for empty pool or invalid token", async function () {
    const { pool, usdc } = await deployFixture();
    expect(
      await pool.getQuote(await usdc.getAddress(), parseUnits("1", 6)),
    ).to.equal(0n);
    expect(
      await pool.getQuote(ethers.ZeroAddress, parseUnits("1", 6)),
    ).to.equal(0n);
  });
});
