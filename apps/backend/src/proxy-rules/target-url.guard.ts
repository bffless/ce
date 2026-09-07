import { BadRequestException, Logger } from '@nestjs/common';
import {
  isExplicitlyInternalHost,
  outboundUrlGuardMode,
  vetOutboundHost,
  vetOutboundHosts,
  OUTBOUND_URL_GUARD_ENV,
  type HostLookup,
  type OutboundHostVerdict,
  type OutboundUrlGuardMode,
} from '../common/outbound-url.guard';
import { methodSignature } from './method-match';

/**
 * The proxy-rule target check, as a verdict rather than a throw, so every
 * writer of `proxy_rules` rows can run it and apply its own policy (#780):
 *
 *   (a) the static rules — a parseable http(s) URL; plain http only to an
 *       explicitly internal host; no hostname that *names* the loopback,
 *       metadata or private space outright — `check: 'static'`;
 *   (b) resolve the host and require every address to be public
 *       (`common/outbound-url.guard.ts`, #770) — `check: 'resolve'`.
 *
 * `ProxyRulesService.validateTargetUrl` (the UI/REST create/update door)
 * keeps its historical behaviour on top of this: (a) is always a 400, (b) is
 * warn/reject per `OUTBOUND_URL_GUARD`. The sync, import and copy doors
 * ({@link guardRuleTargets}) had neither check until #780, so there *both*
 * are gated by the mode — under the default `warn` an existing rule set with
 * a plain-http target still pushes, with a warning line.
 */

// SSRF protection - hostnames that name internal services outright
const BLOCKED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  'metadata.google.internal',
  '169.254.169.254', // AWS/GCP metadata
];

// SSRF protection - IP-literal patterns for private networks
const BLOCKED_IP_PATTERNS = [
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^127\./, // 127.0.0.0/8
  /^169\.254\./, // Link-local
  /^fc00:/i, // IPv6 unique local
  /^fe80:/i, // IPv6 link-local
];

export type TargetUrlVerdict =
  | { ok: true }
  | { ok: false; check: 'static'; reason: string }
  | { ok: false; check: 'resolve'; reason: string; verdict: OutboundHostVerdict };

type StaticCheck =
  | { ok: true; hostname: string; resolve: boolean }
  | { ok: false; check: 'static'; reason: string };

/**
 * Rule (a). The messages are the ones the UI has always shown, verbatim.
 * On success says whether the host still needs resolving — explicitly
 * internal hosts (localhost / 127.0.0.1 / *.svc / *.svc.cluster.local) are
 * allowed by declaration and never looked up.
 */
function checkTargetUrlStatic(url: string): StaticCheck {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, check: 'static', reason: 'Invalid URL format' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Allow HTTPS for any URL, or HTTP for internal services (K8s services, localhost)
  if (parsed.protocol === 'https:') {
    // HTTPS is allowed
  } else if (parsed.protocol === 'http:') {
    // HTTP allowed for internal K8s services (*.svc or *.svc.cluster.local)
    // and localhost/127.0.0.1 for same-pod sidecar communication
    const isInternalK8s = hostname.endsWith('.svc') || hostname.endsWith('.svc.cluster.local');
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
    if (!isInternalK8s && !isLocalhost) {
      return {
        ok: false,
        check: 'static',
        reason: 'Target URL must use HTTPS, or HTTP for internal services (*.svc, localhost)',
      };
    }
  } else {
    return { ok: false, check: 'static', reason: 'Target URL must use HTTP or HTTPS protocol' };
  }

  // Check blocked hosts (skip localhost since we allow it for same-pod sidecar)
  const isLocalhostTarget = hostname === 'localhost' || hostname === '127.0.0.1';
  if (!isLocalhostTarget && BLOCKED_HOSTS.includes(hostname)) {
    return { ok: false, check: 'static', reason: 'Target URL cannot point to internal services' };
  }

  // Check IP patterns (skip localhost since we allow it for same-pod sidecar)
  if (!isLocalhostTarget) {
    for (const pattern of BLOCKED_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        return {
          ok: false,
          check: 'static',
          reason: 'Target URL cannot point to internal IP ranges',
        };
      }
    }
  }

  return { ok: true, hostname, resolve: !isExplicitlyInternalHost(hostname) };
}

function resolveVerdict(verdict: OutboundHostVerdict): TargetUrlVerdict {
  return verdict.ok
    ? { ok: true }
    : { ok: false, check: 'resolve', reason: verdict.detail, verdict };
}

/** Rules (a) then (b) for one target URL. Never throws. */
export async function vetTargetUrl(url: string, lookup?: HostLookup): Promise<TargetUrlVerdict> {
  const stat = checkTargetUrlStatic(url);
  if (!stat.ok) return stat;
  if (!stat.resolve) return { ok: true };
  return resolveVerdict(await vetOutboundHost(stat.hostname, lookup));
}

export interface VetTargetUrlsOptions {
  lookup?: HostLookup;
  concurrency?: number;
}

/**
 * {@link vetTargetUrl} over many URLs: the static rule runs per URL, then the
 * hosts that need resolving go through `vetOutboundHosts` — one lookup per
 * distinct hostname, a bounded number in flight. Keyed by the input URL.
 */
export async function vetTargetUrls(
  urls: Iterable<string>,
  opts: VetTargetUrlsOptions = {},
): Promise<Map<string, TargetUrlVerdict>> {
  const out = new Map<string, TargetUrlVerdict>();
  const toResolve = new Map<string, string>(); // url → hostname
  for (const url of new Set(urls)) {
    const stat = checkTargetUrlStatic(url);
    if (!stat.ok) out.set(url, stat);
    else if (!stat.resolve) out.set(url, { ok: true });
    else toResolve.set(url, stat.hostname);
  }
  if (toResolve.size > 0) {
    const hosts = await vetOutboundHosts(toResolve.values(), opts);
    for (const [url, hostname] of toResolve) out.set(url, resolveVerdict(hosts.get(hostname)!));
  }
  return out;
}

/** The fields of an incoming/stored rule the target guard needs. */
export interface TargetGuardRule {
  pathPattern: string;
  method?: string | null;
  methods?: string[] | null;
  targetUrl?: string | null;
  proxyType?: string | null;
  internalRewrite?: boolean | null;
  pipelineConfig?: unknown;
  emailHandlerConfig?: unknown;
}

/**
 * Does this rule make an outbound request to `targetUrl`? Mirrors the
 * `skipUrlValidation` test in `ProxyRulesService.create`, with the proxyType
 * inferred from config shape when absent exactly as the sync plan does
 * (import stores a raw `proxyType ?? 'external_proxy'`, so the stored type
 * alone cannot be trusted for a pipeline rule carrying the internal
 * `http://internal/pipeline` default).
 */
export function isExternalTargetRule(rule: TargetGuardRule): boolean {
  if (!rule.targetUrl || rule.internalRewrite) return false;
  const proxyType =
    rule.proxyType ||
    (rule.pipelineConfig ? 'pipeline' : rule.emailHandlerConfig ? 'email_form_handler' : null) ||
    'external_proxy';
  return proxyType === 'external_proxy';
}

/** `Rule "GET /api/*"` — or `Rule "/api/*"` for an any-method rule. */
export function ruleTargetLabel(rule: TargetGuardRule): string {
  const sig = methodSignature({ method: rule.method ?? null, methods: rule.methods ?? null });
  return `Rule "${sig ? `${sig} ` : ''}${rule.pathPattern}"`;
}

export interface GuardRuleTargetsOptions {
  /** Defaults to the process-wide `OUTBOUND_URL_GUARD` setting. */
  mode?: OutboundUrlGuardMode;
  lookup?: HostLookup;
  concurrency?: number;
}

/**
 * Vet every external-target rule in a batch under `OUTBOUND_URL_GUARD` and
 * return the failures as warning lines —
 * `Rule "<method> <pathPattern>": target <url> — <reason>; allowed because
 * OUTBOUND_URL_GUARD=warn` — one per failing rule, in input order, mirroring
 * the sync response's schema warnings. Under `reject` a single
 * `BadRequestException` lists every failing rule instead (mirroring
 * `strictSchemas`), so the caller writes nothing. Internal rewrites,
 * pipeline and email-handler rules, and rules without a target are skipped.
 *
 * The caller decides where the warnings go: the sync response already has a
 * `warnings[]` channel the CLI prints; import and copy log them.
 */
export async function guardRuleTargets(
  rules: Iterable<TargetGuardRule>,
  opts: GuardRuleTargetsOptions = {},
): Promise<string[]> {
  const external = [...rules].filter(isExternalTargetRule);
  if (external.length === 0) return [];
  const mode = opts.mode ?? outboundUrlGuardMode();
  const verdicts = await vetTargetUrls(
    external.map((rule) => rule.targetUrl as string),
    { lookup: opts.lookup, concurrency: opts.concurrency },
  );
  const failures: string[] = [];
  for (const rule of external) {
    const verdict = verdicts.get(rule.targetUrl as string)!;
    if (!verdict.ok) {
      failures.push(`${ruleTargetLabel(rule)}: target ${rule.targetUrl} — ${verdict.reason}`);
    }
  }
  if (failures.length === 0) return [];
  if (mode === 'reject') {
    throw new BadRequestException(
      `Proxy rule targets refused by ${OUTBOUND_URL_GUARD_ENV}=reject: ${failures.join('; ')}`,
    );
  }
  return failures.map((line) => `${line}; allowed because ${OUTBOUND_URL_GUARD_ENV}=${mode}`);
}

/** Log each {@link guardRuleTargets} warning at warn level, prefixed with the rule set. */
export function logRuleTargetWarnings(
  logger: Pick<Logger, 'warn'>,
  ruleSetLabel: string,
  warnings: string[],
): void {
  for (const warning of warnings) logger.warn(`${ruleSetLabel}: ${warning}`);
}
