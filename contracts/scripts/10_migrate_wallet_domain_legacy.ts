import { ethers } from "hardhat";
import { readFile } from "fs/promises";
import path from "path";

const DEPLOYMENT_PATH = path.join(__dirname, "..", "deployments", "arc-testnet.json");
const LEGACY_WALLET_DOMAIN_ADDRESSES = [
  "0x0e3E6992D596ba47a681E975B623A2a38De12427",
  "0xb76568648BfF5F056bf919Da512F61ADb5AF36a6",
] as const;
const LEGACY_SCAN_FROM_BLOCK = 47_643_991;
const SCAN_CHUNK = 10_000;

function normalizeLegacyName(name: string) {
  return name.trim().toLowerCase().replace(/\.arc$/, "");
}

function isValidMigratedName(name: string) {
  return /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(name);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployment = JSON.parse(await readFile(DEPLOYMENT_PATH, "utf8"));
  const WalletDomain = await ethers.getContractFactory("WalletDomain");
  const upgraded = WalletDomain.attach(deployment.WalletDomain);
  const latestBlock = await ethers.provider.getBlockNumber();
  const namesByOwner = new Map<string, Set<string>>();

  for (const legacyAddress of LEGACY_WALLET_DOMAIN_ADDRESSES) {
    const legacy = WalletDomain.attach(legacyAddress);
    for (let from = LEGACY_SCAN_FROM_BLOCK; from <= latestBlock; from += SCAN_CHUNK) {
      const to = Math.min(from + SCAN_CHUNK - 1, latestBlock);
      const events = await legacy.queryFilter(legacy.filters.DomainMinted(), from, to);

      for (const event of events) {
        const owner = event.args.owner.toLowerCase();
        const name = normalizeLegacyName(event.args.domainName);
        if (!isValidMigratedName(name)) continue;

        const names = namesByOwner.get(owner) ?? new Set<string>();
        names.add(name);
        namesByOwner.set(owner, names);
      }
    }
  }

  const deployerAddress = deployer.address.toLowerCase();
  const deployerNames = namesByOwner.get(deployerAddress) ?? new Set<string>();

  for (const name of deployerNames) {
    if (await upgraded.isRegistered(name)) {
      console.log(`Skipping ${name}.arc; already registered`);
      continue;
    }

    const secret = ethers.hexlify(ethers.randomBytes(32));
    const commitment = await upgraded.makeCommitment(name, deployer.address, secret);
    const commitTx = await upgraded.commitDomain(commitment);
    await commitTx.wait();
    const tx = await upgraded.mintDomain(name, secret);
    await tx.wait();
    console.log(`Migrated ${name}.arc to ${deployer.address}: ${tx.hash}`);
  }

  for (const [owner, names] of namesByOwner.entries()) {
    if (owner !== deployerAddress && names.size > 0) {
      console.log(
        `Skipped ${names.size} domain(s) for ${owner}; WalletDomain requires owners to mint their own names.`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
