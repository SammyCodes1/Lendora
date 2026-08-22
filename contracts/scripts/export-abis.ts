import { artifacts } from "hardhat";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const CONTRACTS = [
  "LendingPool",
  "MockPriceOracle",
  "PythPriceOracle",
  "AToken",
  "DebtToken",
  "InterestRateModel",
  "LendingPoolAddressesProvider",
  "PositionNFT",
  "PositionManager",
  "WalletDomain",
  "DomainMarketplace",
  "EarnVault",
  "RecurringOrderExecutor",
  "SwapPool",
  "SpokenPay",
] as const;

async function main() {
  const outputDirectories = [
    path.resolve(__dirname, "../../frontend/constants/abis"),
    path.resolve(__dirname, "../../constants/abis"),
  ];

  for (const outputDirectory of outputDirectories) {
    await mkdir(outputDirectory, { recursive: true });
  }

  await Promise.all(
    CONTRACTS.flatMap((contractName) =>
      outputDirectories.map(async (outputDirectory) => {
        const artifact = await artifacts.readArtifact(contractName);
        const outputPath = path.join(outputDirectory, `${contractName}.json`);
        await writeFile(
          outputPath,
          `${JSON.stringify(artifact.abi, null, 2)}\n`,
          "utf8",
        );
      }),
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
