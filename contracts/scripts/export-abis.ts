import { artifacts } from "hardhat";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const CONTRACTS = [
  "LendingPool",
  "MockPriceOracle",
  "AToken",
  "DebtToken",
  "InterestRateModel",
  "LendingPoolAddressesProvider",
  "PositionNFT",
  "PositionManager",
  "WalletDomain",
  "DomainMarketplace",
  "EarnVault",
  "EarnReferralController",
] as const;

async function main() {
  const outputDirectory = path.resolve(__dirname, "../../frontend/constants/abis");
  await mkdir(outputDirectory, { recursive: true });

  await Promise.all(
    CONTRACTS.map(async (contractName) => {
      const artifact = await artifacts.readArtifact(contractName);
      const outputPath = path.join(outputDirectory, `${contractName}.json`);
      await writeFile(outputPath, `${JSON.stringify(artifact.abi, null, 2)}\n`, "utf8");
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
