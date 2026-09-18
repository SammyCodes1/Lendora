# Lendora Architecture

Lendora is a pooled stablecoin lending protocol on **Arc Mainnet** (chain ID `5042`). Protocol amounts use each stablecoin's 6-decimal ERC-20 interface. Arc's native USDC gas representation is used only by the network for transaction fees.

Canonical addresses: `constants/deployments-mainnet.json` (mirrored in `contracts/deployments/arc-mainnet.json`).

## Smart Contract Layer

```text
LendingPoolAddressesProvider -> LendingPool <-> AToken / DebtToken
                                      |               |
                                      v               v
                          ChainlinkPriceOracle   InterestRateModel
                                      |
                                      v
                              FallbackPriceOracle

PositionManager -> PositionNFT
EarnVault USDC / EURC -> LendingPool
WalletDomain -> DomainMarketplace
SwapPool (USDC/EURC) -> Treasury
SpokenPay / MultiSend / ArcDrop / RecurringOrderExecutor
```

### Core responsibilities

- `LendingPoolAddressesProvider`: owner-managed registry for the pool, oracle, and rate model.
- `LendingPool`: reserve accounting and user actions: supply, withdraw, borrow, repay, collateral selection, and liquidation.
- `AToken`: transferable, interest-bearing claim represented with scaled balances and a global liquidity index.
- `DebtToken`: non-transferable borrower obligation represented with scaled balances and a global borrow index.
- `InterestRateModel`: kinked utilization curve returning per-second ray rates.
- `ChainlinkPriceOracle`: primary USD prices via AggregatorV3 feeds, normalized to 8 decimals, with a 24h staleness bound.
- `FallbackPriceOracle`: used when the primary feed is missing or stale.

### Product-layer contracts

- `PositionManager` / `PositionNFT`: wrap pool supply and borrow into non-transferable position receipts.
- `EarnVault` (USDC and EURC): share-based wrappers that supply into the pool on behalf of depositors.
- `WalletDomain`: ERC-721 `.lendora` names (commit-reveal mint; 3-character names pay 0.1 USDC to Treasury).
- `DomainMarketplace`: atomic listing and purchase of domain NFTs for stablecoin.
- `SwapPool`: independent constant-product AMM for the USDC/EURC pair; LP token `ALP-USDC-EURC`; swap fee default 0.30% with a treasury share.
- `Treasury`: protocol-owned fee collector for SwapPool and future revenue sources.
- `MultiSend`: batch USDC/EURC transfers (max 200 recipients per call).
- `SpokenPay`: recurring payments to a pinned `.lendora` name or address, gated by a health-factor floor.
- `ArcDrop` (Lendrop): escrow claim-link drops for USDC and EURC.
- `RecurringOrderExecutor`: on-chain authorization limits for off-chain scheduled swaps.

## Reserve Accounting

Each reserve stores:

- Underlying ERC-20 asset, aToken, and debt token addresses.
- Liquidity and borrow indices in ray precision (`1e27`).
- Total liquidity and total borrowed values in 6-decimal asset units.
- LTV, liquidation threshold, and liquidation bonus in basis points.
- Active, borrowing, and collateral flags.

Interest is accrued before state-changing reserve operations. The implementation uses a linear per-second approximation:

```text
newBorrowIndex = oldBorrowIndex * (1e27 + borrowRatePerSecond * elapsed) / 1e27
newLiquidityIndex = oldLiquidityIndex * (1e27 + supplyRatePerSecond * elapsed) / 1e27
```

## Interest Rate Model

- Base Rate: 2% APR
- Optimal Utilization: 80%
- Slope 1 below optimal: +10% APR
- Slope 2 above optimal: +100% APR

> **Note (linear accrual):** Indices use a linear per-second approximation rather than continuous compounding. Over long idle periods without reserve interactions this understates true compound interest slightly. Accrual still runs on every supply/borrow/repay/withdraw/liquidation.

Below the kink:

```text
Borrow APR = Base Rate + (Utilization / Optimal Utilization) * Slope 1
```

Example at 50% utilization:

```text
2% + (50 / 80 * 10%) = 8.25% APR
```

Above the kink, the full base rate and slope 1 are charged, then slope 2 is applied proportionally across the remaining 20% utilization range.

The supply rate is:

```text
Supply Rate = Borrow Rate * Utilization
```

## Health Factor Formula

```text
HF = (sum(collateralUSD * liquidationThreshold)) / sum(debtUSD)
```

- `HF > 1.0`: position is above the liquidation threshold.
- `HF = 1.0`: position is at the liquidation threshold.
- `HF < 1.0`: position is liquidatable.
- No debt: health factor is `type(uint256).max`.

Borrowing power uses the reserve-weighted LTV rather than the liquidation threshold.

Post-borrow, the pool also requires `healthFactor >= 1.0` after debt is minted (defense in depth beyond the LTV gate).

### Live mainnet risk parameters

From `constants/deployments-mainnet.json`:

| Asset | LTV | Liquidation threshold | Liquidation bonus | Supply cap | Borrow cap |
|---|---|---|---|---|---|
| USDC | 75% | 80% | 5% | 1,000,000 | 700,000 |
| EURC | 70% | 78% | 6% | 1,000,000 | 700,000 |

EURC LTV is set lower than USDC to reduce cross-stable depeg / correlated-collateral risk.

Oracle freshness: primary `maxPriceAge` 86400s (24h), fallback `maxPriceAge` 604800s (7d).

## Supplier risk

- At high utilization, withdrawals are limited by **pool cash**, not aToken balance alone.
- If debt cannot be recovered after liquidations, the owner may call `writeOffBadDebt`, which socializes loss by reducing the reserve liquidity index (aToken haircut).

## Liquidations

A liquidator may cover at most 50% of a borrower's total debt value per call. The liquidator transfers the debt asset to the pool and receives the borrower's underlying collateral plus the configured reserve bonus, capped by available borrower collateral.

## Oracle

Primary: `ChainlinkPriceOracle` at `0x362C26d4C6EBDB976499BC30c35E71bA1D051F7c`.

- Reads `AggregatorV3Interface.latestRoundData()`.
- Requires a positive answer and `block.timestamp - updatedAt <= maxStaleness` (default 86,400 seconds).
- Normalizes feed decimals to 8.

Fallback: `0xbee561CF55b5976213325EdBa41839b6277908de`.

The pool queries primary then fallback. Prices must be non-zero and 8 decimals. `MockPriceOracle` is a Hardhat/test helper and is not the live mainnet oracle.

## Arc Network Key Properties

- Chain ID: `5042`
- RPC: `https://rpc.mainnet.arc.io`
- Explorer: `https://explorer.arc.io`
- USDC is native gas; all transaction fees are paid in USDC.
- Sub-second deterministic finality means one confirmation is final.
- EVM compatible with Solidity, Hardhat, Foundry, viem, and ethers.
- USDC ERC-20 interface: `0x3600000000000000000000000000000000000000`
- EURC ERC-20: `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1`

## Deployed mainnet map

| Contract | Address |
| --- | --- |
| Deployer | `0x48d38B9311294DdC4Aa4c3CB21E84B865FFB9438` |
| AddressesProvider | `0xBDC3F5e9cc6af3b125A45d177E65C67154fa008c` |
| LendingPool | `0x3Fa2817A41F8a00583A7c73DaB4Ab2DB7237266A` |
| InterestRateModel | `0xB88fc006A0cdE6a44963014c22abbC32bAe69739` |
| ChainlinkPriceOracle | `0x362C26d4C6EBDB976499BC30c35E71bA1D051F7c` |
| FallbackPriceOracle | `0xbee561CF55b5976213325EdBa41839b6277908de` |
| Treasury | `0x59eA806D4F33c48C68C400392D8D5754621Ea5dd` |
| USDC aToken | `0xD709d29D35D99370f75770fC48dBEa3aE6277eB4` |
| USDC DebtToken | `0xCC4606AD0F663f5f8316511416B349cf49204bE6` |
| EURC aToken | `0x4D7F912075EF21A400125821f1dA303DF7e1444A` |
| EURC DebtToken | `0x0Dbdb60D7068E7957BBef669d9Ee93a9b68CAb75` |
| PositionNFT | `0x28a5Abec1791A468930c762f995Fbd6Bd9787594` |
| PositionManager | `0xEc72b8D63109B3926D6ACaD833b9caDF71DF31dc` |
| WalletDomain | `0xCfc3116D6Fe956d3329b0BB1CF9e564b3EE6ff29` |
| DomainMarketplace | `0x9AC8c1Da3501f73C8ec7f2356a0Fda44C405559E` |
| EarnVault USDC | `0x208Af80035A2009Ec0373264623E417C2c26c6eB` |
| EarnVault EURC | `0x819068a43Ec7f7367B025B7dF0FAbeAdf70F173f` |
| SwapPool | `0x5Eb309a76C6E993293CD756d938BBb35F3bFd35f` |
| MultiSend | `0x1D58E2a0b7C4cF87c38Dc7daF24c83Eb411eD633` |
| SpokenPay | `0x43F347697c52002bB5a845651444D892806D41c3` |
| ArcDrop | `0x06a611B840f55b40c8d5c4130478f626cCcC421f` |
| RecurringOrderExecutor | `0x917538F82EAD2872eE44a776C8CbbD5cbB9a943E` |

Deployment block: `21146069`.

## Frontend and integrations

The Next.js app is pinned to Arc Mainnet (`hooks/useActiveDeployment.ts`). Wallet transport uses `https://rpc.mainnet.arc.io` with a same-origin `/api/rpc/mainnet` fallback.

Circle App Kit bridges USDC from Ethereum, Base, Polygon, and Arbitrum onto Arc. CCTP TokenMessenger V2 on Arc Mainnet: `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`.

## Security Boundaries

- All LendingPool state-changing entry points use `ReentrancyGuard`.
- User operations and reserve initialization are blocked while paused.
- Repay and liquidation remain available while paused (exit / risk-clearing paths).
- Stablecoin transfers use OpenZeppelin `SafeERC20` with exact balance deltas (`_pullExact` / `_pushExact`).
- Oracle prices must be non-zero and use 8 decimals; primary then fallback.
- Stablecoin protocol accounting always uses 6-decimal ERC-20 units.
- Borrow requires both available borrows (LTV) and post-mint health factor ≥ 1.0.
- aToken / DebtToken residual Ownable is renounced after secure deploy (pool is sole minter via `onlyPool`).
- The compiler targets `evmVersion: "paris"` to avoid unsupported `PUSH0` bytecode.
- The contracts do not use `SELFDESTRUCT` or `block.prevrandao`.
- Treasury ownership should be a multi-sig before material fee balances accumulate.

### Live risk-param update

To apply LTV buffers on the existing mainnet deployment without redeploying:

```bash
cd contracts
# owner key required
npx hardhat run scripts/update_risk_params.ts --network arc_mainnet
```

Lendora is custom protocol code and has not been independently audited. Use mainnet at your own risk.
