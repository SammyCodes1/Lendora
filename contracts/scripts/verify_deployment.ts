import fs from "node:fs";
import path from "node:path";
import { artifacts, ethers } from "hardhat";

type Deployment = {
  chainId: number;
  lendingPool: string;
  priceOracle: string;
  fallbackPriceOracle?: string;
  interestRateModel: string;
  addressesProvider: string;
};

const targets: Array<[keyof Deployment, string]> = [
  ["lendingPool", "LendingPool"],
  ["priceOracle", "MockPriceOracle"],
  ["fallbackPriceOracle", "MockPriceOracle"],
  ["interestRateModel", "InterestRateModel"],
  ["addressesProvider", "LendingPoolAddressesProvider"],
];

async function main() {
  const deploymentPath = path.join(__dirname, "..", "deployments", "arc-testnet.json");
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as Deployment;
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== BigInt(deployment.chainId)) {
    throw new Error(`Wrong chain: expected ${deployment.chainId}, received ${network.chainId}`);
  }

  let mismatches = 0;
  for (const [key, contractName] of targets) {
    const address = deployment[key] as string | undefined;
    if (!address) continue;
    const artifact = await artifacts.readArtifact(contractName);
    const onchainCode = await ethers.provider.getCode(address);
    const expectedHash = ethers.keccak256(artifact.deployedBytecode as `0x${string}`);
    const onchainHash = ethers.keccak256(onchainCode as `0x${string}`);
    const matches = expectedHash === onchainHash;
    if (!matches) mismatches += 1;
    console.log(`${contractName} ${address} ${matches ? "MATCH" : "MISMATCH"}`);
    console.log(`  expected ${expectedHash}`);
    console.log(`  on-chain ${onchainHash}`);
  }

  if (mismatches > 0) {
    throw new Error(`${mismatches} deployed contract(s) do not match the compiled artifacts`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
