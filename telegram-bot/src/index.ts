import "dotenv/config";
import { Bot, InlineKeyboard } from "grammy";
import { getRedis } from "./redis";
import { buildAgentContext } from "./context";
import type {
  AgentResponse,
  ValidatedAgentAction,
} from "../../frontend/lib/agentTypes";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is required");
}
const botApiKey = process.env.BOT_API_KEY;
if (!botApiKey) {
  throw new Error("BOT_API_KEY is required");
}

const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const PENDING_TX_TTL_SECONDS = 5 * 60;

const redis = getRedis();
const bot = new Bot(token);

const walletKey = (userId: number) => `telegram:${userId}:wallet`;

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function miniAppKeyboard(path = "") {
  return new InlineKeyboard().webApp("Open ArcLend", `${appUrl}/telegram${path}`);
}

function linkMessage() {
  return (
    "The ArcLend bot never holds your keys. Link your own wallet so I can read your " +
    "positions — actions are prepared here and signed from your wallet inside the Mini App."
  );
}

bot.command("start", async (ctx) => {
  const userId = ctx.from?.id;
  if (userId === undefined) {
    return;
  }
  const wallet = await redis.get<string>(walletKey(userId));
  await ctx.reply(
    wallet
      ? `You're linked as ${shortAddress(wallet)}.\n\n` +
          "Ask about your health factor, balances, or market rates, or tell me an " +
          "action such as \"supply 10 USDC\" or \"repay 5 USDC\". Anything that needs " +
          "a signature opens in the Mini App for you to confirm from your own wallet."
      : `Welcome to the ArcLend assistant.\n\n${linkMessage()}`,
    { reply_markup: miniAppKeyboard() },
  );
});

bot.command("link", async (ctx) => {
  await ctx.reply(linkMessage(), {
    reply_markup: miniAppKeyboard(),
  });
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "I can answer questions about your ArcLend positions (health factor, balances, " +
      "market rates) and prepare actions (supply, borrow, repay, swap, send).\n\n" +
      "Actions are never signed by the bot — you confirm and sign them from your own " +
      "wallet in the Mini App.",
    { reply_markup: miniAppKeyboard() },
  );
});

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (!text || text.startsWith("/")) {
    return;
  }
  const userId = ctx.from?.id;
  if (userId === undefined) {
    return;
  }

  const wallet = await redis.get<string>(walletKey(userId));
  if (!wallet) {
    await ctx.reply(
      "You need to link a wallet first. Tap below to open the Mini App and connect your wallet.",
      { reply_markup: miniAppKeyboard() },
    );
    return;
  }

  try {
    const context = await buildAgentContext(wallet);
    const response = await fetch(`${appUrl}/api/agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": botApiKey,
      },
      body: JSON.stringify({ message: text, history: [], context }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        text?: string;
      } | null;
      await ctx.reply(body?.text ?? "The assistant is temporarily unavailable. Please retry.");
      return;
    }

    const result = (await response.json()) as AgentResponse;
    if (result.type === "action") {
      const txRefId = await storePendingTransaction(result.validated, userId);
      await ctx.reply(
        `${result.validated.action.explanation}\n\n` +
          "Review and sign this in the Mini App from your own wallet. It expires in 5 minutes.",
        { reply_markup: miniAppKeyboard(`?tx=${txRefId}`) },
      );
    } else {
      await ctx.reply(result.text);
    }
  } catch (error) {
    console.error("[ArcLend bot] agent request failed", error);
    await ctx.reply("The assistant could not process that request. Please retry.");
  }
});

async function storePendingTransaction(
  validatedAction: ValidatedAgentAction,
  telegramUserId: number,
) {
  const txRefId = crypto.randomUUID();
  const now = Date.now();
  await redis.set(
    `pendingtx:${txRefId}`,
    {
      validatedAction,
      telegramUserId,
      createdAt: now,
      expiresAt: now + PENDING_TX_TTL_SECONDS * 1000,
    },
    { ex: PENDING_TX_TTL_SECONDS },
  );
  return txRefId;
}

bot.catch((error) => {
  console.error("[ArcLend bot] update error", error.error);
});

console.log("[ArcLend bot] starting with long-polling…");
await bot.start({ drop_pending_updates: true });
