import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

const WEB_APP_DATA = "WebAppData";

export type TelegramUser = {
  id: number;
  username?: string;
  first_name?: string;
};

export type InitDataVerification =
  | { valid: true; user: TelegramUser }
  | { valid: false; reason: string };

/**
 * Validates Telegram WebApp initData per
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app.
 *
 * The data-check-string is built from all query pairs (excluding `hash`)
 * sorted by key and joined with \n; it is then HMAC-SHA256'd with a secret
 * key derived from the bot token and the literal string "WebAppData".
 * A mismatch proves the initData was forged or re-signed with a different
 * token — this is what stops an attacker from spoofing a Telegram identity.
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeMs = 24 * 60 * 60 * 1_000,
): InitDataVerification {
  if (!initData || !botToken) {
    return { valid: false, reason: "Missing initData or bot token" };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    return { valid: false, reason: "initData missing hash" };
  }
  params.delete("hash");

  const checkString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");

  const secretKey = createHmac("sha256", WEB_APP_DATA)
    .update(botToken)
    .digest();
  const expected = createHmac("sha256", secretKey)
    .update(checkString)
    .digest();

  const received = Buffer.from(hash, "hex");
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    return { valid: false, reason: "initData hash mismatch" };
  }

  const authDate = Number(params.get("auth_date") ?? 0);
  if (Number.isFinite(authDate) && authDate > 0) {
    const ageMs = Date.now() - authDate * 1_000;
    if (ageMs > maxAgeMs || ageMs < -60_000) {
      return { valid: false, reason: "initData too old" };
    }
  }

  const rawUser = params.get("user");
  let user: TelegramUser;
  try {
    user = rawUser ? JSON.parse(rawUser) : { id: 0 };
  } catch {
    return { valid: false, reason: "initData user is not valid JSON" };
  }
  if (!user || typeof user.id !== "number") {
    return { valid: false, reason: "initData missing user id" };
  }

  return { valid: true, user };
}
