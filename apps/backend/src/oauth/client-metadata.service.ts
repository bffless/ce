import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { v5 as uuidv5 } from 'uuid';
import { OAuthError } from './oauth.errors';
import { isAcceptableRedirect } from './redirect-uri.util';

/**
 * OAuth Client ID Metadata Documents (draft-ietf-oauth-client-id-metadata-document):
 * a client identifies itself by an `https://` URL it controls, and the
 * authorization server reads its metadata (RFC 7591 fields) from that URL
 * instead of a registration. claude.ai's "Recommended" connector mode.
 *
 * The URL is caller-supplied and the server fetches it, so this is an SSRF
 * surface by construction. The guard, in order: the URL's own shape (https,
 * a domain name — never an IP literal — no credentials, fragment or dot
 * segments, not a local/internal suffix); every address the name resolves
 * to must be public; the connection is then pinned to exactly those
 * addresses (no re-resolution between the check and the connect); redirects
 * are not followed; the read is bounded by a timeout and a byte cap.
 */

export const CIMD_FETCH_TIMEOUT_MS = 5_000;
export const CIMD_MAX_BYTES = 64 * 1024;
/** Cache lifetime when the document carries no `Cache-Control: max-age`. */
export const CIMD_DEFAULT_TTL_MS = 5 * 60_000;
/** The longest a `max-age` may hold a document — a rotated redirect_uri must land within a day. */
export const CIMD_MAX_TTL_MS = 24 * 3600_000;
export const CIMD_CACHE_MAX_ENTRIES = 500;
/**
 * The uuid v5 namespace an `oauth_clients` row keyed by its metadata URL gets.
 * `oauth_clients.client_id` (and the codes / refresh tokens that reference it)
 * is a uuid, so the URL is mapped to one deterministically. NEVER change this:
 * every issued code and refresh token is bound to the uuid it produced.
 */
export const CIMD_CLIENT_NAMESPACE = '5b7d4a3e-9c21-4f6e-8d0a-1e2f3c4b5a69';
export const CLIENT_METADATA_TRANSPORT = 'CLIENT_METADATA_TRANSPORT';

const SUPPORTED_GRANT_TYPES = ['authorization_code', 'refresh_token'];
const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal', 'metadata']);
const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.svc',
  '.cluster.local',
  '.home.arpa',
  '.in-addr.arpa',
  '.ip6.arpa',
];

export interface ClientMetadataDocument {
  /** The URL — the draft requires the document's own `client_id` to equal it. */
  clientId: string;
  clientName: string;
  redirectUris: string[];
  clientUri?: string;
  /** The supported subset of what the document declares; both when it declares none. */
  grantTypes: string[];
  /** What the document declares; CE treats every CIMD client as public regardless. */
  tokenEndpointAuthMethod: string;
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface ClientMetadataResponse {
  status: number;
  headers: { get(name: string): string | null };
  /** The body, already read under {@link CIMD_MAX_BYTES}. */
  text: string;
}

/** The network, injected so the guard and the document handling are testable without it. */
export interface ClientMetadataTransport {
  /** Every address the name resolves to (`dns.lookup` with `all: true`). */
  lookup(hostname: string): Promise<ResolvedAddress[]>;
  /** GET the document, connecting only to `addresses` — the ones just vetted. */
  fetch(
    url: string,
    opts: { addresses: ResolvedAddress[]; signal: AbortSignal },
  ): Promise<ClientMetadataResponse>;
}

@Injectable()
export class ClientMetadataService {
  private readonly logger = new Logger(ClientMetadataService.name);
  private readonly cache = new Map<string, { doc: ClientMetadataDocument; expiresAt: number }>();
  private readonly transport: ClientMetadataTransport;

  constructor(@Optional() @Inject(CLIENT_METADATA_TRANSPORT) transport?: ClientMetadataTransport) {
    this.transport = transport ?? defaultTransport;
  }

  /**
   * A `client_id` that is a URL names a metadata document; anything else is a
   * registered client's uuid. `http://` counts as URL-shaped so that it is
   * refused as a metadata URL (https required) rather than looked up as a uuid.
   */
  isClientIdUrl(clientId: string): boolean {
    return /^https?:\/\//i.test(clientId);
  }

  /** The `oauth_clients.client_id` a metadata URL maps to — the same uuid every time. */
  clientIdFor(url: string): string {
    return uuidv5(url, CIMD_CLIENT_NAMESPACE);
  }

  /** What to compare a presented `client_id` against a stored row with: URLs become their uuid. */
  normalizeClientId(clientId: string): string {
    return this.isClientIdUrl(clientId) ? this.clientIdFor(clientId) : clientId;
  }

  /**
   * The document behind `clientId`, from the cache or fetched through the guard.
   * Every failure is `invalid_client` (401): the client_id names no usable client.
   */
  async resolve(clientId: string): Promise<ClientMetadataDocument> {
    const url = assertClientIdUrl(clientId);
    const cached = this.cache.get(clientId);
    if (cached && cached.expiresAt > Date.now()) return cached.doc;
    this.cache.delete(clientId);

    const addresses = await this.vettedAddresses(url.hostname);
    let res: ClientMetadataResponse;
    try {
      res = await this.transport.fetch(clientId, {
        addresses,
        signal: AbortSignal.timeout(CIMD_FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.debug(`client metadata document ${clientId}: ${String(error)}`);
      throw invalidClient('the client metadata document could not be fetched');
    }
    if (res.status !== 200) {
      throw invalidClient(`the client metadata document answered ${res.status}`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(res.text);
    } catch {
      throw invalidClient('the client metadata document is not JSON');
    }
    const doc = parseClientMetadataDocument(raw, clientId);
    if (doc.tokenEndpointAuthMethod !== 'none') {
      this.logger.log(
        `OAuth client ${clientId} declares ${doc.tokenEndpointAuthMethod}; treated as a public client (none)`,
      );
    }
    this.remember(clientId, doc, ttlFrom(res.headers.get('cache-control')));
    return doc;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private async vettedAddresses(hostname: string): Promise<ResolvedAddress[]> {
    let addresses: ResolvedAddress[];
    try {
      addresses = await this.transport.lookup(hostname);
    } catch (error) {
      this.logger.debug(`client metadata host ${hostname}: ${String(error)}`);
      throw invalidClient('the client_id host does not resolve');
    }
    if (addresses.length === 0) throw invalidClient('the client_id host does not resolve');
    if (!addresses.every((a) => isPublicAddress(a.address))) {
      this.logger.warn(`OAuth client_id ${hostname} resolves to a non-public address; refused`);
      throw invalidClient('the client_id host is not publicly routable');
    }
    return addresses;
  }

  private remember(clientId: string, doc: ClientMetadataDocument, ttlMs: number): void {
    if (ttlMs <= 0) return;
    if (this.cache.size >= CIMD_CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(clientId, { doc, expiresAt: Date.now() + ttlMs });
  }
}

function invalidClient(description: string): OAuthError {
  return new OAuthError('invalid_client', description, 401);
}

/**
 * The URL constraints of the draft (§3) plus CE's own: https, a domain name with
 * at least two labels (never an IP literal or a bare host), no userinfo, no
 * fragment, no `.`/`..` segments, and no local / cluster-internal suffix.
 */
export function assertClientIdUrl(clientId: string): URL {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    throw invalidClient('client_id is not a valid URL');
  }
  if (url.protocol !== 'https:') throw invalidClient('client_id must be an https URL');
  if (url.username || url.password) throw invalidClient('client_id must not carry credentials');
  if (url.hash || clientId.includes('#'))
    throw invalidClient('client_id must not carry a fragment');
  if (/\/\.\.?(?=[/?#]|$)/.test(clientId)) {
    throw invalidClient('client_id must not contain dot path segments');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) throw invalidClient('client_id must name a host');
  if (isIP(host.replace(/^\[|\]$/g, '')) !== 0) {
    throw invalidClient('client_id must name a domain, not an IP address');
  }
  if (
    !host.includes('.') ||
    BLOCKED_HOSTNAMES.has(host) ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    throw invalidClient('client_id must name a public domain');
  }
  return url;
}

/** The RFC 7591 fields CE reads from a document, validated the way `POST /api/oauth/register` validates them. */
export function parseClientMetadataDocument(raw: unknown, url: string): ClientMetadataDocument {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalidClient('the client metadata document must be a JSON object');
  }
  const doc = raw as Record<string, unknown>;
  if (doc.client_id !== url) {
    throw invalidClient('the client metadata document does not name its own URL as client_id');
  }
  const uris = doc.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || !uris.every((u) => typeof u === 'string')) {
    throw invalidClient('the client metadata document must list redirect_uris');
  }
  for (const uri of uris as string[]) {
    if (!isAcceptableRedirect(uri)) {
      throw invalidClient(`redirect_uri must be https, or http on localhost: ${uri}`);
    }
  }
  const name = typeof doc.client_name === 'string' ? doc.client_name.trim().slice(0, 255) : '';
  const grants = Array.isArray(doc.grant_types)
    ? doc.grant_types.filter(
        (g): g is string => typeof g === 'string' && SUPPORTED_GRANT_TYPES.includes(g),
      )
    : [];
  return {
    clientId: url,
    clientName: name || new URL(url).hostname,
    redirectUris: [...(uris as string[])],
    ...(typeof doc.client_uri === 'string' ? { clientUri: doc.client_uri } : {}),
    grantTypes: grants.length ? grants : [...SUPPORTED_GRANT_TYPES],
    tokenEndpointAuthMethod:
      typeof doc.token_endpoint_auth_method === 'string' ? doc.token_endpoint_auth_method : 'none',
  };
}

/** How long to hold a document: its `max-age` (capped), the default when it says nothing, 0 for `no-store`. */
export function ttlFrom(cacheControl: string | null): number {
  if (!cacheControl) return CIMD_DEFAULT_TTL_MS;
  const lower = cacheControl.toLowerCase();
  if (/\bno-store\b/.test(lower)) return 0;
  const match = lower.match(/\bmax-age=(\d+)/);
  if (!match) return CIMD_DEFAULT_TTL_MS;
  return Math.min(Number(match[1]) * 1000, CIMD_MAX_TTL_MS);
}

/**
 * Is this a globally routable unicast address? Loopback, private (RFC 1918),
 * CGNAT, link-local (incl. the cloud metadata endpoint), unspecified,
 * multicast, reserved and documentation ranges are not; IPv6 forms that embed
 * an IPv4 address (mapped, 6to4, NAT64) are judged by the address they embed.
 */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPublicV4(ip);
  if (family === 6) return isPublicV6(ip);
  return false;
}

function isPublicV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a >= 224) return false;
  return true;
}

function isPublicV6(ip: string): boolean {
  const groups = expandV6(ip.toLowerCase());
  if (!groups) return false;
  const first = parseInt(groups[0], 16);
  const v4Of = (hi: string, lo: string) => {
    const h = parseInt(hi, 16);
    const l = parseInt(lo, 16);
    return `${h >> 8}.${h & 0xff}.${l >> 8}.${l & 0xff}`;
  };
  // ::/8 — unspecified, loopback, IPv4-compatible; ::ffff:0:0/96 — IPv4-mapped
  if (first === 0) {
    const mapped = groups.slice(0, 5).every((g) => g === '0000') && groups[5] === 'ffff';
    return mapped ? isPublicV4(v4Of(groups[6], groups[7])) : false;
  }
  if (groups[0] === '0064' && groups[1] === 'ff9b') return isPublicV4(v4Of(groups[6], groups[7])); // NAT64
  if (first === 0x2002) return isPublicV4(v4Of(groups[1], groups[2])); // 6to4
  if (groups[0] === '0100' && groups.slice(1, 4).every((g) => g === '0000')) return false; // 100::/64 discard
  if (groups[0] === '2001' && groups[1] === '0db8') return false; // 2001:db8::/32 documentation
  if (groups[0] === '2001' && groups[1] === '0002' && groups[2] === '0000') return false; // 2001:2::/48 benchmarking
  if (groups[0] === '2001' && (parseInt(groups[1], 16) & 0xfff0) === 0x0010) return false; // 2001:10::/28 ORCHID
  if ((first & 0xfff0) === 0x3ff0) return false; // 3fff::/20 documentation
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  return true;
}

/** The eight 4-hex-digit groups of an IPv6 address, or null when it does not parse. */
function expandV6(ip: string): string[] | null {
  let s = ip;
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const [a, b, c, d] = v4[1].split('.').map(Number);
    s = `${s.slice(0, -v4[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...head, ...(halves.length === 2 ? Array(missing).fill('0') : []), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.padStart(4, '0'));
}

/**
 * Reads a body under a byte cap. Throws — and, by leaving the loop, cancels the
 * stream — the moment the cap is passed, so an oversized document never buffers.
 */
export async function readCapped(
  body: AsyncIterable<Uint8Array> | null,
  maxBytes: number,
): Promise<string> {
  if (!body) return '';
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new Error(`document exceeds ${maxBytes} bytes`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * A `lookup` for the socket that answers from the vetted addresses only — the
 * name is never resolved again between the check and the connect. Node's
 * `net.connect` calls it with `{ all: true }` (happy eyeballs) or for one address.
 */
export function pinnedLookup(addresses: ResolvedAddress[]) {
  return (
    _hostname: string,
    options: { all?: boolean } | ((...args: unknown[]) => void),
    callback?: (...args: unknown[]) => void,
  ) => {
    const done = (typeof options === 'function' ? options : callback) as (
      ...args: unknown[]
    ) => void;
    const all = typeof options === 'object' && options !== null && options.all === true;
    if (all)
      done(
        null,
        addresses.map((a) => ({ address: a.address, family: a.family })),
      );
    else done(null, addresses[0].address, addresses[0].family);
  };
}

const defaultTransport: ClientMetadataTransport = {
  async lookup(hostname) {
    const found = await dnsLookup(hostname, { all: true, verbatim: true });
    return found.map((a) => ({ address: a.address, family: a.family as 4 | 6 }));
  },
  async fetch(url, { addresses, signal }) {
    const agent = new Agent({
      connect: { lookup: pinnedLookup(addresses) as never },
      maxRedirections: 0,
    });
    try {
      const res = await undiciFetch(url, {
        method: 'GET',
        headers: { accept: 'application/json', 'user-agent': 'bffless-ce/oauth (client-metadata)' },
        redirect: 'manual',
        signal,
        dispatcher: agent,
      });
      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > CIMD_MAX_BYTES) {
        await res.body?.cancel();
        throw new Error(`document declares ${declared} bytes, over the ${CIMD_MAX_BYTES} byte cap`);
      }
      if (res.status !== 200) {
        await res.body?.cancel();
        return { status: res.status, headers: res.headers, text: '' };
      }
      const text = await readCapped(res.body, CIMD_MAX_BYTES);
      return { status: res.status, headers: res.headers, text };
    } finally {
      await agent.close();
    }
  },
};
