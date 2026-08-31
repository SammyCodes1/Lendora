import { ethers } from "hardhat";
import { expect } from "chai";
import type { ContractTransactionResponse, Signer } from "ethers";
import type { Lendrop } from "../typechain-types";

/**
 * ArcDrop test suite
 * ──────────────────
 * Verifies all six scenarios called out in the spec:
 *
 *  1. Equal Split: rejects totalAmount that doesn't divide evenly
 *  2. hasClaimed enforcement — double-claim always reverts
 *  3. Creator cannot claim their own drop
 *  4. Claim All: closes after exactly one claim regardless of maxClaimants
 *  5. cancelDrop / reclaimExpired return exactly remainingAmount
 *  6. Contract balance == sum of active remainingAmounts at all times
 */

const DECIMALS = 6n;
const UNIT = 10n ** DECIMALS;

function toUnits(human: bigint): bigint {
  return human * UNIT;
}

describe("Lendrop", function () {
  let arcDrop: Lendrop;
  let usdc: Awaited<ReturnType<typeof ethers.deployContract>>;
  let creator: Signer;
  let claimant1: Signer;
  let claimant2: Signer;
  let claimant3: Signer;
  let creatorAddr: string;
  let c1Addr: string;
  let c2Addr: string;
  let c3Addr: string;

  beforeEach(async function () {
    [creator, claimant1, claimant2, claimant3] = await ethers.getSigners();
    creatorAddr = await creator.getAddress();
    c1Addr = await claimant1.getAddress();
    c2Addr = await claimant2.getAddress();
    c3Addr = await claimant3.getAddress();

    // Deploy a minimal ERC-20 mock for tests (MockStablecoin always uses 6 decimals)
    usdc = await ethers.deployContract("MockStablecoin", ["USDC", "USDC"]);
    arcDrop = (await ethers.deployContract("Lendrop")) as Lendrop;

    // Mint USDC to creator
    await usdc.mint(creatorAddr, toUnits(100_000n));
    // Approve ArcDrop to spend creator's tokens
    await usdc.connect(creator).approve(await arcDrop.getAddress(), toUnits(100_000n));
  });

  it("exposes Lendrop as the on-chain name", async function () {
    expect(await arcDrop.name()).to.equal("Lendrop");
  });

  // ─── Scenario 1: Equal Split — uneven amount rejected ─────────────────────

  describe("Equal Split — creation validation", function () {
    it("rejects totalAmount that does not divide evenly by maxClaimants", async function () {
      // 10 USDC / 3 claimants = 3.333... — not integer
      await expect(
        arcDrop
          .connect(creator)
          .createDrop(
            await usdc.getAddress(),
            toUnits(10n),
            0, // EQUAL_SPLIT
            3,
            0,
          ),
      ).to.be.revertedWith("ArcDrop: amount must divide evenly across claimants");
    });

    it("accepts totalAmount that divides evenly", async function () {
      // 9 USDC / 3 claimants = 3 USDC each — exact
      await expect(
        arcDrop
          .connect(creator)
          .createDrop(await usdc.getAddress(), toUnits(9n), 0, 3, 0),
      ).not.to.be.reverted;
    });
  });

  // ─── Scenario 2: hasClaimed enforcement ───────────────────────────────────

  describe("Double-claim protection", function () {
    it("rejects a second claim attempt from the same address", async function () {
      // 6 USDC split among 3 claimants = 2 USDC each
      await arcDrop
        .connect(creator)
        .createDrop(await usdc.getAddress(), toUnits(6n), 0, 3, 0);

      await arcDrop.connect(claimant1).claim(1);
      await expect(
        arcDrop.connect(claimant1).claim(1),
      ).to.be.revertedWith("ArcDrop: already claimed");
    });

    it("allows different addresses to each claim once", async function () {
      await arcDrop
        .connect(creator)
        .createDrop(await usdc.getAddress(), toUnits(6n), 0, 3, 0);

      await arcDrop.connect(claimant1).claim(1);
      await arcDrop.connect(claimant2).claim(1);
      await arcDrop.connect(claimant3).claim(1);

      expect(await usdc.balanceOf(c1Addr)).to.equal(toUnits(2n));
      expect(await usdc.balanceOf(c2Addr)).to.equal(toUnits(2n));
      expect(await usdc.balanceOf(c3Addr)).to.equal(toUnits(2n));
    });
  });

  // ─── Scenario 3: Creator cannot claim their own drop ──────────────────────

  describe("Creator self-claim prevention", function () {
    it("reverts when the creator tries to claim their own drop", async function () {
      await arcDrop
        .connect(creator)
        .createDrop(await usdc.getAddress(), toUnits(6n), 0, 3, 0);

      await expect(
        arcDrop.connect(creator).claim(1),
      ).to.be.revertedWith("ArcDrop: creator cannot claim their own drop");
    });
  });

  // ─── Scenario 4: Claim All closes after exactly one claim ─────────────────

  describe("Claim All mode", function () {
    it("first claimant receives the full deposit and drop closes immediately", async function () {
      const total = toUnits(50n);
      await arcDrop
        .connect(creator)
        .createDrop(await usdc.getAddress(), total, 1 /* CLAIM_ALL */, 99, 0);

      await arcDrop.connect(claimant1).claim(1);
      expect(await usdc.balanceOf(c1Addr)).to.equal(total);

      // Drop is now inactive
      const drop = await arcDrop.getDropStatus(1);
      expect(drop.active).to.equal(false);
      expect(drop.remainingAmount).to.equal(0n);
    });

    it("second wallet cannot claim after the first has taken everything", async function () {
      await arcDrop
        .connect(creator)
        .createDrop(
          await usdc.getAddress(),
          toUnits(50n),
          1, // CLAIM_ALL
          99,
          0,
        );

      await arcDrop.connect(claimant1).claim(1);
      await expect(
        arcDrop.connect(claimant2).claim(1),
      ).to.be.revertedWith("ArcDrop: drop is not active");
    });

    it("normalises maxClaimants to 1 regardless of the value passed", async function () {
      await arcDrop
        .connect(creator)
        .createDrop(
          await usdc.getAddress(),
          toUnits(50n),
          1, // CLAIM_ALL
          500, // should be ignored
          0,
        );
      const drop = await arcDrop.getDropStatus(1);
      expect(drop.maxClaimants).to.equal(1n);
    });
  });

  // ─── Scenario 5: cancelDrop / reclaimExpired return exact remainingAmount ─

  describe("cancelDrop", function () {
    it("returns full deposit when no claims have been made", async function () {
      const total = toUnits(30n);
      const before = await usdc.balanceOf(creatorAddr);
      await arcDrop
        .connect(creator)
        .createDrop(await usdc.getAddress(), total, 0, 3, 0);

      await arcDrop.connect(creator).cancelDrop(1);
      const after = await usdc.balanceOf(creatorAddr);
      expect(after).to.equal(before); // net zero after deposit + refund
    });

    it("returns only the unclaimed remainder after partial claims", async function () {
      // 6 USDC / 3 = 2 each. One claims, then creator cancels.
      const total = toUnits(6n);
      const before = await usdc.balanceOf(creatorAddr);
      await arcDrop
        .connect(creator)
        .createDrop(await usdc.getAddress(), total, 0, 3, 0);

      await arcDrop.connect(claimant1).claim(1); // 2 USDC goes to claimant1

      await arcDrop.connect(creator).cancelDrop(1);
      const after = await usdc.balanceOf(creatorAddr);
      // Creator should get back 4 USDC (deposited 6, lost 2 to claimant1)
      expect(after).to.equal(before - toUnits(2n));
    });

    it("reverts if a non-creator tries to cancel", async function () {
      await arcDrop
        .connect(creator)
        .createDrop(await usdc.getAddress(), toUnits(6n), 0, 3, 0);
      await expect(
        arcDrop.connect(claimant1).cancelDrop(1),
      ).to.be.revertedWith("ArcDrop: not the creator");
    });
  });

  describe("reclaimExpired", function () {
    it("returns remaining amount after expiry", async function () {
      const total = toUnits(6n);
      const before = await usdc.balanceOf(creatorAddr);
      // expires in 1 second
      await arcDrop
        .connect(creator)
        .createDrop(await usdc.getAddress(), total, 0, 3, 1);

      // Wait for expiry by mining a block with future timestamp
      await ethers.provider.send("evm_increaseTime", [5]);
      await ethers.provider.send("evm_mine", []);

      await arcDrop.connect(creator).reclaimExpired(1);
      const after = await usdc.balanceOf(creatorAddr);
      expect(after).to.equal(before); // full refund since nothing was claimed
    });

    it("reverts if drop has not yet expired", async function () {
      await arcDrop
        .connect(creator)
        .createDrop(await usdc.getAddress(), toUnits(6n), 0, 3, 9999);
      await expect(
        arcDrop.connect(creator).reclaimExpired(1),
      ).to.be.revertedWith("ArcDrop: not expired yet");
    });
  });

  // ─── Scenario 6: Contract balance = sum of active remainingAmounts ─────────

  describe("Contract balance invariant", function () {
    it("contract token balance equals sum of all active remainingAmounts", async function () {
      const arcDropAddr = await arcDrop.getAddress();

      // Create two drops
      await arcDrop
        .connect(creator)
        .createDrop(await usdc.getAddress(), toUnits(6n), 0, 3, 0); // drop 1
      await arcDrop
        .connect(creator)
        .createDrop(await usdc.getAddress(), toUnits(9n), 1, 1, 0); // drop 2

      // Contract holds 15 USDC total
      expect(await usdc.balanceOf(arcDropAddr)).to.equal(toUnits(15n));

      // Claimant1 claims from drop 1 (2 USDC)
      await arcDrop.connect(claimant1).claim(1);
      expect(await usdc.balanceOf(arcDropAddr)).to.equal(toUnits(13n));

      // Verify against on-chain remainingAmounts
      const d1 = await arcDrop.getDropStatus(1);
      const d2 = await arcDrop.getDropStatus(2);
      const sumRemaining = d1.remainingAmount + d2.remainingAmount;
      expect(await usdc.balanceOf(arcDropAddr)).to.equal(sumRemaining);

      // Cancel drop 2 — contract should now only hold drop 1's remainder
      await arcDrop.connect(creator).cancelDrop(2);
      const d1b = await arcDrop.getDropStatus(1);
      expect(await usdc.balanceOf(arcDropAddr)).to.equal(d1b.remainingAmount);
    });
  });

  // ─── Full cycle: Equal Split with 3 claimants ─────────────────────────────

  describe("Full Equal Split cycle", function () {
    it("3-claimant drop: each receives 10 USDC, drop closes on third claim", async function () {
      // 30 USDC / 3 claimants = 10 each
      await arcDrop
        .connect(creator)
        .createDrop(await usdc.getAddress(), toUnits(30n), 0, 3, 0);

      await arcDrop.connect(claimant1).claim(1);
      await arcDrop.connect(claimant2).claim(1);

      let drop = await arcDrop.getDropStatus(1);
      expect(drop.active).to.equal(true); // still open after 2/3

      await arcDrop.connect(claimant3).claim(1);

      drop = await arcDrop.getDropStatus(1);
      expect(drop.active).to.equal(false); // closed after 3/3
      expect(drop.remainingAmount).to.equal(0n);

      expect(await usdc.balanceOf(c1Addr)).to.equal(toUnits(10n));
      expect(await usdc.balanceOf(c2Addr)).to.equal(toUnits(10n));
      expect(await usdc.balanceOf(c3Addr)).to.equal(toUnits(10n));
    });
  });

  // ─── Full cycle: Claim All ─────────────────────────────────────────────────

  describe("Full Claim All cycle", function () {
    it("first claimer takes everything; second visitor sees drop as closed", async function () {
      const total = toUnits(100n);
      await arcDrop
        .connect(creator)
        .createDrop(await usdc.getAddress(), total, 1 /* CLAIM_ALL */, 1, 0);

      await arcDrop.connect(claimant1).claim(1);
      expect(await usdc.balanceOf(c1Addr)).to.equal(total);

      const drop = await arcDrop.getDropStatus(1);
      expect(drop.active).to.equal(false);

      await expect(
        arcDrop.connect(claimant2).claim(1),
      ).to.be.revertedWith("ArcDrop: drop is not active");
    });
  });

  // ─── Allowlist ────────────────────────────────────────────────────────────

  describe("Allowlist", function () {
    it("rejects an empty allowlist", async function () {
      await expect(
        arcDrop
          .connect(creator)
          .createDropAllowlisted(
            await usdc.getAddress(),
            toUnits(6n),
            0,
            3,
            0,
            [],
          ),
      ).to.be.revertedWith("ArcDrop: empty allowlist");
    });

    it("rejects a zero address in the allowlist", async function () {
      await expect(
        arcDrop
          .connect(creator)
          .createDropAllowlisted(
            await usdc.getAddress(),
            toUnits(6n),
            0,
            3,
            0,
            [c1Addr, "0x0000000000000000000000000000000000000000"],
          ),
      ).to.be.revertedWith("ArcDrop: zero address");
    });

    it("rejects duplicate allowlist addresses", async function () {
      await expect(
        arcDrop
          .connect(creator)
          .createDropAllowlisted(
            await usdc.getAddress(),
            toUnits(6n),
            0,
            3,
            0,
            [c1Addr, c1Addr],
          ),
      ).to.be.revertedWith("ArcDrop: duplicate allowlist address");
    });

    it("lets an allowlisted wallet claim and blocks everyone else", async function () {
      await arcDrop
        .connect(creator)
        .createDropAllowlisted(
          await usdc.getAddress(),
          toUnits(6n),
          0,
          3,
          0,
          [c1Addr, c2Addr],
        );

      expect(await arcDrop.allowlistEnabled(1)).to.equal(true);
      expect(await arcDrop.isAllowlisted(1, c1Addr)).to.equal(true);
      expect(await arcDrop.isAllowlisted(1, c3Addr)).to.equal(false);

      await arcDrop.connect(claimant1).claim(1);
      expect(await usdc.balanceOf(c1Addr)).to.equal(toUnits(2n));

      await expect(
        arcDrop.connect(claimant3).claim(1),
      ).to.be.revertedWith("ArcDrop: not on this drop's allowlist");

      await arcDrop.connect(claimant2).claim(1);
      expect(await usdc.balanceOf(c2Addr)).to.equal(toUnits(2n));
    });

    it("keeps createDrop open to any wallet", async function () {
      await arcDrop
        .connect(creator)
        .createDrop(await usdc.getAddress(), toUnits(6n), 0, 3, 0);

      expect(await arcDrop.allowlistEnabled(1)).to.equal(false);
      expect(await arcDrop.isAllowlisted(1, c3Addr)).to.equal(true);

      await arcDrop.connect(claimant3).claim(1);
      expect(await usdc.balanceOf(c3Addr)).to.equal(toUnits(2n));
    });
  });
});
