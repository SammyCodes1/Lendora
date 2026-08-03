import { NextResponse } from "next/server";
import { validateAgentAction } from "@/lib/agentValidation";
import type { AgentAction } from "@/lib/agentTypes";
import { enforceRateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

function isAgentAction(value: unknown): value is AgentAction {
  if (!value || typeof value !== "object") {
    return false;
  }
  const action = value as Partial<AgentAction>;
  return (
    action.type === "action" &&
    typeof action.tool === "string" &&
    Boolean(action.params && typeof action.params === "object") &&
    typeof action.explanation === "string"
  );
}

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, {
    scope: "agent-validation",
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  try {
    const body = (await request.json()) as {
      action?: unknown;
      walletAddress?: unknown;
    };
    if (
      !isAgentAction(body.action) ||
      typeof body.walletAddress !== "string"
    ) {
      return NextResponse.json(
        {
          valid: false,
          reason:
            "I can't verify your position right now. Please reconnect your wallet and try again.",
        },
        { status: 400 },
      );
    }

    const validation = await validateAgentAction(body.action, {
      walletAddress: body.walletAddress,
    });
    return NextResponse.json(validation);
  } catch {
    return NextResponse.json(
      {
        valid: false,
        reason:
          "I can't verify your position right now. Please reconnect your wallet and try again.",
      },
      { status: 502 },
    );
  }
}
