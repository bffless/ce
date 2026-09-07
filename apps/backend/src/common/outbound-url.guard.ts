import { BadRequestException, Logger } from '@nestjs/common';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * The building blocks of CE's SSRF guard for server-side fetches of URLs a
 * caller influences — first built for OAuth Client ID Metadata Documents
 * (`oauth/client-metadata.service.ts`, #741), shared here so proxy-rule
 * targets and app bundle URLs (#770) vet a hostname the same way.
 *
 * The pieces, in the order a full guard uses them:
 *   1. {@link isPublicAddress} — is one address globally routable?
 *   2. {@link vetOutboundHost} — resolve a name and judge *every* address.
 *   3. {@link pinnedLookup} — connect only to the vetted addresses.
 *   4. {@link readCapped} — bound the body read.
 *
 * {@link guardOutboundHost} is 2 wrapped in the `OUTBOUND_URL_GUARD` policy
 * (`warn`, the default, logs and allows; `reject` throws) for the places
 * where a hard refusal would break self-hosters whose targets legitimately
 * resolve to private space (split-horizon DNS, in-cluster services).
 * {@link vetOutboundHosts} is 2 in bulk (one lookup per distinct name, a
 * few in flight at a time) and {@link enforceOutboundVerdict} the policy on
 * its own, for callers that vet a whole rule set before writing it (#780).
 * Every lookup is bounded by {@link OUTBOUND_LOOKUP_TIMEOUT_MS}.
 * The CIMD guard does not use the policy: a client_id is never allowed to
 * point inward.
 */

export const OUTBOUND_URL_GUARD_ENV = 'OUTBOUND_URL_GUARD';
export type OutboundUrlGuardMode = 'warn' | 'reject';
export const OUTBOUND_URL_GUARD_DEFAULT: OutboundUrlGuardMode = 'warn';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** Every address a name resolves to (`dns.lookup` with `all: true`), or throws. */
export type HostLookup = (hostname: string) => Promise<ResolvedAddress[]>;

/**
 * How long one {@link lookupAddresses} call may take. `dns.lookup` has no
 * timeout of its own (it is a blocking `getaddrinfo` on the libuv thread
 * pool), so a resolver that hangs would hold a rule create — or a whole
 * `rules push` — open indefinitely. A lookup that overruns is `timeout`:
 * unverifiable, and the caller's policy decides what that means (#780).
 */
export const OUTBOUND_LOOKUP_TIMEOUT_MS = 3_000;

/** Thrown by a {@link withLookupTimeout}-wrapped lookup that overran its budget. */
export class OutboundLookupTimeoutError extends Error {
  constructor(
    public readonly hostname: string,
    public readonly timeoutMs: number,
  ) {
    super(`lookup of ${hostname} timed out after ${timeoutMs} ms`);
    this.name = 'OutboundLookupTimeoutError';
  }
}

/**
 * Bound a {@link HostLookup} to `timeoutMs`. The underlying lookup is not
 * cancelled (Node offers no way to), only abandoned; the timer is unref'd so
 * it never keeps the process alive.
 */
export function withLookupTimeout(
  lookup: HostLookup,
  timeoutMs: number = OUTBOUND_LOOKUP_TIMEOUT_MS,
): HostLookup {
  return (hostname) =>
    new Promise<ResolvedAddress[]>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new OutboundLookupTimeoutError(hostname, timeoutMs)),
        timeoutMs,
      );
      timer.unref?.();
      lookup(hostname).then(
        (addresses) => {
          clearTimeout(timer);
          resolve(addresses);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
}

export type OutboundHostVerdict =
  | { ok: true; addresses: ResolvedAddress[] }
  | {
      ok: false;
      /** `timeout` — the lookup overran {@link OUTBOUND_LOOKUP_TIMEOUT_MS}; the host could not be verified either way. */
      reason: 'unresolved' | 'non-public' | 'timeout';
      addresses: ResolvedAddress[];
      detail: string;
    };

const logger = new Logger('OutboundUrlGuard');
const warnedModes = new Set<string>();

/**
 * The policy from `OUTBOUND_URL_GUARD`. Anything other than `warn` / `reject`
 * (case-insensitive, trimmed) is treated as `warn` and warned about once per
 * value — call it from a service constructor so the warning lands at startup.
 */
export function outboundUrlGuardMode(
  raw: string | undefined = process.env[OUTBOUND_URL_GUARD_ENV],
): OutboundUrlGuardMode {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '' || value === 'warn') return 'warn';
  if (value === 'reject') return 'reject';
  if (!warnedModes.has(value)) {
    warnedModes.add(value);
    logger.warn(
      `${OUTBOUND_URL_GUARD_ENV}=${JSON.stringify(raw)} is not one of warn|reject; using ${OUTBOUND_URL_GUARD_DEFAULT}`,
    );
  }
  return OUTBOUND_URL_GUARD_DEFAULT;
}

/**
 * The hosts CE deliberately lets an operator point *inward* at over plain
 * http: a same-pod sidecar and in-cluster Kubernetes services. They are
 * internal by declaration, so resolving them proves nothing — callers skip
 * the public-address check for these and only these.
 */
export function isExplicitlyInternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.svc') ||
    host.endsWith('.svc.cluster.local')
  );
}

/**
 * `dns.lookup` with every address, in resolver order, bounded to
 * {@link OUTBOUND_LOOKUP_TIMEOUT_MS}; the default {@link HostLookup}.
 */
export const lookupAddresses: HostLookup = withLookupTimeout(async (hostname) => {
  const found = await dnsLookup(hostname, { all: true, verbatim: true });
  return found.map((a) => ({ address: a.address, family: a.family as 4 | 6 }));
});

/**
 * Resolve `hostname` and judge every address it has. An IP literal (with or
 * without IPv6 brackets) is judged as itself. A name that does not resolve,
 * or resolves to nothing, is `unresolved`; one whose lookup overran the
 * budget is `timeout`. Neither can be vetted, and the caller decides whether
 * that is fatal.
 */
export async function vetOutboundHost(
  hostname: string,
  lookup: HostLookup = lookupAddresses,
): Promise<OutboundHostVerdict> {
  const host = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  let addresses: ResolvedAddress[];
  if (isIP(host) !== 0) {
    addresses = [{ address: host, family: isIP(host) as 4 | 6 }];
  } else {
    try {
      addresses = await lookup(host);
    } catch (error) {
      if (error instanceof OutboundLookupTimeoutError) {
        return {
          ok: false,
          reason: 'timeout',
          addresses: [],
          detail: `${host} could not be verified (${error.message})`,
        };
      }
      return {
        ok: false,
        reason: 'unresolved',
        addresses: [],
        detail: `${host} does not resolve (${error instanceof Error ? error.message : String(error)})`,
      };
    }
    if (addresses.length === 0) {
      return { ok: false, reason: 'unresolved', addresses, detail: `${host} does not resolve` };
    }
  }
  const nonPublic = addresses.filter((a) => !isPublicAddress(a.address)).map((a) => a.address);
  if (nonPublic.length > 0) {
    return {
      ok: false,
      reason: 'non-public',
      addresses,
      detail: `${host} resolves to a non-public address (${nonPublic.join(', ')})`,
    };
  }
  return { ok: true, addresses };
}

export interface GuardOutboundHostOptions {
  /** What is being vetted, for the log line / error — e.g. `proxy rule target https://…`. */
  subject: string;
  /** Defaults to the process-wide `OUTBOUND_URL_GUARD` setting. */
  mode?: OutboundUrlGuardMode;
  lookup?: HostLookup;
  /** Where the `warn`-mode line goes; defaults to this module's logger. */
  logger?: Pick<Logger, 'warn'>;
}

/**
 * {@link vetOutboundHost} under the `OUTBOUND_URL_GUARD` policy. Public
 * addresses pass silently. Otherwise `warn` logs the subject and the verdict
 * and returns; `reject` throws a `BadRequestException` naming the env var so
 * the operator knows which knob refused it.
 */
export async function guardOutboundHost(
  hostname: string,
  opts: GuardOutboundHostOptions,
): Promise<OutboundHostVerdict> {
  const verdict = await vetOutboundHost(hostname, opts.lookup);
  return enforceOutboundVerdict(verdict, opts);
}

/**
 * The `OUTBOUND_URL_GUARD` policy applied to an already-computed verdict —
 * the second half of {@link guardOutboundHost}, for callers that resolve in
 * bulk ({@link vetOutboundHosts}) and judge afterwards. A passing verdict is
 * returned silently; a failing one is logged and returned under `warn`, or
 * thrown as a `BadRequestException` naming the env var under `reject`.
 */
export function enforceOutboundVerdict(
  verdict: OutboundHostVerdict,
  opts: Omit<GuardOutboundHostOptions, 'lookup'>,
): OutboundHostVerdict {
  if (verdict.ok) return verdict;
  const mode = opts.mode ?? outboundUrlGuardMode();
  if (mode === 'reject') {
    throw new BadRequestException(
      `${opts.subject}: ${verdict.detail}; refused by ${OUTBOUND_URL_GUARD_ENV}=reject`,
    );
  }
  (opts.logger ?? logger).warn(
    `${opts.subject}: ${verdict.detail}; allowed because ${OUTBOUND_URL_GUARD_ENV}=${mode}`,
  );
  return verdict;
}

/** How many names {@link vetOutboundHosts} resolves at once. */
export const OUTBOUND_LOOKUP_CONCURRENCY = 4;

export interface VetOutboundHostsOptions {
  lookup?: HostLookup;
  /** Defaults to {@link OUTBOUND_LOOKUP_CONCURRENCY}. */
  concurrency?: number;
}

/**
 * {@link vetOutboundHost} over many names at once — a rule set can carry
 * dozens of targets, most sharing a few hosts. Each distinct hostname is
 * resolved exactly once (keyed as given, after the same bracket/trailing-dot
 * normalisation the single vet applies) and at most `concurrency` lookups are
 * in flight at a time. The result maps every *input* hostname to its verdict.
 */
export async function vetOutboundHosts(
  hostnames: Iterable<string>,
  opts: VetOutboundHostsOptions = {},
): Promise<Map<string, OutboundHostVerdict>> {
  const normalise = (h: string) =>
    h
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '')
      .toLowerCase();
  const inputs = [...hostnames];
  const byKey = new Map<string, Promise<OutboundHostVerdict>>();
  const unique = [...new Set(inputs.map(normalise))];
  const concurrency = Math.max(1, opts.concurrency ?? OUTBOUND_LOOKUP_CONCURRENCY);

  let next = 0;
  const worker = async () => {
    while (next < unique.length) {
      const key = unique[next++];
      const verdict = vetOutboundHost(key, opts.lookup);
      byKey.set(key, verdict);
      await verdict;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));

  const out = new Map<string, OutboundHostVerdict>();
  for (const input of inputs) out.set(input, await byKey.get(normalise(input))!);
  return out;
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
