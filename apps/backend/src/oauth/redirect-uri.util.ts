/**
 * The redirect URIs CE accepts for a public client, whether registered (RFC 7591)
 * or declared in a Client ID Metadata Document: https anywhere, or plain http on a
 * loopback host (a local MCP client, OAuth 2.1 §8.4.2).
 */
export function isAcceptableRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === 'https:') return true;
    return (
      u.protocol === 'http:' &&
      (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]')
    );
  } catch {
    return false;
  }
}
