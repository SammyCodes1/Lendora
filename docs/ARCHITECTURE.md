# Lendora Architecture

Lendora is a pooled stablecoin lending protocol designed for Arc Testnet. Protocol amounts use each stablecoin's 6-decimal ERC-20 interface. Arc's native USDC gas representation is used only by the network for transaction fees.

## Smart Contract Layer

```text
LendingPoolAddressesProvider -> LendingPool <-> AToken / DebtToken
                                      |               |
                                      v               v
                                 PriceOracle    InterestRateModel
                                      |
                                      v
                              MockPriceOracle (testnet)
```

### Responsibilities

- `LendingPoolAddressesProvider`: owner-managed registry for the pool, oracle, and rate model.
- `LendingPool`: reserve accounting and user actions: supply, withdraw, borrow, repay, collateral selection, and liquidation.
- `AToken`: transferable, interest-bearing claim represented with scaled balances and a global liquidity index.
- `DebtToken`: non-transferable borrower obligation represented with scaled balances and a global borrow index.
- `InterestRateModel`: kinked utilization curve returning per-second ray rates.
- `MockPriceOracle`: owner-managed 8-decimal USD prices for Arc Testnet.

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

### Default risk parameters (post-audit)

| Asset | LTV | Liquidation threshold | Max-borrow HF (approx.) |
|---|---|---|---|
| USDC | 70% | 80% | ~1.14 |
| EURC | 60% | 78% | ~1.30 |

EURC LTV is set lower than USDC to reduce cross-stable depeg / correlated-collateral risk.

## Supplier risk

- At high utilization, withdrawals are limited by **pool cash**, not aToken balance alone.
- If debt cannot be recovered after liquidations, the owner may call `writeOffBadDebt`, which socializes loss by reducing the reserve liquidity index (aToken haircut).

## Liquidations

A liquidator may cover at most 50% of a borrower's total debt value per call. The liquidator transfers the debt asset to the pool and receives the borrower's underlying collateral plus the configured reserve bonus, capped by available borrower collateral.

## Arc Network Key Properties

- Chain ID: `5042002`
- RPC: `https://rpc.testnet.arc.network`
- WebSocket RPC: `wss://rpc.testnet.arc.network`
- USDC is native gas; all transaction fees are paid in USDC.
- Sub-second deterministic finality means one confirmation is final.
- EVM compatible with Solidity, Hardhat, Foundry, viem, and ethers.
- Explorer: `https://testnet.arcscan.app`
- Faucet: `https://faucet.circle.com`
- USDC ERC-20 interface: `0x3600000000000000000000000000000000000000`

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

### Live risk-param update

To apply LTV buffers on an existing deployment without redeploying:

```bash
cd contracts
# owner key required
npx hardhat run scripts/update_risk_params.ts --network arc_testnet
```

Lendora is custom protocol code and has not been independently audited. Testnet deployment should not be treated as production security validation.
