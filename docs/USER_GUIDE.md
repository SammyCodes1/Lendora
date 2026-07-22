# ArcLend User Guide

## 1. Get Arc Testnet USDC

1. Open `https://faucet.circle.com`.
2. Select Arc Testnet.
3. Enter the wallet address you will connect to ArcLend.
4. Request testnet USDC.
5. Confirm the balance on `https://testnet.arcscan.app`.

Arc uses USDC for transaction fees. Keep part of the wallet balance available for gas instead of supplying the entire balance.

## 2. Add Arc Testnet to MetaMask

Open MetaMask, choose **Add network**, then enter:

| Field | Value |
| --- | --- |
| Network name | Arc Testnet |
| RPC URL | `https://rpc.testnet.arc.network` |
| Chain ID | `5042002` |
| Currency symbol | `USDC` |
| Block explorer | `https://testnet.arcscan.app` |

Save the network and switch to Arc Testnet before using lending actions.

## 3. Supply USDC and Earn APY

1. Open ArcLend and connect your wallet.
2. Select **Lend** or choose **Supply** from the Dashboard market table.
3. Enter a USDC amount.
4. Approve the LendingPool to use that amount through the ERC-20 interface.
5. Confirm the supply transaction.
6. After confirmation, the position appears as aUSDC.

The aUSDC balance grows through the reserve liquidity index. USDC protocol amounts use 6 decimals.

## 4. Borrow Against Collateral

1. Supply an asset and leave it enabled as collateral.
2. Open **Borrow**.
3. Review collateral value, available borrowing power, and health factor.
4. Select USDC or EURC and enter an amount below the displayed maximum.
5. Confirm the borrow transaction.

Borrowing creates a non-transferable debt token. The displayed debt increases through the borrow index.

EURC has a lower maximum LTV than USDC (60% vs 70%) to reduce cross-stable depeg risk when the two assets collateralize each other.

Borrowing through Position NFT receipts may request a one-time **borrow delegate** approval for the Position Manager. You can revoke that approval from the Borrow modal when it is no longer needed.

## 5. Monitor Health Factor

The Borrow page and Dashboard show the current health factor:

- Above `1.5`: stronger buffer against liquidation.
- Between `1.0` and `1.5`: reduced safety margin.
- Below `1.0`: eligible for liquidation.

Health factor can fall when collateral prices decrease or accrued debt increases. Repay debt or add collateral before it reaches `1.0`.

## 6. Repay Loans

1. Open **Borrow** and find the active loan.
2. Select **Repay**.
3. Enter a partial amount or use **MAX**.
4. Approve the debt asset if required.
5. Confirm the repayment.

The pool caps repayment at the current indexed debt balance. A full repayment burns the remaining debt tokens.

## Withdrawing Collateral

Use **Withdraw** from the Lend page. Prefer **MAX**, which is the **safe max** — the lesser of your aToken balance, free pool cash, and the amount that keeps health factor ≥ `1.0`.

The transaction reverts if:

- withdrawal would drop health factor below `1.0` (repay debt first), or
- the pool does not hold enough free cash because funds are borrowed (wait for repayments or withdraw less).

### Supplier risks to know

- High utilization can limit exits even when your aToken balance is large.
- In a rare bad-debt event after failed liquidations, governance may reduce the liquidity index and haircut suppliers of that reserve.

## Cross-Chain USDC

The Dashboard Bridge widget uses Circle App Kit and CCTP for testnet routes from Ethereum Sepolia, Base Sepolia, or Polygon Amoy to Arc Testnet. Review the source network and amount before confirming wallet transactions.
