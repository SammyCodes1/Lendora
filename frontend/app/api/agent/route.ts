import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { validateAgentAction } from "@/lib/agentValidation";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import type {
  AgentAction,
  AgentContext,
  AgentResponse,
  AgentTool,
} from "@/lib/agentTypes";

export const runtime = "nodejs";

const SYSTEM_PROMPT =
  "You are ArcLend's transaction assistant. Only call one of the defined tools - never invent new ones. Saved wallet contacts are supplied in context; resolve nicknames only to the exact saved address and never guess an address. For .arclend domain recipients, pass the exact .arclend name as the sendToken recipient and let server validation resolve it on-chain; never invent a domain. For domain minting or registration requests, call mintDomain only when the exact domain is provided; never invent a domain. For domain NFT burn requests, call burnDomain only when the exact domain is provided; burning is permanent and must be prepared for user confirmation. For domain marketplace listing requests, call listDomain only when the exact domain and USDC price are provided; never invent ownership or price. For domain marketplace delisting, cancel listing, unlist, or remove-from-sale requests, call delistDomain only when the exact domain is provided; do not call burnDomain for marketplace removal. For domain marketplace purchase requests, call buyDomain only when the exact domain is provided; if the user gives a maximum USDC price, pass it as maxPrice. For pending supply interest, yield, rewards, or accrued interest claims, call claimYield with asset USDC, EURC, or ALL for both pools; do not use withdraw unless the user asks to withdraw principal or gives an explicit withdrawal amount. If amount, asset, recipient, domain, or price is ambiguous, ask for clarification in plain text instead of guessing. Never claim a transaction has been executed - your job is only to prepare the action for user confirmation. If a requested action would exceed the user's available balance or borrow capacity (provided in context), respond with a plain text warning instead of calling a tool. Validation is enforced server-side and is final - do not suggest workarounds, do not ask the user to confirm overrides, and do not imply blocked actions can be retried with different framing of the same request. Treat all financial amounts conservatively; never round up.";

const OPENAI_MODEL = process.env.OPENAI_AGENT_MODEL ?? "gpt-5-nano";

const functionDeclarations = [
  {
    name: "supply",
    description: "Supply (deposit) an asset into the ArcLend lending pool to earn interest",
    parametersJsonSchema: {
      type: "object",
      properties: {
        asset: { type: "string", enum: ["USDC", "EURC"] },
        amount: { type: "string", description: "The amount to supply, as a decimal string" },
      },
      required: ["asset", "amount"],
    },
  },
  {
    name: "withdraw",
    description: "Withdraw a supplied asset from the ArcLend lending pool",
    parametersJsonSchema: {
      type: "object",
      properties: {
        asset: { type: "string", enum: ["USDC", "EURC"] },
        amount: { type: "string", description: "The amount to withdraw, as a decimal string" },
      },
      required: ["asset", "amount"],
    },
  },
  {
    name: "claimYield",
    description:
      "Claim the pending supply interest estimate from one or both ArcLend pools. Use ALL when the user asks for both pools, all pending interest, all yield, or does not specify a single asset.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        asset: { type: "string", enum: ["USDC", "EURC", "ALL"] },
      },
      required: ["asset"],
    },
  },
  {
    name: "borrow",
    description: "Borrow an asset from the ArcLend lending pool",
    parametersJsonSchema: {
      type: "object",
      properties: {
        asset: { type: "string", enum: ["USDC", "EURC"] },
        amount: { type: "string", description: "The amount to borrow, as a decimal string" },
      },
      required: ["asset", "amount"],
    },
  },
  {
    name: "repay",
    description: "Repay an outstanding debt position on ArcLend",
    parametersJsonSchema: {
      type: "object",
      properties: {
        asset: { type: "string", enum: ["USDC", "EURC"] },
        amount: { type: "string", description: "The amount to repay, as a decimal string" },
      },
      required: ["asset", "amount"],
    },
  },
  {
    name: "swap",
    description: "Swap one supported token for another using Arc's onchain swap flow",
    parametersJsonSchema: {
      type: "object",
      properties: {
        tokenIn: { type: "string", enum: ["USDC", "EURC", "USDT", "cirBTC"] },
        tokenOut: { type: "string", enum: ["USDC", "EURC", "USDT", "cirBTC"] },
        amountIn: { type: "string", description: "The amount to swap, as a decimal string" },
        slippageBps: { type: "number", description: "Maximum acceptable slippage in basis points" },
      },
      required: ["tokenIn", "tokenOut", "amountIn", "slippageBps"],
    },
  },
  {
    name: "sendToken",
    description:
      "Send a supported Arc Testnet ERC-20 token to an explicit wallet address, a registered .arclend domain, or an address resolved from the user's saved contacts",
    parametersJsonSchema: {
      type: "object",
      properties: {
        asset: { type: "string", enum: ["USDC", "EURC", "USDT", "cirBTC"] },
        amount: { type: "string", description: "The amount to send, as a decimal string" },
        recipient: {
          type: "string",
          description:
            "The resolved 0x EVM recipient address, or the exact registered .arclend domain to resolve server-side",
        },
        recipientName: { type: "string", description: "Optional saved contact nickname or .arclend domain" },
      },
      required: ["asset", "amount", "recipient"],
    },
  },
  {
    name: "bridge",
    description: "Bridge USDC from a supported source chain into Arc",
    parametersJsonSchema: {
      type: "object",
      properties: {
        asset: { type: "string", enum: ["USDC"] },
        amount: { type: "string", description: "The amount to bridge, as a decimal string" },
        sourceChain: { type: "string", description: "The source chain name" },
      },
      required: ["asset", "amount", "sourceChain"],
    },
  },
  {
    name: "predict",
    description:
      "Buy YES or NO shares in an open Arcana prediction market using Arc Testnet USDC. A numeric market ID, side, and exact amount are required.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        marketId: {
          type: "number",
          description: "The numeric Arcana market ID shown on the Predictions page",
        },
        side: { type: "string", enum: ["YES", "NO"] },
        amount: {
          type: "string",
          description: "The USDC amount to predict, as a decimal string",
        },
      },
      required: ["marketId", "side", "amount"],
    },
  },
  {
    name: "mintDomain",
    description:
      "Mint or register an available .arclend wallet domain for the connected wallet",
    parametersJsonSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description:
            "The exact .arclend domain or raw domain name to mint",
        },
      },
      required: ["domain"],
    },
  },
  {
    name: "burnDomain",
    description:
      "Burn an owned .arclend wallet domain NFT from the connected wallet",
    parametersJsonSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description:
            "The exact .arclend domain or raw domain name to burn",
        },
      },
      required: ["domain"],
    },
  },
  {
    name: "listDomain",
    description:
      "List an owned .arclend domain for sale on the ArcLend domain marketplace in USDC",
    parametersJsonSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description:
            "The exact .arclend domain or raw domain name to list",
        },
        price: {
          type: "string",
          description: "USDC sale price as a decimal string",
        },
      },
      required: ["domain", "price"],
    },
  },
  {
    name: "delistDomain",
    description:
      "Cancel an existing marketplace listing for an owned .arclend domain without burning or transferring the domain NFT",
    parametersJsonSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description:
            "The exact .arclend domain or raw domain name to delist",
        },
      },
      required: ["domain"],
    },
  },
  {
    name: "buyDomain",
    description:
      "Buy a listed .arclend domain from the ArcLend domain marketplace using USDC",
    parametersJsonSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description:
            "The exact .arclend domain or raw domain name to buy",
        },
        maxPrice: {
          type: "string",
          description:
            "Optional maximum acceptable USDC price as a decimal string",
        },
      },
      required: ["domain"],
    },
  },
  {
    name: "checkHealthFactor",
    description: "Read the current health factor from the supplied wallet context",
    parametersJsonSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "checkBalance",
    description: "Read a token balance from the supplied wallet context",
    parametersJsonSchema: {
      type: "object",
      properties: {
        asset: { type: "string", enum: ["USDC", "EURC", "USDT", "cirBTC"] },
      },
      required: ["asset"],
    },
  },
  {
    name: "getMarketRates",
    description: "Read current ArcLend market rates from the supplied context",
    parametersJsonSchema: {
      type: "object",
      properties: {
        asset: { type: "string", enum: ["USDC", "EURC"] },
      },
      required: ["asset"],
    },
  },
];

const tools = functionDeclarations.map((tool) => ({
  type: "function" as const,
  name: tool.name,
  description: tool.description,
  parameters: tool.parametersJsonSchema,
}));

function validContext(value: unknown): value is AgentContext {
  if (
    !value ||
    typeof value !== "object" ||
    !("positions" in value) ||
    !("balances" in value) ||
    !("reserves" in value)
  ) {
    return false;
  }
  const candidate = value as Partial<AgentContext>;
  if (
    candidate.walletAddress !== null &&
    (typeof candidate.walletAddress !== "string" ||
      !isAddress(candidate.walletAddress))
  ) {
    return false;
  }
  try {
    if (JSON.stringify(value).length > 20_000) return false;
  } catch {
    return false;
  }
  if (!("contacts" in value)) {
    return true;
  }
  const contacts = (value as { contacts?: unknown }).contacts;
  return (
    Array.isArray(contacts) &&
    contacts.length <= 100 &&
    contacts.every(
      (contact) =>
        contact &&
        typeof contact === "object" &&
        "name" in contact &&
        "address" in contact &&
        typeof contact.name === "string" &&
        contact.name.length <= 24 &&
        typeof contact.address === "string" &&
        isAddress(contact.address),
    )
  );
}

type AgentHistoryTurn = {
  role: "user" | "agent";
  content: string;
};

type DeterministicResult =
  | { type: "action"; action: AgentAction }
  | { type: "message"; text: string };

const SWAP_TOKEN_NAMES = {
  usdc: "USDC",
  eurc: "EURC",
  usdt: "USDT",
  cirbtc: "cirBTC",
} as const;

function normalizeDomainRecipient(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\.(?:arclend|arc)$/, "");
  if (!/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(normalized)) {
    return null;
  }

  return `${normalized}.arclend`;
}

function normalizeDomainForListing(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\.(?:arclend|arc)$/, "");
  if (!/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function parseDeterministicDomainMint(
  message: string,
): DeterministicResult | null {
  if (!/\b(?:mint|register|claim|reserve)\b/i.test(message)) {
    return null;
  }
  if (!/\b(?:domain|name)\b/i.test(message) && !/\.(?:arclend|arc)\b/i.test(message)) {
    return null;
  }

  const domainMatch =
    message.match(/\b([a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?\.(?:arclend|arc))\b/i) ??
    message.match(/\bdomain\s+([a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?)\b/i) ??
    message.match(/\b(?:mint|register|claim|reserve)\s+(?:the\s+)?(?:domain\s+|name\s+)?([a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?)\b/i);
  const domain = domainMatch ? normalizeDomainForListing(domainMatch[1]) : null;
  if (!domain) {
    return {
      type: "message",
      text: "Which .arclend domain do you want to mint?",
    };
  }

  const params = {
    domain,
    displayDomain: `${domain}.arclend`,
  };
  return {
    type: "action",
    action: {
      type: "action",
      tool: "mintDomain",
      params,
      explanation: summarizeAction("mintDomain", params),
    },
  };
}

function parseDeterministicDomainBurn(
  message: string,
): DeterministicResult | null {
  if (/\b(?:marketplace|listing|listed|sale|sell)\b/i.test(message)) {
    return null;
  }
  if (!/\b(?:burn|delete|destroy|remove|release)\b/i.test(message)) {
    return null;
  }
  if (!/\b(?:domain|name|nft)\b/i.test(message) && !/\.(?:arclend|arc)\b/i.test(message)) {
    return null;
  }

  const domainMatch =
    message.match(/\b([a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?\.(?:arclend|arc))\b/i) ??
    message.match(/\bdomain\s+([a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?)\b/i) ??
    message.match(/\b(?:burn|delete|destroy|remove|release)\s+(?:the\s+)?(?:domain\s+|name\s+|nft\s+)?([a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?)\b/i);
  const domain = domainMatch ? normalizeDomainForListing(domainMatch[1]) : null;
  if (!domain) {
    return {
      type: "message",
      text: "Which .arclend domain NFT do you want to burn?",
    };
  }

  const params = {
    domain,
    displayDomain: `${domain}.arclend`,
  };
  return {
    type: "action",
    action: {
      type: "action",
      tool: "burnDomain",
      params,
      explanation: summarizeAction("burnDomain", params),
    },
  };
}

function parseDeterministicDomainDelist(
  message: string,
): DeterministicResult | null {
  if (
    !/\b(?:delist|unlist|cancel|remove|take\s+down|take\s+off)\b/i.test(message)
  ) {
    return null;
  }
  if (!/\b(?:domain|name|marketplace|listing|listed|sale)\b/i.test(message) && !/\.(?:arclend|arc)\b/i.test(message)) {
    return null;
  }

  const domainMatch =
    message.match(/\b([a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?\.(?:arclend|arc))\b/i) ??
    message.match(/\bdomain\s+([a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?)\b/i) ??
    message.match(/\b(?:delist|unlist|cancel|remove|take\s+down|take\s+off)\s+(?:the\s+)?(?:domain\s+|listing\s+|sale\s+)?([a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?)\b/i);
  const domain = domainMatch ? normalizeDomainForListing(domainMatch[1]) : null;
  if (!domain) {
    return {
      type: "message",
      text: "Which .arclend domain do you want to remove from the marketplace?",
    };
  }

  const params = {
    domain,
    displayDomain: `${domain}.arclend`,
  };
  return {
    type: "action",
    action: {
      type: "action",
      tool: "delistDomain",
      params,
      explanation: summarizeAction("delistDomain", params),
    },
  };
}

function parseDeterministicDomainListing(
  message: string,
): DeterministicResult | null {
  if (!/\b(?:list|sell)\b/i.test(message) && !/\bput\b.+\bfor sale\b/i.test(message)) {
    return null;
  }

  const priceMatch =
    message.match(/\b(?:for|at)\s+(\d+(?:\.\d+)?)\s*(?:USDC|usd)\b/i) ??
    message.match(/\b(\d+(?:\.\d+)?)\s*USDC\b/i);
  if (!priceMatch) {
    return {
      type: "message",
      text: "What USDC price should I list the domain for?",
    };
  }

  const domainMatch =
    message.match(/\b([a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?\.(?:arclend|arc))\b/i) ??
    message.match(/\bdomain\s+([a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?)\b/i) ??
    message.match(/\b(?:list|sell)\s+([a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?)\b/i);
  const domain = domainMatch ? normalizeDomainForListing(domainMatch[1]) : null;
  if (!domain) {
    return {
      type: "message",
      text: "Which .arclend domain do you want to list?",
    };
  }

  const params = {
    domain,
    price: priceMatch[1],
    displayDomain: `${domain}.arclend`,
  };
  return {
    type: "action",
    action: {
      type: "action",
      tool: "listDomain",
      params,
      explanation: summarizeAction("listDomain", params),
    },
  };
}

function parseDeterministicDomainPurchase(
  message: string,
): DeterministicResult | null {
  if (!/\b(?:buy|purchase)\b/i.test(message)) {
    return null;
  }
  if (!/\b(?:domain|name|marketplace)\b/i.test(message) && !/\.(?:arclend|arc)\b/i.test(message)) {
    return null;
  }

  const domainMatch =
    message.match(/\b([a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?\.(?:arclend|arc))\b/i) ??
    message.match(/\bdomain\s+([a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?)\b/i) ??
    message.match(/\b(?:buy|purchase)\s+([a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?)\s+(?:domain|name)\b/i);
  const domain = domainMatch ? normalizeDomainForListing(domainMatch[1]) : null;
  if (!domain) {
    return {
      type: "message",
      text: "Which listed .arclend domain do you want to buy?",
    };
  }

  const maxPriceMatch =
    message.match(/\b(?:for|at|under|below|up to|max(?:imum)?)\s+(\d+(?:\.\d+)?)\s*(?:USDC|usd)\b/i) ??
    message.match(/\b(\d+(?:\.\d+)?)\s*USDC\b/i);
  const params = {
    domain,
    displayDomain: `${domain}.arclend`,
    ...(maxPriceMatch ? { maxPrice: maxPriceMatch[1] } : {}),
  };
  return {
    type: "action",
    action: {
      type: "action",
      tool: "buyDomain",
      params,
      explanation: summarizeAction("buyDomain", params),
    },
  };
}

function parseDeterministicSwap(message: string): DeterministicResult | null {
  if (!/\b(?:swap|exchange|convert|trade)\b/i.test(message)) {
    return null;
  }

  const tokenMatches = Array.from(
    message.matchAll(/\b(?:USDC|EURC|USDT|cirBTC)\b/gi),
    (match) =>
      SWAP_TOKEN_NAMES[
        match[0].toLowerCase() as keyof typeof SWAP_TOKEN_NAMES
      ],
  );
  const tokens = tokenMatches.filter(
    (token, index) => tokenMatches.indexOf(token) === index,
  );

  if (tokens.length < 2) {
    return {
      type: "message",
      text: "Which two tokens do you want to swap? Supported tokens are USDC, EURC, USDT, and cirBTC.",
    };
  }

  const [tokenIn, tokenOut] = tokens;
  const amountMatch = message.match(
    /\b(\d+(?:\.\d+)?)\s*(?:of\s+)?(?:USDC|EURC|USDT|cirBTC)\b/i,
  );
  if (!amountMatch) {
    return {
      type: "message",
      text: `How much ${tokenIn} do you want to swap to ${tokenOut}?`,
    };
  }

  const percentSlippage = message.match(
    /\b(\d+(?:\.\d+)?)\s*%\s*(?:slippage)?\b/i,
  );
  const bpsSlippage = message.match(
    /\bslippage\s*(?:of|at|:)?\s*(\d+(?:\.\d+)?)\s*(?:bps|basis points?)\b/i,
  );
  const slippageBps = percentSlippage
    ? Math.round(Number(percentSlippage[1]) * 100)
    : bpsSlippage
      ? Math.round(Number(bpsSlippage[1]))
      : 100;

  const params = {
    tokenIn,
    tokenOut,
    amountIn: amountMatch[1],
    slippageBps,
  };
  return {
    type: "action",
    action: {
      type: "action",
      tool: "swap",
      params,
      explanation: `${summarizeAction("swap", params)} Maximum slippage is ${slippageBps / 100}%.`,
    },
  };
}

function parseDeterministicSend(
  message: string,
  contacts: AgentContext["contacts"],
): DeterministicResult | null {
  if (!/\b(?:send|transfer|pay)\b/i.test(message)) {
    return null;
  }

  const amountTokenMatch = message.match(
    /\b(\d+(?:\.\d+)?)\s*(USDC|EURC|USDT|cirBTC)\b/i,
  );
  if (!amountTokenMatch) {
    return {
      type: "message",
      text: "How much do you want to send, and which token: USDC, EURC, USDT, or cirBTC?",
    };
  }

  const recipientText = message.match(/\bto\s+(.+?)\s*[.!?]*$/i)?.[1]?.trim();
  if (!recipientText) {
    return {
      type: "message",
      text: "Who should receive it? Enter a saved nickname or a 0x wallet address.",
    };
  }

  const directAddress = recipientText.match(/\b0x[a-fA-F0-9]{40}\b/)?.[0];
  const domainRecipient = directAddress
    ? null
    : normalizeDomainRecipient(recipientText);
  const contact = contacts.find(
    (entry) => entry.name.toLowerCase() === recipientText.toLowerCase(),
  );
  if (!directAddress && !domainRecipient && !contact) {
    return {
      type: "message",
      text: `I don't have a contact named "${recipientText}". Save the nickname, provide a registered .arclend domain, or provide the full 0x address.`,
    };
  }

  const recipient = directAddress
    ? getAddress(directAddress)
    : domainRecipient ?? getAddress(contact!.address);
  const asset =
    SWAP_TOKEN_NAMES[
      amountTokenMatch[2].toLowerCase() as keyof typeof SWAP_TOKEN_NAMES
    ];
  const params = {
    asset,
    amount: amountTokenMatch[1],
    recipient,
    ...(contact
      ? { recipientName: contact.name }
      : domainRecipient
        ? { recipientName: domainRecipient, recipientDomain: domainRecipient }
        : {}),
  };

  return {
    type: "action",
    action: {
      type: "action",
      tool: "sendToken",
      params,
      explanation: summarizeAction("sendToken", params),
    },
  };
}

function parseDeterministicPrediction(
  message: string,
): DeterministicResult | null {
  if (!/\b(?:predict|bet|wager)\b/i.test(message)) {
    return null;
  }
  const marketMatch = message.match(/\bmarket\s*#?\s*(\d+)\b/i);
  if (!marketMatch) {
    return {
      type: "message",
      text: "Which Arcana market ID do you want to predict on? You can find it on the Predictions page.",
    };
  }
  const sideMatch = message.match(/\b(YES|NO)\b/i);
  if (!sideMatch) {
    return {
      type: "message",
      text: "Should the prediction be YES or NO?",
    };
  }
  const amountMatch = message.match(
    /\b(\d+(?:\.\d+)?)\s*USDC\b/i,
  );
  if (!amountMatch) {
    return {
      type: "message",
      text: "How much USDC do you want to predict?",
    };
  }
  const params = {
    marketId: Number(marketMatch[1]),
    side: sideMatch[1].toUpperCase() as "YES" | "NO",
    amount: amountMatch[1],
  };
  return {
    type: "action",
    action: {
      type: "action",
      tool: "predict",
      params,
      explanation: summarizeAction("predict", params),
    },
  };
}

function parseDeterministicYieldClaim(
  message: string,
): DeterministicResult | null {
  if (!/\b(?:claim|withdraw|collect|harvest)\b/i.test(message)) {
    return null;
  }
  if (!/\b(?:pending\s+)?(?:supply\s+)?(?:interest|yield|rewards?|accrued)\b/i.test(message)) {
    return null;
  }

  const mentionsUsdc = /\bUSDC\b/i.test(message);
  const mentionsEurc = /\bEURC\b/i.test(message);
  const wantsAll =
    /\b(?:all|both|each|every)\b/i.test(message) ||
    (mentionsUsdc && mentionsEurc);
  const asset: "USDC" | "EURC" | "ALL" = wantsAll
    ? "ALL"
    : mentionsUsdc
      ? "USDC"
      : mentionsEurc
        ? "EURC"
        : "ALL";
  const params = { asset };

  return {
    type: "action",
    action: {
      type: "action",
      tool: "claimYield",
      params,
      explanation: summarizeAction("claimYield", params),
    },
  };
}

function validHistory(value: unknown): value is AgentHistoryTurn[] {
  return (
    Array.isArray(value) &&
    value.length <= 10 &&
    value.every(
      (turn) =>
        turn &&
        typeof turn === "object" &&
        ((turn as AgentHistoryTurn).role === "user" ||
          (turn as AgentHistoryTurn).role === "agent") &&
        typeof (turn as AgentHistoryTurn).content === "string" &&
        (turn as AgentHistoryTurn).content.length <= 2_000,
    )
  );
}

function isAgentTool(value: string): value is AgentTool {
  return (
    value === "supply" ||
    value === "withdraw" ||
    value === "claimYield" ||
    value === "borrow" ||
    value === "repay" ||
    value === "swap" ||
    value === "sendToken" ||
    value === "bridge" ||
    value === "predict" ||
    value === "mintDomain" ||
    value === "burnDomain" ||
    value === "listDomain" ||
    value === "delistDomain" ||
    value === "buyDomain" ||
    value === "checkHealthFactor" ||
    value === "checkBalance" ||
    value === "getMarketRates"
  );
}

function toParams(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return value as Record<string, unknown>;
}

function summarizeAction(tool: AgentTool, params: Record<string, unknown>): string {
  switch (tool) {
    case "supply":
      return `I'll supply ${String(params.amount ?? "the requested amount")} ${String(params.asset ?? "asset")} to the lending pool and you'll receive an on-chain Position NFT as proof.`;
    case "withdraw":
      return `I'll prepare a withdrawal for ${String(params.amount ?? "the requested amount")} ${String(params.asset ?? "asset")}.`;
    case "claimYield":
      return `I'll prepare a pending yield claim for ${String(params.asset ?? "all supported pools")}.`;
    case "borrow":
      return `I'll borrow ${String(params.amount ?? "the requested amount")} ${String(params.asset ?? "asset")} and you'll receive an on-chain Position NFT as proof.`;
    case "repay":
      return `I'll prepare a repayment for ${String(params.amount ?? "the requested amount")} ${String(params.asset ?? "asset")}.`;
    case "swap":
      return `I'll prepare a swap from ${String(params.tokenIn ?? "the input token")} to ${String(params.tokenOut ?? "the output token")} for ${String(params.amountIn ?? "the requested amount")}.`;
    case "sendToken":
      return `I'll prepare a transfer of ${String(params.amount ?? "the requested amount")} ${String(params.asset ?? "token")} to ${String(params.recipientName ?? params.recipient ?? "the recipient")}.`;
    case "bridge":
      return `I'll prepare a USDC bridge from ${String(params.sourceChain ?? "the source chain")} for ${String(params.amount ?? "the requested amount")}.`;
    case "predict":
      return `I'll prepare a ${String(params.amount ?? "requested")} USDC ${String(params.side ?? "YES/NO")} prediction on Arcana market #${String(params.marketId ?? "unknown")}.`;
    case "mintDomain":
      return `I'll prepare a domain mint for ${String(params.displayDomain ?? params.domain ?? "the domain")}.`;
    case "burnDomain":
      return `I'll prepare a permanent burn for ${String(params.displayDomain ?? params.domain ?? "the domain")} after wallet confirmation.`;
    case "listDomain":
      return `I'll prepare a marketplace listing for ${String(params.displayDomain ?? params.domain ?? "the domain")} at ${String(params.price ?? "the requested price")} USDC.`;
    case "delistDomain":
      return `I'll prepare a marketplace delisting for ${String(params.displayDomain ?? params.domain ?? "the domain")}.`;
    case "buyDomain":
      return `I'll prepare a marketplace purchase for ${String(params.displayDomain ?? params.domain ?? "the domain")}${params.maxPrice ? ` with a max price of ${String(params.maxPrice)} USDC` : ""}.`;
    case "checkHealthFactor":
      return "I'll check your current health factor.";
    case "checkBalance":
      return `I'll check your ${String(params.asset ?? "token")} balance.`;
    case "getMarketRates":
      return `I'll fetch the current ${String(params.asset ?? "asset")} market rates.`;
  }
}

type OpenAIInputMessage = {
  role: "user" | "assistant";
  content: string;
};

type OpenAIResponseOutputItem = {
  type?: string;
  name?: string;
  arguments?: string;
  content?: Array<{ type?: string; text?: string }>;
};

type OpenAIResponse = {
  output?: OpenAIResponseOutputItem[];
  output_text?: string;
};

function getFunctionCallPart(response: OpenAIResponse) {
  return response.output?.find(
    (part) => part.type === "function_call" && typeof part.name === "string",
  );
}

function getResponseText(response: OpenAIResponse) {
  if (typeof response.output_text === "string" && response.output_text.trim().length > 0) {
    return response.output_text.trim();
  }

  return (
    response.output
      ?.flatMap((part) => part.content ?? [])
      .map((content) => content.text?.trim() ?? "")
      .find((text) => text.length > 0) ?? null
  );
}

function providerStatus(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const candidate = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
  };
  if (typeof candidate.status === "number") return candidate.status;
  if (typeof candidate.code === "number") return candidate.code;
  if (typeof candidate.message === "string") {
    const match = candidate.message.match(
      /"(?:code|statusCode|status)"\s*:\s*(\d{3})/,
    );
    if (match) return Number(match[1]);
  }
  return null;
}

function retryableProviderError(error: unknown) {
  const status = providerStatus(error);
  return status === 429 || (status !== null && status >= 500);
}

async function generateAgentResponse(
  apiKey: string,
  input: OpenAIInputMessage[],
  instructions: string,
) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          instructions,
          input,
          tools,
          tool_choice: "auto",
        }),
      });

      if (!response.ok) {
        const message = await response.text();
        const error = new Error(
          `OpenAI ${OPENAI_MODEL} failed with status ${response.status}: ${message.slice(0, 500)}`,
        ) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }

      return (await response.json()) as OpenAIResponse;
    } catch (error) {
      lastError = error;
      const status = providerStatus(error);
      console.warn(
        `[ArcLend agent] OpenAI ${OPENAI_MODEL} failed${
          status ? ` with status ${status}` : ""
        }${attempt === 0 && retryableProviderError(error) ? "; retrying." : "."}`,
      );
      if (!retryableProviderError(error)) {
        break;
      }
    }
  }

  throw lastError ?? new Error("OpenAI request failed");
}

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, {
    scope: "agent",
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) return limited;

  try {
    const body = (await request.json()) as {
      message?: unknown;
      history?: unknown;
      context?: unknown;
    };
    if (
      typeof body.message !== "string" ||
      body.message.trim().length === 0 ||
      body.message.length > 2_000 ||
      !validHistory(body.history ?? []) ||
      !validContext(body.context)
    ) {
      return NextResponse.json(
        { type: "message", text: "Invalid agent request." },
        { status: 400 },
      );
    }

    const deterministicMint = parseDeterministicDomainMint(
      body.message.trim(),
    );
    if (deterministicMint?.type === "message") {
      return NextResponse.json(
        deterministicMint satisfies AgentResponse,
      );
    }
    if (deterministicMint?.type === "action") {
      const validation = await validateAgentAction(
        deterministicMint.action,
        { walletAddress: body.context.walletAddress },
      );
      if (!validation.valid) {
        return NextResponse.json({
          type: "message",
          text: validation.reason,
        } satisfies AgentResponse);
      }
      return NextResponse.json({
        type: "action",
        validated: validation,
      } satisfies AgentResponse);
    }

    const deterministicDelist = parseDeterministicDomainDelist(
      body.message.trim(),
    );
    if (deterministicDelist?.type === "message") {
      return NextResponse.json(
        deterministicDelist satisfies AgentResponse,
      );
    }
    if (deterministicDelist?.type === "action") {
      const validation = await validateAgentAction(
        deterministicDelist.action,
        { walletAddress: body.context.walletAddress },
      );
      if (!validation.valid) {
        return NextResponse.json({
          type: "message",
          text: validation.reason,
        } satisfies AgentResponse);
      }
      return NextResponse.json({
        type: "action",
        validated: validation,
      } satisfies AgentResponse);
    }

    const deterministicBurn = parseDeterministicDomainBurn(
      body.message.trim(),
    );
    if (deterministicBurn?.type === "message") {
      return NextResponse.json(
        deterministicBurn satisfies AgentResponse,
      );
    }
    if (deterministicBurn?.type === "action") {
      const validation = await validateAgentAction(
        deterministicBurn.action,
        { walletAddress: body.context.walletAddress },
      );
      if (!validation.valid) {
        return NextResponse.json({
          type: "message",
          text: validation.reason,
        } satisfies AgentResponse);
      }
      return NextResponse.json({
        type: "action",
        validated: validation,
      } satisfies AgentResponse);
    }

    const deterministicPurchase = parseDeterministicDomainPurchase(
      body.message.trim(),
    );
    if (deterministicPurchase?.type === "message") {
      return NextResponse.json(
        deterministicPurchase satisfies AgentResponse,
      );
    }
    if (deterministicPurchase?.type === "action") {
      const validation = await validateAgentAction(
        deterministicPurchase.action,
        { walletAddress: body.context.walletAddress },
      );
      if (!validation.valid) {
        return NextResponse.json({
          type: "message",
          text: validation.reason,
        } satisfies AgentResponse);
      }
      return NextResponse.json({
        type: "action",
        validated: validation,
      } satisfies AgentResponse);
    }

    const deterministicListing = parseDeterministicDomainListing(
      body.message.trim(),
    );
    if (deterministicListing?.type === "message") {
      return NextResponse.json(
        deterministicListing satisfies AgentResponse,
      );
    }
    if (deterministicListing?.type === "action") {
      const validation = await validateAgentAction(
        deterministicListing.action,
        { walletAddress: body.context.walletAddress },
      );
      if (!validation.valid) {
        return NextResponse.json({
          type: "message",
          text: validation.reason,
        } satisfies AgentResponse);
      }
      return NextResponse.json({
        type: "action",
        validated: validation,
      } satisfies AgentResponse);
    }

    const deterministicPrediction = parseDeterministicPrediction(
      body.message.trim(),
    );
    if (deterministicPrediction?.type === "message") {
      return NextResponse.json(
        deterministicPrediction satisfies AgentResponse,
      );
    }
    if (deterministicPrediction?.type === "action") {
      const validation = await validateAgentAction(
        deterministicPrediction.action,
        { walletAddress: body.context.walletAddress },
      );
      if (!validation.valid) {
        return NextResponse.json({
          type: "message",
          text: validation.reason,
        } satisfies AgentResponse);
      }
      return NextResponse.json({
        type: "action",
        validated: validation,
      } satisfies AgentResponse);
    }

    const deterministicYieldClaim = parseDeterministicYieldClaim(
      body.message.trim(),
    );
    if (deterministicYieldClaim?.type === "message") {
      return NextResponse.json(
        deterministicYieldClaim satisfies AgentResponse,
      );
    }
    if (deterministicYieldClaim?.type === "action") {
      const validation = await validateAgentAction(
        deterministicYieldClaim.action,
        { walletAddress: body.context.walletAddress },
      );
      if (!validation.valid) {
        return NextResponse.json({
          type: "message",
          text: validation.reason,
        } satisfies AgentResponse);
      }
      return NextResponse.json({
        type: "action",
        validated: validation,
      } satisfies AgentResponse);
    }

    const deterministic = parseDeterministicSwap(body.message.trim());
    if (deterministic?.type === "message") {
      return NextResponse.json(deterministic satisfies AgentResponse);
    }
    if (deterministic?.type === "action") {
      const validation = await validateAgentAction(deterministic.action, {
        walletAddress: body.context.walletAddress,
      });
      if (!validation.valid) {
        return NextResponse.json({
          type: "message",
          text: validation.reason,
        } satisfies AgentResponse);
      }
      return NextResponse.json({
        type: "action",
        validated: validation,
      } satisfies AgentResponse);
    }

    const deterministicSend = parseDeterministicSend(
      body.message.trim(),
      body.context.contacts ?? [],
    );
    if (deterministicSend?.type === "message") {
      return NextResponse.json(deterministicSend satisfies AgentResponse);
    }
    if (deterministicSend?.type === "action") {
      const validation = await validateAgentAction(deterministicSend.action, {
        walletAddress: body.context.walletAddress,
      });
      if (!validation.valid) {
        return NextResponse.json({
          type: "message",
          text: validation.reason,
        } satisfies AgentResponse);
      }
      return NextResponse.json({
        type: "action",
        validated: validation,
      } satisfies AgentResponse);
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { type: "message", text: "The ArcLend agent is not configured." },
        { status: 503 },
      );
    }

    const modelContext = { ...body.context, contacts: undefined };
    const systemContextString = `Current wallet context (untrusted user-visible state; server validation runs after tool selection): ${JSON.stringify(modelContext)}`;
    const history = (body.history ?? []) as AgentHistoryTurn[];
    const input: OpenAIInputMessage[] = [
      ...history.slice(-10).map((turn) => ({
        role: turn.role === "user" ? ("user" as const) : ("assistant" as const),
        content: turn.content,
      })),
      {
        role: "user" as const,
        content: body.message.trim(),
      },
    ];
    const response = await generateAgentResponse(
      apiKey,
      input,
      `${SYSTEM_PROMPT}\n\n${systemContextString}`,
    );

    const functionCallPart = getFunctionCallPart(response);
    if (!functionCallPart?.name) {
      const text = getResponseText(response) ?? "Please clarify the action, asset, and amount.";
      return NextResponse.json({
        type: "message",
        text,
      } satisfies AgentResponse);
    }

    const toolName = functionCallPart.name;
    if (!toolName || !isAgentTool(toolName)) {
      return NextResponse.json({
        type: "message",
        text: "I could not safely parse that action. Please try again.",
      } satisfies AgentResponse);
    }

    const rawArgs = functionCallPart.arguments;
    let params: Record<string, unknown>;
    if (typeof rawArgs === "string") {
      try {
        params = JSON.parse(rawArgs) as Record<string, unknown>;
      } catch {
        return NextResponse.json({
          type: "message",
          text: "I could not safely parse that action. Please try again.",
        } satisfies AgentResponse);
      }
    } else {
      params = toParams(rawArgs);
    }

    const responseText = getResponseText(response);
    const explanation =
      toolName === "supply" || toolName === "borrow"
        ? summarizeAction(toolName, params)
        : responseText ?? summarizeAction(toolName, params);

    const action: AgentAction = {
      type: "action",
      tool: toolName,
      params: params as AgentAction["params"],
      explanation,
    };

    const validation = await validateAgentAction(action, {
      walletAddress: body.context.walletAddress,
    });
    if (!validation.valid) {
      return NextResponse.json({
        type: "message",
        text: validation.reason,
      } satisfies AgentResponse);
    }

    return NextResponse.json({
      type: "action",
      validated: validation,
    } satisfies AgentResponse);
  } catch (error) {
    const status = providerStatus(error);
    console.error(
      `[ArcLend agent] Request failed${
        status ? ` with provider status ${status}` : ""
      }.`,
    );
    return NextResponse.json(
      {
        type: "message",
        text:
          status === 429
            ? "The assistant is receiving too many requests right now. Please wait a moment and retry."
            : "The ArcLend agent is temporarily unavailable. Please retry.",
      } satisfies AgentResponse,
      { status: status === 429 ? 429 : 502 },
    );
  }
}
