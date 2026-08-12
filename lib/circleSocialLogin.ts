export const SOCIAL_OAUTH_STORAGE_KEY = "arclend:social-oauth";
export const CIRCLE_SESSION_STORAGE_KEY = "arclend:circle-wallet-session";
export const CIRCLE_PENDING_AUTH_STORAGE_KEY = "arclend:circle-pending-auth";

export type SocialOAuthState = {
  deviceToken: string;
  deviceEncryptionKey: string;
};

const oauthHashPattern =
  /^#(?:[a-zA-Z0-9-_.%]+=[^&]*&)*[a-zA-Z0-9-_.%]+=[^&]*$/;

export function isCircleOAuthHash(hash: string) {
  return oauthHashPattern.test(hash);
}

export function readSocialOAuthState(): SocialOAuthState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SOCIAL_OAUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SocialOAuthState;
    if (!parsed.deviceToken || !parsed.deviceEncryptionKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSocialOAuthState(state: SocialOAuthState) {
  window.localStorage.setItem(SOCIAL_OAUTH_STORAGE_KEY, JSON.stringify(state));
}

export function clearSocialOAuthState() {
  window.localStorage.removeItem(SOCIAL_OAUTH_STORAGE_KEY);
  // Circle's Web SDK also stores these while the Google redirect is in flight.
  window.localStorage.removeItem("socialLoginProvider");
  window.localStorage.removeItem("state");
  window.localStorage.removeItem("nonce");
}

export function circleLoginErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}
