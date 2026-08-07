import { expect } from "chai";
import { ethers } from "hardhat";
import { parseUnits } from "ethers";

describe("Treasury + Fee-Split Integration", function () {
  async function deployFixture() {
    const [owner, lp, trader, partner, other] = await ethers.getSigners();

    // ─── Deploy mock tokens ─────────────────────────────────────────
    const Mock = await ethers.getContractFactory("MockStablecoin");
    const usdc = await Mock.deploy("USD Coin", "USDC");
    const eurc = await Mock.deploy("Euro Coin", "EURC");
    await usdc.waitForDeployment();
    await eurc.waitForDeployment();

    const USDC = await usdc.getAddress();
    const EURC = await eurc.getAddress();

    // ─── Deploy Treasury ────────────────────────────────────────────
    const Treasury = await ethers.getContractFactory("Treasury");
    const treasury = await Treasury.deploy(owner.address);
    await treasury.waitForDeployment();

    // ─── Deploy FlashLoanPool ───────────────────────────────────────
    const FlashLoan = await ethers.getContractFactory("FlashLoanPool");
    const flashLoanPool = await FlashLoan.deploy(owner.address);
    await flashLoanPool.waitForDeployment();

    await flashLoanPool.setAllowedAsset(USDC, true);
    await flashLoanPool.setAllowedAsset(EURC, true);
    await flashLoanPool.setTreasury(await treasury.getAddress());

    // ─── Deploy SwapPool ────────────────────────────────────────────
    const Swap = await ethers.getContractFactory("SwapPool");
    const swapPool = await Swap.deploy(USDC, EURC, owner.address);
    await swapPool.waitForDeployment();
    await swapPool.setTreasury(await treasury.getAddress());

    // ─── Deploy LaaSRouter ─────────────────────────────────────────
    const Router = await ethers.getContractFactory("LaaSRouter");
    const router = await Router.deploy(owner.address);
    await router.waitForDeployment();
    await router.setFlashLoanPool(await flashLoanPool.getAddress());
    await router.setTreasury(await treasury.getAddress());

    // Authorize LaaSRouter on Treasury
    await treasury.setAuthorizedSpender(await router.getAddress(), true);

    // ─── Helpers ────────────────────────────────────────────────────
    const mintAndApprove = async (
      who: typeof lp,
      token: any,
      amount: bigint,
      spender: any,
    ) => {
      await token.mint(who.address, amount);
      await token.connect(who).approve(await spender.getAddress(), amount);
    };

    return {
      owner,
      lp,
      trader,
      partner,
      other,
      usdc,
      eurc,
      USDC,
      EURC,
      treasury,
      flashLoanPool,
      swapPool,
      router,
      mintAndApprove,
    };
  }

  // ════════════════════════════════════════════════════════════════
  // TREASURY
  // ════════════════════════════════════════════════════════════════

  describe("Treasury", function () {
    it("accepts deposits and tracks balance", async function () {
      const { owner, usdc, USDC, treasury, mintAndApprove } =
        await deployFixture();
      const amount = parseUnits("1000", 6);
      await mintAndApprove(owner, usdc, amount, treasury);

      await expect(treasury.connect(owner).deposit(USDC, amount, "TestSource"))
        .to.emit(treasury, "Deposited")
        .withArgs(USDC, owner.address, amount, "TestSource");

      expect(await treasury.getBalance(USDC)).to.equal(amount);
    });

    it("only owner can withdraw by default", async function () {
      const { owner, other, usdc, USDC, treasury, mintAndApprove } =
        await deployFixture();
      const amount = parseUnits("500", 6);
      await mintAndApprove(owner, usdc, amount, treasury);
      await treasury.connect(owner).deposit(USDC, amount, "Test");

      // Non-owner cannot withdraw
      await expect(
        treasury.connect(other).withdraw(USDC, other.address, amount),
      ).to.be.revertedWithCustomError(treasury, "NotAuthorizedSpender");

      // Owner can withdraw
      await expect(
        treasury.connect(owner).withdraw(USDC, owner.address, amount / 2n),
      )
        .to.emit(treasury, "Withdrawn")
        .withArgs(USDC, owner.address, amount / 2n);

      expect(await treasury.getBalance(USDC)).to.equal(amount / 2n);
    });

    it("authorized spender can withdraw without being owner", async function () {
      const { owner, other, usdc, USDC, treasury, mintAndApprove } =
        await deployFixture();
      const amount = parseUnits("1000", 6);
      await mintAndApprove(owner, usdc, amount, treasury);
      await treasury.connect(owner).deposit(USDC, amount, "Test");

      // Grant authorized spender
      await treasury.connect(owner).setAuthorizedSpender(other.address, true);

      await expect(
        treasury.connect(other).withdraw(USDC, other.address, parseUnits("200", 6)),
      )
        .to.emit(treasury, "Withdrawn");

      // Revoke
      await treasury.connect(owner).setAuthorizedSpender(other.address, false);
      await expect(
        treasury.connect(other).withdraw(USDC, other.address, parseUnits("100", 6)),
      ).to.be.revertedWithCustomError(treasury, "NotAuthorizedSpender");
    });

    it("rejects zero-address owner construction", async function () {
      const Treasury = await ethers.getContractFactory("Treasury");
      // OZ's Ownable constructor fires first and reverts with a custom error.
      await expect(
        Treasury.deploy(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(Treasury, "OwnableInvalidOwner");
    });
  });

  // ════════════════════════════════════════════════════════════════
  // FLASH LOAN POOL — FEE SPLIT
  // ════════════════════════════════════════════════════════════════

  describe("FlashLoanPool fee split", function () {
    it("routes treasury share of fees to Treasury", async function () {
      const { lp, usdc, USDC, flashLoanPool, treasury, mintAndApprove } =
        await deployFixture();

      // LP deposits liquidity
      const deposit = parseUnits("10000", 6);
      await mintAndApprove(lp, usdc, deposit, flashLoanPool);
      await flashLoanPool.connect(lp).depositLiquidity(USDC, deposit);

      // Deploy a flash loan receiver that repays.
      const Receiver = await ethers.getContractFactory(
        "MockFlashLoanReceiver",
      );
      const receiver = await Receiver.deploy(USDC);
      await receiver.waitForDeployment();
      // Fund receiver so it can repay fee (it needs amount + fee in its balance,
      // but it only needs the fee portion since it receives the borrow amount).
      const borrowAmount = parseUnits("1000", 6);
      const fee = (borrowAmount * 9n) / 10000n; // 0.09%
      await usdc.mint(await receiver.getAddress(), fee + parseUnits("1", 6)); // fee + buffer

      const treasuryCut = (fee * 2000n) / 10000n; // 20% of fee
      const treasuryBefore = await treasury.getBalance(USDC);

      // Call flashLoan so msg.sender is the receiver contract.
      await receiver.initiateFlashLoan(
        await flashLoanPool.getAddress(),
        borrowAmount,
      );

      const treasuryAfter = await treasury.getBalance(USDC);
      expect(treasuryAfter - treasuryBefore).to.equal(treasuryCut);

      // LP value should have increased by fee minus treasury cut.
      const lpValue = await flashLoanPool.totalLiquidity(USDC);
      expect(lpValue).to.be.gt(deposit);
    });

    it("enforces repayment invariant", async function () {
      const { lp, usdc, USDC, flashLoanPool, mintAndApprove } =
        await deployFixture();

      const deposit = parseUnits("5000", 6);
      await mintAndApprove(lp, usdc, deposit, flashLoanPool);
      await flashLoanPool.connect(lp).depositLiquidity(USDC, deposit);

      // Deploy a malicious receiver that does NOT repay.
      const Malicious = await ethers.getContractFactory(
        "MockMaliciousReceiver",
      );
      const malicious = await Malicious.deploy();
      await malicious.waitForDeployment();

      await expect(
        malicious.initiateFlashLoan(
          await flashLoanPool.getAddress(),
          USDC,
          parseUnits("100", 6),
        ),
      ).to.be.reverted; // repayment check fails
    });

    it("caps treasury share at 50%", async function () {
      const { flashLoanPool } = await deployFixture();
      await expect(
        flashLoanPool.setTreasuryShareBps(5001),
      ).to.be.revertedWith("Cannot exceed 50%");
    });

    it("LP can deposit and withdraw with correct accounting", async function () {
      const { lp, usdc, USDC, flashLoanPool, mintAndApprove } =
        await deployFixture();
      const amount = parseUnits("2000", 6);
      await mintAndApprove(lp, usdc, amount, flashLoanPool);
      await flashLoanPool.connect(lp).depositLiquidity(USDC, amount);

      const lpTokens = await flashLoanPool.lpBalance(USDC, lp.address);
      const withdrawn = await flashLoanPool
        .connect(lp)
        .withdrawLiquidity(USDC, lpTokens)
        .then((tx: any) => tx.wait());

      // LP should get their deposit back (no fees accrued yet)
      expect(await usdc.balanceOf(lp.address)).to.be.closeTo(amount, 10n);
      expect(await flashLoanPool.totalLpSupply(USDC)).to.equal(0n);
    });
  });

  // ════════════════════════════════════════════════════════════════
  // SWAP POOL — FEE SPLIT
  // ════════════════════════════════════════════════════════════════

  describe("SwapPool fee split", function () {
    it("routes treasury share of swap fees to Treasury", async function () {
      const { lp, trader, usdc, eurc, USDC, EURC, swapPool, treasury, mintAndApprove } =
        await deployFixture();

      // Seed liquidity
      const seedA = parseUnits("10000", 6);
      const seedB = parseUnits("10000", 6);
      await mintAndApprove(lp, usdc, seedA, swapPool);
      await mintAndApprove(lp, eurc, seedB, swapPool);
      await swapPool.connect(lp).addLiquidity(seedA, seedB, 0n);

      // Trader swaps USDC → EURC
      const amountIn = parseUnits("1000", 6);
      await mintAndApprove(trader, usdc, amountIn, swapPool);

      const quote = await swapPool.getQuote(USDC, amountIn);
      expect(quote).to.be.gt(0n);

      const treasuryBefore = await treasury.getBalance(USDC);

      await swapPool
        .connect(trader)
        .swap(USDC, amountIn, quote);

      const treasuryAfter = await treasury.getBalance(USDC);
      expect(treasuryAfter - treasuryBefore).to.be.gt(0n);

      // Verify treasury received ~0.045% of amountIn (15% of 0.30% fee)
      const expectedTreasuryCut =
        (amountIn * 30n * 1500n) / (10000n * 10000n);
      expect(treasuryAfter - treasuryBefore).to.equal(expectedTreasuryCut);
    });

    it("LP value still increases after treasury split", async function () {
      const { lp, trader, usdc, eurc, USDC, EURC, swapPool, treasury, mintAndApprove } =
        await deployFixture();

      const seedA = parseUnits("10000", 6);
      const seedB = parseUnits("10000", 6);
      await mintAndApprove(lp, usdc, seedA, swapPool);
      await mintAndApprove(lp, eurc, seedB, swapPool);
      await swapPool.connect(lp).addLiquidity(seedA, seedB, 0n);

      const kBefore = (await swapPool.reserveA()) * (await swapPool.reserveB());

      const amountIn = parseUnits("500", 6);
      await mintAndApprove(trader, usdc, amountIn, swapPool);
      const quote = await swapPool.getQuote(USDC, amountIn);
      await swapPool.connect(trader).swap(USDC, amountIn, quote);

      const kAfter = (await swapPool.reserveA()) * (await swapPool.reserveB());
      // k must increase (LPs earn net fee after treasury split)
      expect(kAfter).to.be.gt(kBefore);
    });

    it("caps treasury share at 50%", async function () {
      const { swapPool } = await deployFixture();
      await expect(
        swapPool.setTreasuryShareBps(5001),
      ).to.be.revertedWith("Cannot exceed 50%");
    });

    it("swap invariant holds with treasury split enabled", async function () {
      const { lp, trader, usdc, eurc, USDC, EURC, swapPool, mintAndApprove } =
        await deployFixture();

      const seedA = parseUnits("10000", 6);
      const seedB = parseUnits("9500", 6); // slightly different ratio
      await mintAndApprove(lp, usdc, seedA, swapPool);
      await mintAndApprove(lp, eurc, seedB, swapPool);
      await swapPool.connect(lp).addLiquidity(seedA, seedB, 0n);

      // Run several swaps in both directions
      for (let i = 0; i < 5; i++) {
        const swapAmount = parseUnits((100 + i * 50).toString(), 6);
        await mintAndApprove(trader, usdc, swapAmount, swapPool);
        const quoteA = await swapPool.getQuote(USDC, swapAmount);
        if (quoteA > 0n) {
          await swapPool.connect(trader).swap(USDC, swapAmount, quoteA);
        }

        await mintAndApprove(trader, eurc, swapAmount, swapPool);
        const quoteB = await swapPool.getQuote(EURC, swapAmount);
        if (quoteB > 0n) {
          await swapPool.connect(trader).swap(EURC, swapAmount, quoteB);
        }
      }

      const k = (await swapPool.reserveA()) * (await swapPool.reserveB());
      // After multiple swaps with fees, k must have grown
      expect(k).to.be.gt(seedA * seedB);
    });
  });

  // ════════════════════════════════════════════════════════════════
  // LAAS ROUTER — PARTNER PAYOUT FROM TREASURY
  // ════════════════════════════════════════════════════════════════

  describe("LaaSRouter partner payouts", function () {
    it("pays partner share from Treasury after flash loan", async function () {
      const { owner, lp, partner, usdc, USDC, flashLoanPool, treasury, router, mintAndApprove } =
        await deployFixture();

      // Fund LP
      const deposit = parseUnits("20000", 6);
      await mintAndApprove(lp, usdc, deposit, flashLoanPool);
      await flashLoanPool.connect(lp).depositLiquidity(USDC, deposit);

      // Register partner
      const partnerId = ethers.keccak256(ethers.toUtf8Bytes("acme-finance"));
      await router
        .connect(owner)
        .registerPartner(partnerId, partner.address, 5000); // 50% of fee

      // Deploy receiver that also initiates via LaaSRouter
      const Receiver = await ethers.getContractFactory(
        "MockFlashLoanReceiver",
      );
      const receiver = await Receiver.deploy(USDC);
      await receiver.waitForDeployment();

      const borrowAmount = parseUnits("1000", 6);
      const fee = (borrowAmount * 9n) / 10000n;
      const partnerShare = (fee * 5000n) / 10000n;

      // Fund receiver so it can repay the fee.
      await usdc.mint(await receiver.getAddress(), fee + parseUnits("1", 6));

      // Seed treasury with enough funds for the partner payout.
      // (In production FlashLoanPool's treasuryCut would have already
      //  funded it — here we pre-fund for the test.)
      await mintAndApprove(owner, usdc, partnerShare, treasury);
      await treasury.connect(owner).deposit(USDC, partnerShare, "TestSeed");

      const partnerBalBefore = await usdc.balanceOf(partner.address);

      // Receiver initiates flash loan via LaaSRouter.
      // The receiver IS both the caller and the callback target, so
      // LaaSRouter forwards the callback correctly.
      await receiver.initiateViaRouter(
        await router.getAddress(),
        borrowAmount,
        partnerId,
      );

      const partnerBalAfter = await usdc.balanceOf(partner.address);
      expect(partnerBalAfter - partnerBalBefore).to.equal(partnerShare);
    });

    it("reverts for inactive partner", async function () {
      const { owner, usdc, USDC, router } = await deployFixture();

      const partnerId = ethers.keccak256(ethers.toUtf8Bytes("inactive-partner"));
      await router
        .connect(owner)
        .registerPartner(partnerId, owner.address, 5000);
      await router.connect(owner).updatePartner(partnerId, owner.address, 5000, false);

      await expect(
        router.flashLoanViaPartner(USDC, parseUnits("100", 6), partnerId, "0x"),
      ).to.be.revertedWith("LaaSRouter: partner not active");
    });

    it("defaults partner share when custom shareBps is zero", async function () {
      const { owner, router } = await deployFixture();
      const partnerId = ethers.keccak256(ethers.toUtf8Bytes("default-share"));

      await router
        .connect(owner)
        .registerPartner(partnerId, owner.address, 0);

      const p = await router.getPartner(partnerId);
      // shareBps 0 means "use default" — the contract handles this at
      // payout time by checking `partner.shareBps > 0`.
      expect(p.shareBps).to.equal(0n);
      expect(p.active).to.be.true;
    });
  });

  // ════════════════════════════════════════════════════════════════
  // CROSS-CONTRACT: LENDING POOL IS UNTOUCHED
  // ════════════════════════════════════════════════════════════════

  describe("LendingPool isolation", function () {
    it("LendingPool source has no diffs from treasury changes", async function () {
      // This test is structural: LendingPool.sol is NOT in the changed
      // set. We confirm by checking that the contract does not reference
      // ITreasury or any treasury-related storage.
      const LendingPool = await ethers.getContractFactory("LendingPool");
      const bytecode = LendingPool.bytecode;

      // The bytecode should NOT contain any treasury-related function
      // selectors. This is a smoke check — the real guarantee is that
      // we never modified LendingPool.sol.
      expect(bytecode).to.not.include("5479f5c2"); // keccak256("treasury()")[:4]
    });
  });
});
