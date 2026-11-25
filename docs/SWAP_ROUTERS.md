# Swap routers: Tower Exchange + Peach

The public Lendora app is built from the `frontend/` directory (not the repo
root). Production is served at `https://lendora-alpha.vercel.app`. Changes to
the root `app/`, `hooks/` and `lib/` copies are not enough; the same swap
code must also land under `frontend/` or Peach will not appear on the live UI.

Lendora's swap page and the AI assistant's `swap` action quote two routers on
Arc Mainnet (chain `5042`) and use the one with the higher **guaranteed
(minimum) output**. Users can switch routes in the swap widget, and the
assistant uses a specific router only when the user names one ("via Peach").
No Lendora contracts are involved: swaps are sent from the user's wallet
directly to the chosen router.

| Router | Server client | Approval spender | Notes |
| --- | --- | --- | --- |
| Tower Exchange | `lib/server/towerClient.ts` | TowerSwapExecutor `0x2De8906a641d65d490bC60A4179d961d59742bCb` | Needs `TOWER_API_KEY`. |
| Peach Aggregator | `lib/server/peachClient.ts` | Execution Router proxy `0x2528F3190603B85A155D48C31946703d71f921ED` | `GET https://api.peach.ag/arc/router/swap`. `PEACH_API_KEY` is optional. |

## Flow

1. `POST /api/swap/quote` calls both routers in parallel (`Promise.allSettled`).
   Peach needs the connected wallet address because its response is a signed
   transaction for that executor. If one router fails or is not configured,
   the other one is still returned. Response: `{ best, routes: { tower?, peach? }, errors }`
   (legacy Tower fields are kept for compatibility).
2. The Peach response is validated server-side (`lib/peachSwap.ts`) and again
   in the browser before sending. Checks: `tx.to` is the pinned Execution
   Router, `executePlan` selector, zero native value, executor/payer/recipient
   match the wallet, input amount matches, no partial fill, custom fee = 0,
   `amount_out_min` is present and within the requested slippage, and the
   calldata encodes the requested tokens, wallet and amount.
3. The wallet approves the **exact input amount** to the chosen router's
   spender, the Peach plan is simulated with `eth_call`, then the exact
   confirmed transaction is sent. Lendora never re-quotes a Peach swap
   silently. A plan that has expired (120s deadline, minus a 15s safety margin)
   needs a new quote and a new confirmation. `POST /api/swap/prepare` with
   `route: "peach"` returns a refreshed plan only if its minimum output is at
   least the confirmed one (otherwise HTTP 409, `requoteRequired`). For
   Tower, the prepared transaction is rejected if its minimum output is lower
   than the confirmed quote.
4. Peach rate limit is 300 requests/min. A 429 is retried once if
   `Retry-After` is 3s or less; otherwise the error is shown.

## Risks

- The Peach Execution Router is an **upgradeable proxy**, and Peach's
  aggregator docs do not reference an audit of it. Lendora pins the proxy
  address and approves only exact amounts, but users still trust Peach's
  router and signer.
- Quotes expire. Approval transactions can take longer than the quote lifetime;
  the user must then refresh and confirm again.
- Slippage is capped at 500 bps (5%) for the widget and the assistant.
