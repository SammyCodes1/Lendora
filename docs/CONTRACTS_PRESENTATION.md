# Lendora Contracts Presentation

## Slide 1: What Lendora Is

- Lendora is a pooled lending and borrowing protocol built for Arc Testnet.
- Users supply 6-decimal stablecoins such as USDC and EURC.
- Supplied assets become collateral when the reserve allows collateral use.
- Borrowers can borrow against collateral up to the configured LTV.
- The protocol tracks supply and debt with indexed tokens.
- Liquidators can repay unhealthy debt and receive discounted collateral.

Speaker note:
Lendora behaves like a compact Aave-style money market. The core pool owns accounting and risk checks, while helper contracts add receipts, vaults, and wallet domains around it.

## Slide 2: Contract Map

```text
                         LendingPoolAddressesProvider
                                      |
                                      v
                                LendingPool
             supply / withdraw / borrow / repay / liquidate
                    |                 |                  |
                    v                 v                  v
                 AToken           DebtToken       MockPriceOracle
                    |                 |                  |
                    |                 |                  v
                    |                 |          USD prices, 8 decimals
                    |                 |
                    +-------- InterestRateModel --------+

           PositionManager -> PositionNFT
           EarnVault -> LendingPool
           WalletDomain -> DomainMarketplace
```

Speaker note:
The LendingPool is the center of the system. Most other contracts either wrap pool actions, represent pool positions, or support account identity.

## Slide 3: Core LendingPool Responsibilities

- Initializes reserves with an underlying asset, aToken, debt token, and risk parameters.
- Accepts supplies and mints aTokens.
- Allows withdrawals by burning aTokens.
- Allows borrowing by minting non-transferable debt tokens.
- Accepts repayments and burns debt tokens.
- Liquidates accounts whose health factor falls below 1.0.
- Accrues interest before reserve-changing operations.
- Lets the owner configure oracle, rate model, caps, reserve flags, and pause state.

Speaker note:
The pool is both the ledger and the gatekeeper. Every meaningful state transition goes through it so health checks, index updates, token transfers, and reserve totals stay synchronized.

## Slide 4: Reserve State

Each reserve stores:

- `underlyingAsset`: the 6-decimal ERC-20 asset.
- `aToken`: indexed supplier claim token.
- `debtToken`: indexed borrower obligation token.
- `liquidityIndex`: grows supplier balances over time.
- `borrowIndex`: grows borrower debt over time.
- `totalLiquidity`: indexed total supplied amount.
- `totalBorrowed`: indexed total debt amount.
- `ltv`: borrowing power basis points.
- `liquidationThreshold`: health factor basis points.
- `liquidationBonus`: liquidator reward basis points.
- `isActive`, `isBorrowingEnabled`, `isCollateralEnabled`: reserve switches.

Speaker note:
Risk settings live per reserve. That lets USDC and EURC have different LTVs, liquidation thresholds, bonuses, and caps.

## Slide 5: Supply Flow

```text
User approves LendingPool or PositionManager
        |
        v
LendingPool.supply(asset, amount, onBehalfOf)
        |
        v
Accrue reserve interest
        |
        v
Check supply cap
        |
        v
Mint aTokens to beneficiary
        |
        v
Pull exact underlying tokens into pool
        |
        v
Enable collateral automatically if reserve allows it
```

Speaker note:
The pool mints indexed aTokens first, then pulls the exact underlying amount. Transfer checks reject fee-on-transfer behavior, which protects accounting assumptions.

## Slide 6: aToken Mechanics

- aTokens represent supplier claims on the pool.
- Balances are stored internally as scaled balances.
- User-facing balance equals `scaledBalance * liquidityIndex / 1e27`.
- `liquidityIndex` increases when supply interest accrues.
- aTokens are non-transferable by normal ERC-20 transfer paths.
- The pool can burn aTokens for withdrawals and liquidations.
- The pool can transfer aTokens during liquidation if the liquidator chooses to receive aToken collateral.

Speaker note:
Scaled balances avoid updating every supplier on every block. The index changes globally, and user balances reflect the current index when read.

## Slide 7: Borrow Flow

```text
User has enabled collateral
        |
        v
LendingPool.borrow(asset, amount, onBehalfOf)
        |
        v
Check borrowing enabled and delegate permission
        |
        v
Check pool liquidity
        |
        v
Accrue reserve interest
        |
        v
Check borrow cap
        |
        v
Calculate account data and borrow value
        |
        v
Mint indexed debt token
        |
        v
Send underlying asset to caller
```

Speaker note:
Borrowing is constrained by collateral value, reserve LTV, available liquidity, and caps. Delegated borrowing is supported through `borrowDelegates`.

## Slide 8: DebtToken Mechanics

- DebtToken represents borrower obligations.
- It is non-transferable and cannot be approved for transfer.
- Balances are stored as scaled debt.
- User-facing debt equals `scaledDebt * borrowIndex / 1e27`.
- `borrowIndex` increases as borrow interest accrues.
- The pool mints debt on borrow.
- The pool burns debt on repay, liquidation, or bad-debt write-off.

Speaker note:
Debt balances grow through the borrow index rather than per-user updates. This is the mirror of the aToken design.

## Slide 9: Interest Rate Model

- Uses a kinked utilization curve.
- Base borrow APR: 2%.
- Optimal utilization: 80%.
- Slope below optimal: 10%.
- Slope above optimal: 100%.
- Borrow rate is converted from annual ray precision to per-second ray precision.
- Supply rate equals `borrowRate * utilization`.

```text
Utilization = totalBorrowed / totalLiquidity

Below 80%:
Borrow APR = base + utilization / optimal * slope1

Above 80%:
Borrow APR = base + slope1 + excessUtilization / remainingRange * slope2
```

Speaker note:
Rates increase slowly until 80% utilization, then climb sharply. This encourages repayment or new supply when liquidity becomes scarce.

## Slide 10: Interest Accrual

```text
borrowGrowth = 1e27 + borrowRatePerSecond * elapsedSeconds
supplyGrowth = 1e27 + supplyRatePerSecond * elapsedSeconds

newBorrowIndex = oldBorrowIndex * borrowGrowth / 1e27
newLiquidityIndex = oldLiquidityIndex * supplyGrowth / 1e27
```

- Accrual is linearized per second.
- Accrual runs before supply, withdraw, borrow, repay, liquidation, and some admin updates.
- Updated indexes are pushed into AToken and DebtToken.
- Reserve totals are refreshed from token total supplies.

Speaker note:
The pool does lazy accrual. Instead of updating continuously, it updates indexes when someone interacts with a reserve.

## Slide 11: Account Data And Health Factor

The pool loops over all reserves and calculates:

- Total enabled collateral value in 8-decimal USD.
- Total debt value in 8-decimal USD.
- Weighted average LTV.
- Weighted average liquidation threshold.
- Available borrow value.
- Health factor.

```text
Borrow limit = collateralUSD * weightedLTV
Available borrows = borrowLimit - debtUSD

Health factor =
collateralUSD * weightedLiquidationThreshold / debtUSD
```

- No debt returns maximum health factor.
- `HF >= 1.0` is solvent.
- `HF < 1.0` is liquidatable.

Speaker note:
LTV controls new borrowing. Liquidation threshold controls when the position becomes unsafe.

## Slide 12: Withdraw And Collateral Disable Flow

- User calls `withdraw(asset, amount, to)`.
- Pool accrues interest.
- Pool checks aToken balance and available underlying liquidity.
- Pool burns aTokens.
- If the user has debt, the pool recomputes health factor.
- Withdrawal reverts if health factor would fall below 1.0.
- Underlying asset is transferred to the receiver.
- If the user has no remaining aToken balance, collateral is disabled for that asset.

Speaker note:
Withdrawals are allowed only when they do not make existing debt unsafe.

## Slide 13: Repay Flow

- User calls `repay(asset, amount, onBehalfOf)`.
- Pool accrues interest.
- Pool reads the borrower debt.
- Repayment amount is capped to the outstanding debt.
- Pool burns debt tokens.
- Pool pulls exact underlying repayment tokens.
- Reserve total borrowed is refreshed.

Speaker note:
Repayment can be done by the borrower or another address. The account whose debt is reduced is passed as `onBehalfOf`.

## Slide 14: Liquidation Flow

```text
Liquidator selects collateralAsset, debtAsset, user, debtToCover
        |
        v
Pool verifies user is unhealthy: HF < 1.0
        |
        v
Debt to cover is capped by close factor: 50%
        |
        v
Pool computes collateral equivalent using oracle prices
        |
        v
Liquidation bonus is added
        |
        v
DebtToken is burned from borrower
        |
        v
Liquidator pays debt asset
        |
        v
Collateral is sent as underlying or transferred as aTokens
```

Speaker note:
The liquidator repays part of the borrower's debt and receives collateral at a discount. The implementation caps one liquidation call at 50% of the borrower's debt for that asset.

## Slide 15: Bad Debt Write-Off

- Owner-only governance action.
- Requires the user to have debt.
- Requires no remaining enabled collateral.
- Burns the user's remaining debt token balance for a reserve.
- Applies lender loss by reducing the reserve liquidity index.
- Updates total liquidity and total borrowed.

Speaker note:
This is a recovery mechanism for debt that cannot be liquidated because collateral has been exhausted. It socializes loss to suppliers through a lower liquidity index.

## Slide 16: Oracle Design

- `MockPriceOracle` stores owner-managed USD prices.
- Prices use 8 decimals.
- Constructor seeds USDC and EURC prices.
- Each token can have min and max bounds.
- Optional `maxPriceAge` can enforce stale-price rejection.
- LendingPool can use a fallback oracle if the primary oracle reverts or returns invalid data.

Speaker note:
This oracle is explicitly testnet-oriented. A production deployment would need a live oracle with robust manipulation resistance.

## Slide 17: Addresses Provider

- Stores the registered LendingPool address.
- Exposes the pool's current price oracle.
- Exposes the pool's current interest rate model.
- Owner can update the pool address.
- Oracle and rate model registry updates validate against the LendingPool's actual configured values.

Speaker note:
The provider is a lightweight registry. It does not own the LendingPool; it reflects addresses used by the system.

## Slide 18: Position Receipts

```text
User -> PositionManager -> LendingPool
                    |
                    v
              PositionNFT receipt
```

- `PositionManager` wraps supply and borrow actions.
- On first supply or borrow for an asset, it mints a `PositionNFT`.
- `PositionNFT` is a non-transferable ERC-721 receipt.
- Each receipt points to a live aToken or debt token.
- Metadata reads the current linked-token balance.
- Existing positions can be claimed if the user already has a live balance.
- A receipt can be closed only after the linked balance is zero.

Speaker note:
Position NFTs are not the source of truth. They are account-bound receipts that display live balances from the actual aToken or debt token.

## Slide 19: Earn Vault

- Accepts one stablecoin asset.
- Supplies deposits into LendingPool on behalf of the vault.
- Mints ERC-20 vault shares to depositors.
- `totalAssets()` includes idle assets plus the vault's live aToken value.
- Withdrawals burn shares and return assets from idle balance first.
- If idle balance is insufficient, the vault withdraws from LendingPool.
- Owner can add rewards by depositing assets without minting new shares.

Speaker note:
EarnVault packages lending into a simpler share-based product. Users hold vault shares instead of managing pool supply positions directly.

## Slide 21: Wallet Domains

- `WalletDomain` is an ERC-721 domain registry.
- Domain names must be 3 to 32 characters.
- Allowed characters are lowercase letters, digits, and hyphens.
- Names cannot start or end with a hyphen.
- Minting uses commit and reveal to reduce same-block name sniping.
- Owners can set a primary domain.
- Domain resolution maps a name to its owner.
- Burning clears the domain name record.

Speaker note:
Wallet domains provide human-readable identity around Lendora accounts. The token ID is derived from the hash of the domain name.

## Slide 22: Domain Marketplace

- Lets domain owners list domain NFTs for a stablecoin price.
- Requires seller ownership and marketplace approval.
- Sellers can update or cancel listings.
- Buyers call `buy(tokenId, maxPrice)`.
- Purchase transfers payment token from buyer to seller.
- Domain NFT is transferred from seller to buyer.
- Stale listings can be cleared if ownership or approval is no longer valid.

Speaker note:
The marketplace is intentionally narrow: escrow is not used. It checks approval and ownership at purchase time, then performs payment and NFT transfer atomically.

## Slide 23: Deployed Arc Testnet Setup

- Chain ID: `5042002`.
- LendingPool: `0x1D1d19F958cDB6FA2e6C7E5DC16F0a39fe066c9f`.
- AddressesProvider: `0xC48674acd3CafDd5746A94B5144eA57672592bF3`.
- PriceOracle: `0x5D401B38686245B57Efb682828877a3124d36653`.
- FallbackPriceOracle: `0x39f74EB42C061E7eCA04232063DeE66E7CD1358B`.
- InterestRateModel: `0x635C19a64bbcd09E5D70eFFE06484eb1E4D70190`.
- USDC reserve asset: `0x3600000000000000000000000000000000000000`.
- EURC reserve asset: `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`.

Speaker note:
The deployment includes both USDC and EURC markets, position receipts, domains, marketplace, and earn vaults.

## Slide 24: Risk Configuration

USDC:

- LTV: 75%.
- Liquidation threshold: 80%.
- Liquidation bonus: 5%.
- Supply cap: 1,000,000 USDC.
- Borrow cap: 700,000 USDC.

EURC:

- LTV: 70%.
- Liquidation threshold: 78%.
- Liquidation bonus: 6%.
- Supply cap: 1,000,000 EURC.
- Borrow cap: 700,000 EURC.

Speaker note:
USDC has slightly higher borrow power and lower liquidation bonus than EURC. Both markets are capped for testnet exposure control.

## Slide 25: Security Boundaries

- LendingPool user entry points use `ReentrancyGuard`.
- User operations can be paused.
- Token movement uses `SafeERC20`.
- Exact transfer checks reject fee-on-transfer tokens.
- Reserve assets must use 6 decimals.
- Oracle prices must be non-zero and 8 decimals.
- aTokens and debt tokens are non-transferable.
- Liquidations are capped by a 50% close factor.
- Owner controls reserve parameters, caps, oracle, rate model, and pause state.

Speaker note:
The security model is centered on strict accounting assumptions: 6-decimal stablecoins, exact transfers, controlled indexes, and owner-managed risk configuration.

## Slide 26: End-To-End User Journey

```text
1. User gets Arc Testnet stablecoins.
2. User supplies USDC or EURC.
3. Pool mints aTokens and enables collateral.
4. User borrows against available collateral.
5. Debt grows through the borrow index.
6. Supply balance grows through the liquidity index.
7. User repays debt or withdraws safe collateral.
8. If health factor drops below 1.0, liquidation becomes available.
```

Speaker note:
This is the core protocol loop. Everything else in the repository either improves UX, records positions, adds identity, or adds incentives.

## Slide 27: Main Takeaways

- LendingPool is the protocol's core accounting and risk engine.
- AToken and DebtToken implement scalable indexed balances.
- InterestRateModel prices debt based on utilization.
- MockPriceOracle provides bounded testnet pricing.
- PositionManager and PositionNFT turn pool activity into non-transferable receipts.
- EarnVault turns pool supply into a share-based savings product.
- WalletDomain and DomainMarketplace add identity and secondary trading.

Speaker note:
Lendora is best understood as a lending pool first, with product-layer contracts around it.
