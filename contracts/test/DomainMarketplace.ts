import { expect } from "chai";
import { ethers } from "hardhat";

async function deployFixture() {
  const [seller, buyer] = await ethers.getSigners();

  const WalletDomain = await ethers.getContractFactory("WalletDomain");
  const walletDomain = await WalletDomain.deploy();
  await walletDomain.waitForDeployment();

  const MockStablecoin = await ethers.getContractFactory("MockStablecoin");
  const usdc = await MockStablecoin.deploy("USD Coin", "USDC");
  await usdc.waitForDeployment();

  const DomainMarketplace = await ethers.getContractFactory("DomainMarketplace");
  const marketplace = await DomainMarketplace.deploy(
    await walletDomain.getAddress(),
    await usdc.getAddress(),
  );
  await marketplace.waitForDeployment();

  return { seller, buyer, walletDomain, usdc, marketplace };
}

async function mintDomain(walletDomain: any, signer: any, name: string) {
  const secret = ethers.keccak256(ethers.toUtf8Bytes(`${name}:${signer.address}`));
  const commitment = await walletDomain.makeCommitment(name, signer.address, secret);
  await walletDomain.connect(signer).commitDomain(commitment);
  await walletDomain.connect(signer).mintDomain(name, secret);
}

describe("DomainMarketplace", function () {
  it("lists and sells a domain for USDC", async function () {
    const { seller, buyer, walletDomain, usdc, marketplace } =
      await deployFixture();
    const price = ethers.parseUnits("25", 6);

    await mintDomain(walletDomain, seller, "sammy");
    const tokenId = await walletDomain.tokenIdOf("sammy");
    await walletDomain.connect(seller).approve(await marketplace.getAddress(), tokenId);
    await usdc.mint(buyer.address, price);
    await usdc.connect(buyer).approve(await marketplace.getAddress(), price);

    await expect(marketplace.connect(seller).listDomain("sammy", price))
      .to.emit(marketplace, "DomainListed")
      .withArgs(tokenId, seller.address, price);

    await expect(marketplace.connect(buyer).buy(tokenId, price))
      .to.emit(marketplace, "DomainPurchased")
      .withArgs(tokenId, seller.address, buyer.address, price);

    expect(await walletDomain.ownerOf(tokenId)).to.equal(buyer.address);
    expect(await usdc.balanceOf(seller.address)).to.equal(price);
    expect((await marketplace.listings(tokenId)).seller).to.equal(
      ethers.ZeroAddress,
    );
  });

  it("requires marketplace approval before listing", async function () {
    const { seller, walletDomain, marketplace } = await deployFixture();
    const price = ethers.parseUnits("10", 6);

    await mintDomain(walletDomain, seller, "sammy");

    await expect(
      marketplace.connect(seller).listDomain("sammy", price),
    ).to.be.revertedWithCustomError(marketplace, "MarketplaceNotApproved");
  });

  it("lets the seller cancel a listing", async function () {
    const { seller, walletDomain, marketplace } = await deployFixture();
    const price = ethers.parseUnits("10", 6);

    await mintDomain(walletDomain, seller, "sammy");
    const tokenId = await walletDomain.tokenIdOf("sammy");
    await walletDomain.connect(seller).approve(await marketplace.getAddress(), tokenId);
    await marketplace.connect(seller).list(tokenId, price);

    await expect(marketplace.connect(seller).cancelListing(tokenId))
      .to.emit(marketplace, "DomainListingCancelled")
      .withArgs(tokenId, seller.address);

    expect((await marketplace.listings(tokenId)).seller).to.equal(
      ethers.ZeroAddress,
    );
  });

  it("blocks purchase if the seller no longer owns the domain", async function () {
    const { seller, buyer, walletDomain, usdc, marketplace } =
      await deployFixture();
    const price = ethers.parseUnits("25", 6);

    await mintDomain(walletDomain, seller, "sammy");
    const tokenId = await walletDomain.tokenIdOf("sammy");
    await walletDomain.connect(seller).approve(await marketplace.getAddress(), tokenId);
    await marketplace.connect(seller).list(tokenId, price);
    await walletDomain.connect(seller).transferFrom(seller.address, buyer.address, tokenId);
    await usdc.mint(buyer.address, price);
    await usdc.connect(buyer).approve(await marketplace.getAddress(), price);

    await expect(
      marketplace.connect(buyer).buy(tokenId, price),
    ).to.be.revertedWithCustomError(marketplace, "SellerNoLongerOwnsDomain");

    await expect(marketplace.connect(buyer).clearStaleListing(tokenId))
      .to.emit(marketplace, "DomainListingCancelled")
      .withArgs(tokenId, seller.address);
    expect((await marketplace.listings(tokenId)).seller).to.equal(
      ethers.ZeroAddress,
    );
  });

  it("rejects a purchase when the listing price exceeds the buyer's reviewed maximum", async function () {
    const { seller, buyer, walletDomain, usdc, marketplace } =
      await deployFixture();
    const reviewedPrice = ethers.parseUnits("25", 6);
    const updatedPrice = ethers.parseUnits("30", 6);

    await mintDomain(walletDomain, seller, "sammy");
    const tokenId = await walletDomain.tokenIdOf("sammy");
    await walletDomain.connect(seller).approve(await marketplace.getAddress(), tokenId);
    await marketplace.connect(seller).list(tokenId, reviewedPrice);
    await marketplace.connect(seller).updateListing(tokenId, updatedPrice);
    await usdc.mint(buyer.address, updatedPrice);
    await usdc.connect(buyer).approve(await marketplace.getAddress(), updatedPrice);

    await expect(
      marketplace.connect(buyer).buy(tokenId, reviewedPrice),
    ).to.be.revertedWithCustomError(marketplace, "PriceExceedsMaximum");
    expect(await walletDomain.ownerOf(tokenId)).to.equal(seller.address);
  });

  it("rejects unsolicited safe transfers of domain NFTs", async function () {
    const { seller, walletDomain, marketplace } = await deployFixture();

    await mintDomain(walletDomain, seller, "sammy");
    const tokenId = await walletDomain.tokenIdOf("sammy");

    await expect(
      walletDomain
        .connect(seller)
        ["safeTransferFrom(address,address,uint256)"](
          seller.address,
          await marketplace.getAddress(),
          tokenId,
        ),
    ).to.be.reverted;
    expect(await walletDomain.ownerOf(tokenId)).to.equal(seller.address);
  });
});
