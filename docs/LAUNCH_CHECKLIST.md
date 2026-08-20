# Lendora Arc Testnet Launch Checklist

## Verified in Repository

- [x] Solidity compiler version is `0.8.24`.
- [x] EVM target is `paris`.
- [x] Hardhat compilation succeeds for `arc_testnet`.
- [x] Contract tests pass.
- [x] No `SELFDESTRUCT` usage exists in protocol contracts.
- [x] No `block.prevrandao` usage exists in protocol contracts.
- [x] Stablecoin protocol accounting uses 6-decimal ERC-20 units.
- [x] LendingPool state-changing entry points use `nonReentrant`.
- [x] LendingPool user operations and reserve initialization use `whenNotPaused`.
- [x] State changes emit protocol or inherited OpenZeppelin events.
- [x] Public contract APIs include NatSpec documentation.
- [x] Six frontend ABI files are generated from Hardhat artifacts.
- [x] Next.js production build succeeds.
- [x] Frontend contract addresses are sourced from `frontend/constants/deployments.json`.
- [x] Three.js and Framer Motion client boundaries compile successfully.
- [x] Lucide icons use named imports.
- [x] No production frontend `console.log` statements remain.

## Before Deployment

- [ ] Review all risk parameters: LTV, liquidation threshold, and liquidation bonus (target USDC 70/80, EURC 60/78).
- [ ] If deploying onto an existing pool, run `scripts/update_risk_params.ts` as owner.
- [ ] Confirm aToken/DebtToken ownership is renounced after secure deploy.
- [ ] Confirm oracle seed prices and identify the operator authorized to update them.
- [ ] Fund the deployer with Arc Testnet USDC from `https://faucet.circle.com`.
- [ ] Store `PRIVATE_KEY` only in `contracts/.env`; never commit or log it.
- [ ] Run `npm run contracts:test`.
- [ ] Run `npm run contracts:compile`.
- [ ] Obtain an independent smart contract review before any non-testnet use.

## Deployment

- [ ] Run `npm run contracts:deploy`.
- [ ] Save the emitted deployment JSON.
- [ ] Verify all contracts on `https://testnet.arcscan.app`.
- [ ] Confirm the AddressesProvider entries match the deployed pool, oracle, and rate model.
- [ ] Confirm both USDC and EURC reserves are active.
- [ ] Perform a small supply, borrow, repay, and withdraw transaction.
- [ ] Test pause and unpause with the owner account.

## Frontend Configuration

- [ ] Copy deployment addresses into `frontend/constants/deployments.json`.
- [ ] Copy deployment addresses into `frontend/.env.local` where applicable.
- [ ] Run `npm run frontend:build`.
- [ ] Confirm wallet switching to Arc Testnet works.
- [ ] Confirm the ArcScan transaction links point to the correct transactions.
- [ ] Confirm the Circle App Kit bridge only offers compatible testnet routes.
- [ ] Confirm Unified Balance errors and empty balances are handled.

## Launch Smoke Test

- [ ] New wallet can obtain faucet USDC.
- [ ] Wallet can connect and read Arc USDC balance.
- [ ] Supply approval and supply transaction succeed.
- [ ] aToken balance appears and accrues.
- [ ] Borrow respects available borrowing power.
- [ ] Debt balance accrues after time advances.
- [ ] Repay supports partial and maximum repayment.
- [ ] Unsafe withdrawal reverts.
- [ ] Healthy positions cannot be liquidated.
- [ ] Unhealthy positions can be liquidated with the configured close factor and bonus.
- [ ] Mobile dashboard, lend, borrow, and liquidation pages remain usable.

## Operational Readiness

- [ ] Assign and secure protocol owner keys.
- [ ] Establish an oracle update procedure and monitoring.
- [ ] Monitor `ReserveInterestAccrued`, `Borrow`, `Repay`, and `LiquidationCall` events.
- [ ] Define incident criteria for pausing the pool.
- [ ] Document deployed addresses and deployment transaction hashes.
- [ ] Keep enough native USDC gas balance in operational wallets.
