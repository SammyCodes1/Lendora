# ArcLend

ArcLend is a full-stack DeFi lending and borrowing protocol for Arc Network Testnet. It lets users supply stablecoins, borrow against collateral, repay debt, withdraw supplied liquidity, and monitor liquidation opportunities from a glassmorphic Next.js interface.

## What Is ArcLend?

ArcLend is a USDC-first money market scaffold. The protocol contracts model lending reserves, interest-bearing aTokens, non-transferable debt tokens, a kinked interest-rate model, a mock price oracle for testnet, and liquidation flows. The frontend provides dashboard, lend, borrow, and liquidation pages with wallet connectivity through wagmi and viem.

## Arc Network Overview

Arc is Circle's EVM-compatible Layer 1 for stablecoin applications. On Arc Testnet, USDC is the native gas token, so transactions are paid in USDC rather than ETH. Arc is compatible with standard Solidity tooling such as Hardhat, viem, and wagmi, and its deterministic sub-second finality makes it a strong fit for payment, lending, and treasury workflows.

## Architecture

```text
                     +-----------------------------+
                     |        Next.js Frontend     |
                     |  Dashboard / Lend / Borrow  |
                     |      Liquidations / Wallet  |
                     +--------------+--------------+
                                    |
                                    | wagmi + viem
                                    v
          +-------------------------+--------------------------+
          |                 Arc Network Testnet                |
          |              USDC native gas, EVM compatible       |
          +-------------------------+--------------------------+
                                    |
        +---------------------------+---------------------------+
        |                           |                           |
+-------v-------+          +--------v--------+          +-------v-------+
|  LendingPool  |<-------->| Price Oracle    |          | Rate Model    |
| supply/borrow |          | mock USD prices |          | kinked APR    |
+-------+-------+          +-----------------+          +---------------+
        |
        | mints / burns
        v
+-------+--------+       +----------------+
|    AToken      |       |   DebtToken    |
| supply shares  |       | non-transfer   |
+----------------+       +----------------+
```

## Repository Structure

```text
arclend/
├── contracts/          # Solidity smart contracts (Hardhat project)
├── frontend/           # Next.js 14 App Router frontend
├── scripts/            # Deployment and interaction scripts
└── README.md
```

## Quick Start

```bash
git clone <your-repo-url>
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
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network
CHAIN_ID=5042002
```

Deploy to Arc Testnet:

```bash
npm run deploy:arc
```

Configure frontend:

```bash
cd ../frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Open `http://localhost:3000`.

Run the verification suite before deployment:

```bash
cd contracts
npm test
npm run export-abi
cd ../frontend
npx tsc --noEmit --incremental false
npm run build
```

## Contract Addresses

Deployed Arc Testnet addresses are maintained in
`frontend/constants/deployments.json`. Contract source changes require a new
deployment and an update to that file; existing deployments are immutable.

| Contract | Address |
| --- | --- |
| LendingPool | `<from deployment>` |
| MockPriceOracle | `<from deployment>` |
| InterestRateModel | `<from deployment>` |
| USDC AToken | `<from deployment>` |
| USDC DebtToken | `<from deployment>` |
| EURC AToken | `<from deployment>` |
| EURC DebtToken | `<from deployment>` |

## Arc Testnet Details

- RPC: `https://rpc.testnet.arc.network`
- Chain ID: `5042002`
- Explorer: `https://testnet.arcscan.app`
- Faucet: `https://faucet.circle.com`
- USDC ERC-20: `0x3600000000000000000000000000000000000000`

## Get Testnet USDC

Use Circle's faucet at `https://faucet.circle.com`. Arc uses USDC as native gas, so the same testnet USDC funds both protocol interactions and transaction fees.

## Features

- Supply USDC/EURC collateral and receive interest-bearing aTokens.
- Borrow stablecoins against supplied collateral.
- Repay, withdraw, and monitor health factor.
- Liquidation page for finding unhealthy borrower positions.
- Circle App Kit bridge flow for moving USDC from Sepolia, Base Sepolia, or Polygon Amoy to Arc Testnet.
- Circle Unified Balance display with per-chain Gateway balances and transfer-to-Arc controls.
- Mock price oracle for Arc Testnet development.
- Kinked utilization-based interest rate model.
- Glassmorphic black-and-white UI with 3D animated market background.
- wagmi/viem wallet integration for Arc Testnet.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Chain | Arc Network Testnet |
| Gas token | Native USDC |
| Contracts | Solidity `^0.8.24`, OpenZeppelin v5 |
| Tooling | Hardhat, TypeScript |
| Frontend | Next.js 14 App Router, React, Tailwind CSS |
| Wallet/data | wagmi v2, viem v2, TanStack Query |
| Animation | framer-motion, Three.js, React Three Fiber |
| Circle SDKs | Circle App Kit, adapter-viem-v2 |

## Circle App Kit

The frontend uses Circle App Kit with the Viem v2 browser-wallet adapter. Bridge routes are testnet-only:

- Ethereum Sepolia to Arc Testnet
- Base Sepolia to Arc Testnet
- Polygon Amoy to Arc Testnet

Unified Balance queries aggregate Gateway USDC for the connected address across supported testnets. The "Deposit to Arc" action spends from that unified balance and mints USDC to the connected address on Arc Testnet. All fund-moving actions require an explicit amount and wallet confirmation.

Arc CCTP and Gateway reference addresses are documented in `frontend/constants/cctp.ts`.

## Important Arc Notes

- USDC is native gas on Arc. All gas is paid in USDC, not ETH.
- EVM compatible: deploy with Hardhat/Foundry, write Solidity normally.
- Deterministic sub-second finality: no need to wait multiple confirmations.
- Do not use the `SELFDESTRUCT` opcode during deployment.
- `block.prevrandao` is always `0`; never use it for randomness.
- USDC ERC-20 uses 6 decimals; native gas uses 18 decimals. Never mix.
- For DeFi protocols, always use the ERC-20 interface for USDC amounts.
- `MockPriceOracle` deliberately has no default expiry on testnet. Set
  `maxPriceAge` for expiry testing, and replace it with a live oracle before any
  production deployment.
