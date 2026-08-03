import type { Address } from "viem";

export type MarketAsset = {
  name: string;
  symbol: "USDC" | "EURC";
  address: Address;
  aToken: Address;
  debtToken: Address;
  price: bigint;
  priceDecimals: number;
  supplyApy: string;
  supplyApyValue: number;
  borrowApr: string;
  borrowAprValue: number;
  totalSupply: bigint;
  totalBorrow: bigint;
  availableLiquidity: bigint;
  /** Actual IERC20 balance of the lending pool (cash available to withdraw/borrow). */
  poolCash: bigint;
  totalSupplyUsd: bigint;
  totalBorrowUsd: bigint;
  availableLiquidityUsd: bigint;
  poolCashUsd: bigint;
  /** On-chain supply cap in 6-decimal asset units. 0 = uncapped. */
  supplyCap: bigint;
  /** On-chain borrow cap in 6-decimal asset units. 0 = uncapped. */
  borrowCap: bigint;
  supplyCapUsd: bigint;
  borrowCapUsd: bigint;
  /** Remaining room under the supply cap (0 when uncapped is represented as null via isSupplyCapped). */
  remainingSupplyCap: bigint;
  remainingBorrowCap: bigint;
  remainingSupplyCapUsd: bigint;
  remainingBorrowCapUsd: bigint;
  isSupplyCapped: boolean;
  isBorrowCapped: boolean;
  utilization: number;
  ltv: number;
  liquidationThreshold: number;
  liquidationBonus: number;
  isActive: boolean;
  isBorrowingEnabled: boolean;
  isCollateralEnabled: boolean;
  settledUserSupply: bigint;
  userSupply: bigint;
  accruedSupply: bigint;
  settledUserDebt: bigint;
  userDebt: bigint;
  accruedBorrowInterest: bigint;
  accrualUpdatedAt: bigint;
};
