# Lendora

Lendora is a full-stack DeFi lending and borrowing protocol on **Arc Network Mainnet**. Users supply stablecoins, borrow against collateral, repay debt, withdraw liquidity, and monitor liquidation opportunities from a Next.js interface.

Live network: Arc Mainnet (`5042`). Canonical addresses live in `constants/deployments-mainnet.json`.

## What Is Lendora?

Lendora is a USDC-first money market. Protocol contracts model lending reserves, interest-bearing aTokens, non-transferable debt tokens, a kinked interest-rate model, a Chainlink price oracle with a fallback feed, and liquidation flows. Product-layer contracts add position receipts, earn vaults, wallet domains, a USDC/EURC swap pool, treasury, and payments.

The frontend provides dashboard, lend, borrow, earn, swap, bridge, domains, and liquidation pages with wallet connectivity through wagmi and viem.

## Arc Network Overview

Arc is Circle's EVM-compatible Layer 1 for stablecoin applications. On Arc Mainnet, USDC is the native gas token, so transactions are paid in USDC rather than ETH. Arc is compatible with standard Solidity tooling such as Hardhat, viem, and wagmi, and its deterministic sub-second finality makes it a strong fit for payment, lending, and treasury workflows.

## Architecture

```text
                     +-----------------------------+
                     |        Next.js Frontend     |
                     | Dashboard / Lend / Borrow   |
                     | Earn / Swap / Bridge / Domains
                     +--------------+--------------+
                                    |
                                    | wagmi + viem
                                    v
          +-------------------------+--------------------------+
          |                  Arc Network Mainnet               |
          |              USDC native gas, EVM compatible       |
          +-------------------------+--------------------------+
                                    |
        +---------------------------+---------------------------+
        |                           |                           |
+-------v-------+          +--------v--------+          +-------v-------+
|  LendingPool  |<-------->| Price Oracle    |          | Rate Model    |
| supply/borrow |          | Chainlink USD   |          | kinked APR    |
+-------+-------+          +--------+--------+          +---------------+
        |                           |
        | mints / burns             v
        v                    Fallback oracle
+-------+--------+       +----------------+
|    AToken      |       |   DebtToken    |
| supply shares  |       | non-transfer   |
+----------------+       +----------------+
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full contract map, reserve accounting, risk parameters, and security boundaries.

## Repository Structure

```text
arclend/
├── app/                # Next.js App Router pages and API routes
├── components/         # UI: markets, modals, wallet, agent
├── constants/          # Mainnet deployments, ABIs, CCTP addresses
├── contracts/          # Solidity / Hardhat project
├── docs/               # Architecture and product docs
├── hooks/              # wagmi / protocol hooks
├── lib/                # Markets, swap, bridge, pay helpers
├── telegram-bot/       # Lendora Telegram assistant
└── README.md
```

## Quick Start

```bash
git clone https://github.com/SammyCodes1/Lendora.git
cd arclend
```

Install and compile contracts:

```bash
cd contracts
npm install
cp .env.example .env
npm run compile
```

Configure `contracts/.env`:

```text
PRIVATE_KEY=your_wallet_private_key
ARC_MAINNET_RPC_URL=https://rpc.mainnet.arc.io
CHAIN_ID=5042
```

The protocol is already deployed on Arc Mainnet. Use `npx hardhat run <script> --network arc_mainnet` only for owner operations against the live deployment.

Run the frontend:

```bash
cd ..
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. The app targets Arc Mainnet (`5042`).

Verification:

```bash
cd contracts
npm test
npm run export-abi
cd ..
npx tsc --noEmit --incremental false
npm run build
```

## Contract Addresses

Arc Mainnet, chain ID `5042`. Source of truth: `constants/deployments-mainnet.json`.

### Core protocol

| Contract | Address |
| --- | --- |
| AddressesProvider | `0xBDC3F5e9cc6af3b125A45d177E65C67154fa008c` |
| LendingPool | `0x3Fa2817A41F8a00583A7c73DaB4Ab2DB7237266A` |
| InterestRateModel | `0xB88fc006A0cdE6a44963014c22abbC32bAe69739` |
| PriceOracle (Chainlink) | `0x362C26d4C6EBDB976499BC30c35E71bA1D051F7c` |
| FallbackPriceOracle | `0xbee561CF55b5976213325EdBa41839b6277908de` |
| Treasury | `0x59eA806D4F33c48C68C400392D8D5754621Ea5dd` |

### Markets

| Asset | Underlying | aToken | DebtToken |
| --- | --- | --- | --- |
| USDC | `0x3600000000000000000000000000000000000000` | `0xD709d29D35D99370f75770fC48dBEa3aE6277eB4` | `0xCC4606AD0F663f5f8316511416B349cf49204bE6` |
| EURC | `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1` | `0x4D7F912075EF21A400125821f1dA303DF7e1444A` | `0x0Dbdb60D7068E7957BBef669d9Ee93a9b68CAb75` |

### Product contracts

| Contract | Address |
| --- | --- |
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

## Arc Mainnet Details

- RPC: `https://rpc.mainnet.arc.io`
- Chain ID: `5042`
- Explorer: `https://explorer.arc.io`
- Native gas: USDC
- USDC ERC-20: `0x3600000000000000000000000000000000000000`
- EURC ERC-20: `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1`

## Get USDC on Arc

USDC is native gas on Arc. Bridge USDC from Ethereum, Base, Polygon, or Arbitrum through the in-app Circle App Kit flow, or send Arc USDC to the wallet you will connect.

Keep part of the wallet balance available for gas instead of supplying the entire balance.

## Features

- Supply USDC/EURC collateral and receive interest-bearing aTokens.
- Borrow stablecoins against supplied collateral.
- Repay, withdraw, and monitor health factor.
- Liquidation page for finding unhealthy borrower positions.
- Earn vaults that wrap pool supply into share tokens.
- USDC/EURC constant-product swap pool.
- Circle App Kit bridge from Ethereum, Base, Polygon, and Arbitrum to Arc Mainnet.
- Circle Unified Balance display with per-chain Gateway balances and transfer-to-Arc controls.
- Chainlink price oracle with a fallback feed.
- Kinked utilization-based interest rate model.
- Wallet domains (`.lendora`) and domain marketplace.
- Multi-send, spoken pay, and claim-link drops.
- wagmi/viem wallet integration for Arc Mainnet.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Chain | Arc Network Mainnet |
| Gas token | Native USDC |
| Contracts | Solidity `^0.8.24`, OpenZeppelin v5 |
| Tooling | Hardhat, TypeScript |
| Frontend | Next.js App Router, React, Tailwind CSS |
| Wallet/data | wagmi, viem, TanStack Query |
| Oracle | Chainlink AggregatorV3 (8-decimal USD) |
| Animation | framer-motion, Three.js, React Three Fiber |
| Circle SDKs | Circle App Kit, adapter-viem-v2 |

## Circle App Kit

The frontend uses Circle App Kit with the Viem v2 browser-wallet adapter. Bridge routes are mainnet:

- Ethereum to Arc Mainnet
- Base to Arc Mainnet
- Polygon to Arc Mainnet
- Arbitrum to Arc Mainnet

Unified Balance queries aggregate Gateway USDC for the connected address across supported chains. The "Deposit to Arc" action spends from that unified balance and mints USDC to the connected address on Arc Mainnet. All fund-moving actions require an explicit amount and wallet confirmation.

Arc CCTP and Gateway reference addresses are documented in `constants/cctp.ts` and `constants/contracts.ts`.

## Important Arc Notes

- USDC is native gas on Arc. All gas is paid in USDC, not ETH.
- EVM compatible: deploy with Hardhat/Foundry, write Solidity normally.
- Deterministic sub-second finality: no need to wait multiple confirmations.
- Do not use the `SELFDESTRUCT` opcode during deployment.
- `block.prevrandao` is always `0`; never use it for randomness.
- USDC ERC-20 uses 6 decimals; native gas uses 18 decimals. Never mix.
- For DeFi protocols, always use the ERC-20 interface for USDC amounts.
- The live oracle is `ChainlinkPriceOracle` (`maxStaleness` 24h) with a fallback oracle. Do not point the pool at `MockPriceOracle` on mainnet.
