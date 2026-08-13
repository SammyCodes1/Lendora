export const SOCIAL_OAUTH_STORAGE_KEY = "arclend:social-oauth";
export const CIRCLE_SESSION_STORAGE_KEY = "arclend:circle-wallet-session";
export const CIRCLE_PENDING_AUTH_STORAGE_KEY = "arclend:circle-pending-auth";
export const OAUTH_HASH_STORAGE_KEY = "arclend:oauth-hash";

export type SocialOAuthState = {
  deviceToken: string;
  deviceEncryptionKey: string;
};

export function isCircleOAuthHash(hash: string) {
  return /(?:^|#|&)(?:id_token|access_token)=/.test(hash);
}

export function restoreOAuthHash() {
  if (typeof window === "undefined") return false;
  const current = window.location.hash;
  if (isCircleOAuthHash(current)) {
    try {
      window.sessionStorage.setItem(OAUTH_HASH_STORAGE_KEY, current);
    } catch {
      /* ignore quota / private mode */
    }
    return true;
  }
  try {
    const stored = window.sessionStorage.getItem(OAUTH_HASH_STORAGE_KEY);
    if (!stored || !isCircleOAuthHash(stored)) return false;
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${stored}`,
    );
    return true;
  } catch {
    return false;
  }
}

export function clearOAuthHash() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(OAUTH_HASH_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  if (isCircleOAuthHash(window.location.hash)) {
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
  }
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

/** Circle sends this exact value to Google as redirect_uri. No trailing slash. */
export function googleRedirectUri() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
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
