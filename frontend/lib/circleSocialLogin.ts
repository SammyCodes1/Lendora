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

/** True while Google is sending the user back with an OAuth hash. */
export function isCircleOAuthReturn() {
  if (typeof window === "undefined") return false;
  if (isCircleOAuthHash(window.location.hash)) return true;
  try {
    const stored = window.sessionStorage.getItem(OAUTH_HASH_STORAGE_KEY);
    return Boolean(stored && isCircleOAuthHash(stored));
  } catch {
    return false;
  }
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
    const raw =
      window.localStorage.getItem(SOCIAL_OAUTH_STORAGE_KEY) ??
      window.sessionStorage.getItem(SOCIAL_OAUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SocialOAuthState;
    if (!parsed.deviceToken || !parsed.deviceEncryptionKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSocialOAuthState(state: SocialOAuthState) {
  const raw = JSON.stringify(state);
  window.localStorage.setItem(SOCIAL_OAUTH_STORAGE_KEY, raw);
  try {
    window.sessionStorage.setItem(SOCIAL_OAUTH_STORAGE_KEY, raw);
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearSocialOAuthState() {
  window.localStorage.removeItem(SOCIAL_OAUTH_STORAGE_KEY);
  try {
    window.sessionStorage.removeItem(SOCIAL_OAUTH_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  clearCircleSdkOAuthKeys();
}

export function clearCircleSdkOAuthKeys() {
  window.localStorage.removeItem("socialLoginProvider");
  window.localStorage.removeItem("state");
  window.localStorage.removeItem("nonce");
}

/** Circle sends this exact value to Google as redirect_uri. No trailing slash. */
export function googleRedirectUri() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

let deviceIdQuery: Promise<string> | null = null;

export function requestCircleDeviceId(sdk: {
  getDeviceId: () => Promise<string>;
}) {
  deviceIdQuery ??= sdk.getDeviceId().finally(() => {
    deviceIdQuery = null;
  });
  return deviceIdQuery;
}

export function circleLoginErrorMessage(error: unknown, fallback: string) {
  let message = fallback;
  if (error instanceof Error && error.message) message = error.message;
  else if (typeof error === "object" && error && "message" in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === "string" && value.trim()) message = value;
  } else if (typeof error === "string" && error.trim()) {
    message = error;
  }

  if (/deviceid/i.test(message)) {
    return "Couldn't reach Circle's wallet service. Allow pw-auth.circle.com if a blocker is on, then try Google sign-in again.";
  }
  return message;
}
