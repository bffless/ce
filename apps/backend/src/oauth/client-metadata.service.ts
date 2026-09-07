import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { v5 as uuidv5 } from 'uuid';
import {
  isPublicAddress,
  lookupAddresses,
  pinnedLookup,
  readCapped,
  type ResolvedAddress,
} from '../common/outbound-url.guard';
import { OAuthError } from './oauth.errors';
import { isAcceptableRedirect } from './redirect-uri.util';

// The guard's building blocks live in common/outbound-url.guard.ts (#770) so
// proxy-rule targets and app bundle URLs share them; re-exported here so the
// oauth surface is unchanged.
export { isPublicAddress, pinnedLookup, readCapped, type ResolvedAddress };

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
 *
 * The fetch is also a cost a session holder can make the server pay: a
 * query string is legal in a `client_id`, so a cache-busting query defeats
 * the positive cache. Three ceilings (#768): the authorize route's own
 * `@Throttle` override, one in-flight fetch per URL shared by concurrent
 * callers, and a fixed-TTL negative cache so a failing URL is not refetched
 * on every request.
 */

export const CIMD_FETCH_TIMEOUT_MS = 5_000;
export const CIMD_MAX_BYTES = 64 * 1024;
/** Cache lifetime when the document carries no `Cache-Control: max-age`. */
export const CIMD_DEFAULT_TTL_MS = 5 * 60_000;
/** The longest a `max-age` may hold a document — a rotated redirect_uri must land within a day. */
export const CIMD_MAX_TTL_MS = 24 * 3600_000;
/** How long a failed resolution (unreachable, non-200, invalid document) is remembered — fixed, never from `Cache-Control`. */
export const CIMD_NEGATIVE_TTL_MS = 60_000;
/** Positive and negative entries together — a failing URL costs the same slot a document does. */
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
  private readonly cache = new Map<string, CacheEntry>();
  /** One fetch per URL at a time: concurrent callers await the same promise. */
  private readonly inflight = new Map<string, Promise<ClientMetadataDocument>>();
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
   * A failure is remembered for {@link CIMD_NEGATIVE_TTL_MS} and answered from the
   * cache without another fetch; concurrent calls for one URL share one fetch.
   */
  async resolve(clientId: string): Promise<ClientMetadataDocument> {
    const url = assertClientIdUrl(clientId);
    const cached = this.cache.get(clientId);
    if (cached && cached.expiresAt > Date.now()) {
      if ('doc' in cached) return cached.doc;
      throw invalidClient(cached.description);
    }
    this.cache.delete(clientId);

    const pending = this.inflight.get(clientId);
    if (pending) return pending;
    const fetching = this.fetchDocument(clientId, url).finally(() => {
      this.inflight.delete(clientId);
    });
    this.inflight.set(clientId, fetching);
    return fetching;
  }

  clearCache(): void {
    this.cache.clear();
  }

  /** The guarded fetch and parse; the outcome — document or failure — goes into the cache. */
  private async fetchDocument(clientId: string, url: URL): Promise<ClientMetadataDocument> {
    try {
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
      this.remember(clientId, { doc }, ttlFrom(res.headers.get('cache-control')));
      return doc;
    } catch (error) {
      if (error instanceof OAuthError) {
        this.remember(clientId, { description: error.description }, CIMD_NEGATIVE_TTL_MS);
      }
      throw error;
    }
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

  /** Insert-ordered and bounded: at the cap the oldest entry, positive or negative, makes room. */
  private remember(clientId: string, outcome: CacheOutcome, ttlMs: number): void {
    if (ttlMs <= 0) return;
    if (this.cache.size >= CIMD_CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(clientId, { ...outcome, expiresAt: Date.now() + ttlMs });
  }
}

/** A resolved document, or the `invalid_client` description a failed resolution produced. */
type CacheOutcome = { doc: ClientMetadataDocument } | { description: string };
type CacheEntry = CacheOutcome & { expiresAt: number };

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

const defaultTransport: ClientMetadataTransport = {
  lookup: lookupAddresses,
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
