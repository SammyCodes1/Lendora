// Shared by the client (Mini App signing) and the server (link verification)
// so both sides construct the exact same signed message string.
export function linkMessage(userId: number, nonce: string) {
  return `Link Telegram account ${userId} to ArcLend wallet\n\nNonce: ${nonce}`;
}
