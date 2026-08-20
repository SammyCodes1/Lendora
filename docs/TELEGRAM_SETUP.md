# Lendora Telegram Setup

Lendora ships a non-custodial Telegram assistant: a **bot** for conversational
read access (health factor, balances, market rates) and a **Telegram Mini App**
for signing write actions (supply, borrow, repay, swap, send) from the user's
own wallet via WalletConnect.

The bot never holds a private key and cannot sign anything. It validates an
intended action with the same `validateAgentAction()` used by the web app,
stores the prepared transaction in Redis with a short TTL, and hands the user a
Mini App deep link to review and sign.

```text
User <-> Bot (telegram-bot/, long-polling)
          |  POST /api/agent            (x-api-key auth)
          |  Redis pendingtx:{txRefId}
          v
Mini App (/telegram?tx=txRefId)  -> WalletConnect wallet -> sign -> Arc Testnet
```

## 1. Create the Telegram bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram.
2. `/newbot`, choose a name and username, copy the **bot token**.
3. `/newapp` (or `/newapp`) on the new bot to create the Mini App. Set a title
   and upload an icon. Telegram returns a **Mini App URL** — that is your app's
   production URL, e.g. `https://arclend.vercel.app/telegram`.
4. In BotFather settings for your app, optionally restrict the app to your
   test group until launch.

The Mini App must be served from the same origin as the bot's `web_app` button.
The bot opens `${APP_URL}/telegram` (and `${APP_URL}/telegram?tx=…` for signing).

## 2. WalletConnect project ID

1. Sign in at [cloud.walletconnect.com](https://cloud.walletconnect.com).
2. Create a project → copy the **Project ID**.
3. Add your app's production domain to the project's allowed origins.

The Mini App connects wallets through `wagmi`'s `walletConnect` connector
(`showQrModal: false`), so the WebView renders its own pairing-URI fallback.

## 3. Upstash Redis

1. Create an account at [upstash.com](https://upstash.com) and a Redis database.
2. Copy `UPSTASH_REDIS_URL` and `UPSTASH_REDIS_TOKEN` from the console.

Redis stores three key types:

| Key | Purpose | TTL |
|-----|---------|-----|
| `telegram:{userId}:wallet` | Linked wallet address | 90 d |
| `telegram:{userId}:nonce` | Anti-replay linking nonce | 5 min |
| `pendingtx:{txRefId}` | Prepared, validated transaction | 5 min |

## 4. Environment variables

Add these to the **frontend** `.env.local` (Next.js app):

```bash
TELEGRAM_BOT_TOKEN=123456789:ABC...          # from @BotFather
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=xyz     # from WalletConnect Cloud
BOT_API_KEY=a-long-random-secret             # shared with the bot
UPSTASH_REDIS_URL=https://...                # from Upstash
UPSTASH_REDIS_TOKEN=...
```

And to **telegram-bot/.env**:

```bash
TELEGRAM_BOT_TOKEN=123456789:ABC...
BOT_API_KEY=a-long-random-secret             # must match the frontend value
UPSTASH_REDIS_URL=https://...
UPSTASH_REDIS_TOKEN=...
NEXT_PUBLIC_APP_URL=https://arclend.vercel.app   # or http://localhost:3000
```

`BOT_API_KEY` is the shared secret the bot sends as the `x-api-key` header to
`/api/agent`. The agent route accepts it only when present; the web UI is
unaffected when the header is absent.

> **Never** put `TELEGRAM_BOT_TOKEN` in client code, URLs, or logs. The bot
> token and `BOT_API_KEY` are server-side only.

## 5. Run the bot

From `telegram-bot/`:

```bash
npm install
npm run dev      # tsx watch, local dev
# or
npm start        # node dist/index.js after npm run build
```

The bot polls Telegram (long-polling) and logs `starting with long-polling…`
when ready.

## 6. Link a wallet and try it

1. Open your bot in Telegram → **/start** → tap **Open Lendora**.
2. In the Mini App, **Connect Wallet** (WalletConnect). If your wallet app does
   not auto-open, copy the pairing URI shown and paste it into the wallet.
3. Tap **Link to Telegram** and approve the signature. Your address is now bound
   to your Telegram user id for 90 days.
4. Back in the chat: *"what's my health factor"* → the bot answers directly.
5. Try *"supply 10 USDC"* → the bot prepares the action and replies with the
   **Open Lendora** button. Tap it, review, **Confirm & Execute**, and sign in
   your wallet. The transaction lands on Arc Testnet and the Mini App shows the
   ArcScan link.

## Security model

- **initData HMAC**: every Mini App request carries Telegram's signed `initData`.
  `lib/server/telegramAuth.ts` recomputes the HMAC with `WebAppData` and rejects
  forged payloads (401).
- **Wallet linking**: the user signs a fresh single-use nonce bound to their
  Telegram user id; `verifyMessage` proves wallet ownership. Nonces are deleted
  after use, so a captured initData+signature pair cannot be replayed.
- **Prepared transactions**: the bot stores `{ validatedAction, telegramUserId,
  createdAt, expiresAt }` under a random `txRefId` (UUID). Only the matching
  Telegram user may read it (`403` otherwise), it expires in 5 minutes (`410`),
  and `tx-consume` deletes it after signing — a transaction cannot be signed
  twice.
- **Re-validation**: the Mini App re-validates the action against current onchain
  state before signing and refuses if the connected wallet differs from the
  validated wallet.
- **No keys in the bot**: the bot process signs nothing. It only prepares and
  reads; signing happens in the user's wallet.

## Files

**Frontend (Next.js)**
- `app/api/telegram/nonce/route.ts` — issue anti-replay nonce
- `app/api/telegram/link/route.ts` — verify initData + wallet signature, bind wallet
- `app/api/telegram/pending-tx/[txRefId]/route.ts` — serve prepared tx (auth + TTL)
- `app/api/telegram/tx-consume/route.ts` — mark tx consumed (delete from Redis)
- `app/telegram/page.tsx`, `app/telegram/TelegramMiniApp.tsx` — Mini App
- `lib/server/telegramAuth.ts`, `lib/server/botAuth.ts`, `lib/server/redis.ts`
- `lib/telegramLinkMessage.ts` — shared signed-message format
- `lib/wagmi.ts` — `walletConnect` connector added

**Bot (telegram-bot/)**
- `src/index.ts` — grammY bot, free-text agent calls, pending-tx handoff
- `src/context.ts` — builds `AgentContext` from onchain reads
- `src/redis.ts` — Upstash client
