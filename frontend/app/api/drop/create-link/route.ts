import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { storeDropSlug } from "@/lib/server/arcDrop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function siteOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "https://www.arclend.cv")
  );
}

/**
 * POST /api/drop/create-link
 *
 * Body: { dropId: number, creatorWallet: string }
 *
 * Generates a short URL-safe base-62 slug, stores it in Redis pointing at the
 * on-chain dropId, and returns the shareable link. The link is valid for 90 days
 * (same window as the maximum drop expiry the frontend allows to be created).
 *
 * The actual state of the drop (remaining balance, active flag, etc.) always
 * lives on-chain — Redis is purely a slug → dropId lookup.
 */
export async function POST(request: Request) {
  const limited = enforceRateLimit(request, {
    scope: "arcdrop-create-link",
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) return limited;

  try {
    const body = (await request.json()) as {
      dropId?: unknown;
      creatorWallet?: unknown;
    };

    const dropId =
      typeof body.dropId === "number"
        ? body.dropId
        : typeof body.dropId === "string"
          ? parseInt(body.dropId, 10)
          : NaN;

    if (!Number.isInteger(dropId) || dropId < 1) {
      return NextResponse.json(
        { error: "A valid drop ID is required." },
        { status: 400 },
      );
    }

    if (
      typeof body.creatorWallet !== "string" ||
      !isAddress(body.creatorWallet)
    ) {
      return NextResponse.json(
        { error: "A valid creator wallet address is required." },
        { status: 400 },
      );
    }

    const result = await storeDropSlug({
      dropId,
      creatorWallet: body.creatorWallet,
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    const { slug } = result;
    const url = `${siteOrigin()}/drop/${slug}`;
    return NextResponse.json({ slug, url });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not create drop link.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
