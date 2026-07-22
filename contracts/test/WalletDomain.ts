import { expect } from "chai";
import { ethers } from "hardhat";

async function deployWalletDomain() {
  const [owner, other] = await ethers.getSigners();
  const WalletDomain = await ethers.getContractFactory("WalletDomain");
  const walletDomain = await WalletDomain.deploy();

  return { owner, other, walletDomain };
}

async function mintDomain(walletDomain: any, signer: any, name: string) {
  const secret = ethers.keccak256(ethers.toUtf8Bytes(`${name}:${signer.address}`));
  const commitment = await walletDomain.makeCommitment(name, signer.address, secret);
  await walletDomain.connect(signer).commitDomain(commitment);
  return walletDomain.connect(signer).mintDomain(name, secret);
}

describe("WalletDomain", function () {
  it("mints normalized domains, resolves safely, and exposes enumerable ownership", async function () {
    const { owner, walletDomain } = await deployWalletDomain();

    await expect(mintDomain(walletDomain, owner, "sammy"))
      .to.emit(walletDomain, "DomainMinted")
      .withArgs(owner.address, "sammy", await walletDomain.tokenIdOf("sammy"));

    const tokenId = await walletDomain.tokenIdOf("sammy");
    expect(await walletDomain.resolveDomain("sammy")).to.equal(owner.address);
    expect(await walletDomain.resolveDomain("unknown")).to.equal(ethers.ZeroAddress);
    expect(await walletDomain.isRegistered("sammy")).to.equal(true);
    expect(await walletDomain.isRegistered("unknown")).to.equal(false);
    expect(await walletDomain.balanceOf(owner.address)).to.equal(1n);
    expect(await walletDomain.tokenOfOwnerByIndex(owner.address, 0)).to.equal(tokenId);
    expect(await walletDomain.tokenByIndex(0)).to.equal(tokenId);
    expect(await walletDomain.domainNames(tokenId)).to.equal("sammy");
  });

  it("binds commitments to the intended wallet", async function () {
    const { owner, other, walletDomain } = await deployWalletDomain();
    const secret = ethers.keccak256(ethers.toUtf8Bytes("private-domain-secret"));
    const commitment = await walletDomain.makeCommitment("sammy", owner.address, secret);
    await walletDomain.connect(owner).commitDomain(commitment);

    await expect(
      walletDomain.connect(other).mintDomain("sammy", secret),
    ).to.be.revertedWithCustomError(walletDomain, "InvalidCommitment");
    await walletDomain.connect(owner).mintDomain("sammy", secret);
    expect(await walletDomain.resolveDomain("sammy")).to.equal(owner.address);
  });

  it("rejects invalid names and duplicate registrations", async function () {
    const { owner, walletDomain } = await deployWalletDomain();

    await expect(walletDomain.mintDomain("", ethers.ZeroHash)).to.be.revertedWithCustomError(
      walletDomain,
      "InvalidDomainName",
    );
    await expect(walletDomain.mintDomain("ab", ethers.ZeroHash)).to.be.revertedWithCustomError(
      walletDomain,
      "InvalidDomainName",
    );
    await expect(walletDomain.mintDomain("-sammy", ethers.ZeroHash)).to.be.revertedWithCustomError(
      walletDomain,
      "InvalidDomainName",
    );
    await expect(walletDomain.mintDomain("sammy-", ethers.ZeroHash)).to.be.revertedWithCustomError(
      walletDomain,
      "InvalidDomainName",
    );
    await expect(walletDomain.mintDomain("Sammy", ethers.ZeroHash)).to.be.revertedWithCustomError(
      walletDomain,
      "InvalidDomainName",
    );
    await expect(walletDomain.mintDomain("sammy.arc", ethers.ZeroHash)).to.be.revertedWithCustomError(
      walletDomain,
      "InvalidDomainName",
    );

    await mintDomain(walletDomain, owner, "sammy");
    const secondSecret = ethers.keccak256(ethers.toUtf8Bytes("sammy-again"));
    const secondCommitment = await walletDomain.makeCommitment("sammy", owner.address, secondSecret);
    await walletDomain.commitDomain(secondCommitment);
    await expect(walletDomain.mintDomain("sammy", secondSecret)).to.be.revertedWithCustomError(
      walletDomain,
      "ERC721InvalidSender",
    );
  });

  it("stores primary domains on-chain and clears stale primary state after transfer", async function () {
    const { owner, other, walletDomain } = await deployWalletDomain();

    await mintDomain(walletDomain, owner, "sammy");
    await expect(walletDomain.setPrimaryDomain("sammy"))
      .to.emit(walletDomain, "PrimaryDomainSet")
      .withArgs(owner.address, "sammy", await walletDomain.tokenIdOf("sammy"));

    expect(await walletDomain.primaryDomainOf(owner.address)).to.equal("sammy");

    await walletDomain.transferFrom(owner.address, other.address, await walletDomain.tokenIdOf("sammy"));

    expect(await walletDomain.primaryDomainOf(owner.address)).to.equal("");
    expect(await walletDomain.resolveDomain("sammy")).to.equal(other.address);
    await expect(walletDomain.setPrimaryDomain("sammy")).to.be.revertedWithCustomError(
      walletDomain,
      "DomainNotOwned",
    );

    await walletDomain.connect(other).setPrimaryDomain("sammy");
    expect(await walletDomain.primaryDomainOf(other.address)).to.equal("sammy");
  });

  it("burns owned domains, clears primary state, and frees the name", async function () {
    const { owner, other, walletDomain } = await deployWalletDomain();

    await mintDomain(walletDomain, owner, "sammy");
    const tokenId = await walletDomain.tokenIdOf("sammy");
    await walletDomain.setPrimaryDomain("sammy");

    await expect(walletDomain.connect(other).burnDomain("sammy")).to.be.revertedWithCustomError(
      walletDomain,
      "DomainNotOwned",
    );

    await expect(walletDomain.burnDomain("sammy"))
      .to.emit(walletDomain, "DomainBurned")
      .withArgs(owner.address, "sammy", tokenId);

    expect(await walletDomain.resolveDomain("sammy")).to.equal(ethers.ZeroAddress);
    expect(await walletDomain.isRegistered("sammy")).to.equal(false);
    expect(await walletDomain.primaryDomainOf(owner.address)).to.equal("");
    expect(await walletDomain.domainNames(tokenId)).to.equal("");

    await mintDomain(walletDomain, other, "sammy");
    expect(await walletDomain.resolveDomain("sammy")).to.equal(other.address);
  });

  it("returns inline metadata for registered domains", async function () {
    const { owner, walletDomain } = await deployWalletDomain();

    await mintDomain(walletDomain, owner, "sammy");
    const tokenURI = await walletDomain.tokenURI(await walletDomain.tokenIdOf("sammy"));

    expect(tokenURI).to.match(/^data:application\/json;base64,/);
    const metadata = JSON.parse(
      Buffer.from(tokenURI.split(",")[1], "base64").toString("utf8"),
    );
    expect(metadata.name).to.equal("sammy.arclend");
  });
});
