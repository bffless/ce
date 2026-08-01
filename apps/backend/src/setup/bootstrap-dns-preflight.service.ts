import { Injectable, Logger } from '@nestjs/common';
import { promises as dns } from 'dns';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import {
  deriveKnobs,
  loadInstanceConfig,
  type Port80Mode,
  type ProxyMode,
} from '../bootstrap/instance-config';

/**
 * What a probe is being asked to prove.
 *
 * - `acme` (default, and the ONLY thing `run()` ever uses): "will Let's
 *   Encrypt's HTTP-01 validator succeed against this host?" — port 80 plus a
 *   token echo out of the certbot webroot. Never weaken this path; the wizard
 *   hard-gates issuance on it precisely because it walks the CA's own route.
 * - `reachability`: "does this hostname reach this server, so an app served
 *   here will work?" — a strictly weaker, differently-shaped question that the
 *   app catalog asks about a not-yet-mapped app subdomain.
 */
export type ProbeMode = 'acme' | 'reachability';

export interface ProbeOptions {
  mode?: ProbeMode;
}

/**
 * How a reachability probe failed, so callers can word remediation honestly.
 *
 * `origin-error` and `origin-down` are both "DNS is fine, the proxy answered"
 * but they need different remedies:
 *  - `origin-error` (Cloudflare 520–527): the edge could not reach ANY origin.
 *  - `origin-down` (502/503/504): the proxy reached this server but the
 *    backend behind it did not return a valid response.
 */
export type ProbeFailure = 'no-dns' | 'private-ip' | 'origin-error' | 'origin-down' | 'no-response';

export interface PreflightCheck {
  host: string;
  resolvedIps: string[];
  probeOk: boolean;
  error?: string;
  /** Which probe actually ran (absent on nothing — always set from here on). */
  probeKind?: 'acme' | 'https-reachability' | 'http-reachability';
  /** Failure classification; only populated for the reachability probe. */
  failure?: ProbeFailure;
  /** HTTP status the host answered with, when it answered at all. */
  status?: number;
}

export interface PreflightResult {
  ok: boolean;
  checks: PreflightCheck[];
}

/** The serving model the probe has to work with — see resolveServingModel(). */
interface ServingModel {
  proxyMode: ProxyMode;
  port80: Port80Mode;
  /** A proxy/edge sits in the request path and terminates TLS. */
  proxied: boolean;
  /** Reachability mode must use HTTPS/443 rather than the port-80 token echo. */
  probeHttps: boolean;
}

/**
 * Classify a status as "something in front answered, the origin behind it did
 * not". Two families, scoped differently on purpose:
 *
 *  - 520–527 are Cloudflare-specific and unambiguous — no application emits
 *    them — so they are always an origin error, whatever the serving model.
 *  - 502/503/504 are standard gateway statuses. Behind a generic reverse proxy
 *    (nginx/Traefik/HAProxy) they mean the proxy could not get a valid answer
 *    out of the backend, which is a strong backend-down signal and must NOT
 *    read as "reachable". On a direct-serving instance, though, there is no
 *    proxy in the path: a 502 there is the application's own response, which
 *    still proves the hostname reaches this server. Hence the `proxied` scope.
 */
function classifyOriginError(status: number, proxied: boolean): ProbeFailure | null {
  if (status >= 520 && status <= 527) return 'origin-error';
  if (proxied && (status === 502 || status === 503 || status === 504)) return 'origin-down';
  return null;
}

// SSRF guard (v0.2.18 review, m6): the probe is a blind GET to a
// caller-supplied hostname; refuse anything resolving into private,
// loopback, link-local (incl. cloud metadata), CGNAT or reserved space.
// IPv4-only because resolveA only asks for A records.
export function isDisallowedProbeIp(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 || a === 127 || a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224 // multicast + reserved
  );
}

/**
 * Preflight for the direct + Let's Encrypt path. The probe writes a token
 * into the ACME webroot and fetches it back over the PUBLIC internet
 * (http://<host>/.well-known/acme-challenge/<token>), so a green result
 * proves DNS + port 80 + nginx webroot routing end-to-end — exactly the path
 * the LE validator takes. This is what lets the wizard hard-gate issuance
 * without ever burning LE's 5-failures/hostname/hour validation limit.
 *
 * Caveat (documented for the manual droplet leg): the probe egresses from the
 * droplet and loops back through its own public IP — NAT hairpin. DigitalOcean
 * droplets hairpin fine; some home-lab NATs do not, which surfaces as a
 * probe failure even though an external validator would succeed.
 */
@Injectable()
export class BootstrapDnsPreflightService {
  private readonly logger = new Logger(BootstrapDnsPreflightService.name);

  /**
   * ACME gate. Deliberately takes no options: issuance preflight must always
   * be the port-80 token echo, never the weaker reachability probe.
   */
  async run(domain: string): Promise<PreflightResult> {
    const hosts = [domain, `www.${domain}`, `admin.${domain}`];
    const checks = await Promise.all(hosts.map((host) => this.probeHost(host)));
    return { ok: checks.every((c) => c.probeOk), checks };
  }

  /**
   * Default mode is `acme` — every existing caller (run(), and
   * PrimarySslService's extraSans checks, which ARE about ACME) keeps the
   * port-80 token-echo semantics unchanged.
   *
   * `reachability` mode answers a different question and, on instances that
   * serve behind a proxy or with port 80 closed, uses an HTTPS probe instead:
   * those instances render NO acme-challenge location at all (see
   * render-main-conf.sh's PORT80=closed branch), so the token echo is not
   * merely inconvenient there, it is impossible. Direct-serving instances DO
   * render it, so they keep the strictly stronger port-80 proof.
   */
  async probeHost(host: string, opts: ProbeOptions = {}): Promise<PreflightCheck> {
    if (opts.mode === 'reachability') {
      return this.reachabilityProbe(host, this.resolveServingModel());
    }
    return this.acmeProbe(host);
  }

  /**
   * Mirrors render-main-conf.sh's resolution order exactly: instance.env (i.e.
   * instance.json here) wins, otherwise PROXY_MODE from the environment with
   * 'none' as the default, and the knobs derive from that. Keeping the two in
   * step matters — if we probe a port nginx isn't listening on, the gate lies.
   *
   * `proxied` and `probeHttps` are deliberately NOT the same predicate:
   * a direct-serving instance with port 80 closed must be probed over HTTPS
   * (nothing answers on 80), but it has no proxy in the request path, so a
   * gateway status it returns is the application's own answer.
   */
  private resolveServingModel(): ServingModel {
    const cfg = loadInstanceConfig();
    const envProxyMode = process.env.PROXY_MODE;
    const proxyMode: ProxyMode =
      cfg?.proxyMode ??
      (envProxyMode === 'cloudflare' || envProxyMode === 'proxy' || envProxyMode === 'none'
        ? envProxyMode
        : 'none');
    const { port80 } = deriveKnobs({ ...(cfg ?? { version: 2, state: 'applied' }), proxyMode });
    const proxied = proxyMode === 'cloudflare' || proxyMode === 'proxy';
    return { proxyMode, port80, proxied, probeHttps: proxied || port80 === 'closed' };
  }

  private async acmeProbe(host: string): Promise<PreflightCheck> {
    const token = `preflight-${crypto.randomBytes(16).toString('hex')}`;
    const content = token; // body == token: cheap, unguessable, self-describing
    const filePath = path.join(this.webroot(), '.well-known', 'acme-challenge', token);

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
    try {
      const resolvedIps = await this.resolveA(host);
      if (resolvedIps.some((ip) => isDisallowedProbeIp(ip))) {
        return {
          host,
          resolvedIps,
          probeOk: false,
          error: 'resolves to a private or reserved address',
          probeKind: 'acme',
        };
      }
      let probeOk = false;
      let error: string | undefined;
      try {
        const body = await this.fetchProbe(host, resolvedIps[0], token, content);
        probeOk = body === content;
        if (!probeOk) error = 'Another server answered on port 80 for this hostname';
      } catch (e) {
        error = e instanceof Error ? e.message : 'Unreachable over HTTP';
      }
      if (!probeOk && resolvedIps.length === 0 && !error) {
        error = 'Hostname does not resolve yet';
      }
      return { host, resolvedIps, probeOk, error: probeOk ? undefined : error, probeKind: 'acme' };
    } finally {
      await fs.rm(filePath, { force: true });
    }
  }

  /**
   * Reachability probe for proxied / port-80-closed instances: GET https://<host>/
   * and accept ANY real HTTP answer. A 404 is a SUCCESS here — at preflight
   * time the app's subdomain has no mapping yet by definition, so 404 is the
   * expected shape of "yes, this hostname lands on a server that will serve
   * the app once installed".
   *
   * What this does NOT prove: that the answering origin is *this* CE instance.
   * A proxied edge terminates TLS and we deliberately skip certificate
   * validation below, so authenticity is out of reach on this path; callers
   * must word their messages accordingly. The shapes we reject are the
   * "something in front answered, the origin behind it did not" ones — see
   * classifyOriginError for why 502/503/504 only count when proxied.
   */
  /**
   * Reachability, on every serving model — never the ACME token echo.
   *
   * The echo answers "could Let's Encrypt validate this host?", which is a
   * different and strictly harder question, and it was wrong in both
   * directions here:
   *
   *  - FALSE FAILURES. Behind a Cloudflare Tunnel (Umbrel) or any proxy an
   *    unmapped subdomain answers 404, and `fetchProbe` rejects every non-2xx
   *    ("HTTP 404 from <host>"), so the app-catalog install gate blocked
   *    permanently on a host that was perfectly reachable. The host cannot
   *    answer as itself until the install creates it — chicken and egg.
   *  - FALSE PASSES. On a direct-serving instance the echo only succeeded
   *    because the request fell through to the PRIMARY vhost's ACME location.
   *    It never measured the app host, and the identical probe fails once
   *    that host has a vhost of its own (ce#584).
   *
   * The port still follows the serving model — `probeHttps` instances have
   * nothing listening on 80 — but the verdict is now the same everywhere:
   * any status that is not an origin error proves the hostname arrives here.
   */
  private async reachabilityProbe(host: string, model: ServingModel): Promise<PreflightCheck> {
    const probeKind = model.probeHttps ? 'https-reachability' : 'http-reachability';
    const resolvedIps = await this.resolveA(host);
    if (resolvedIps.some((ip) => isDisallowedProbeIp(ip))) {
      return {
        host,
        resolvedIps,
        probeOk: false,
        error: 'resolves to a private or reserved address',
        probeKind,
        failure: 'private-ip',
      };
    }
    if (resolvedIps.length === 0) {
      return {
        host,
        resolvedIps,
        probeOk: false,
        error: 'Hostname does not resolve yet',
        probeKind,
        failure: 'no-dns',
      };
    }

    try {
      const { statusCode } = await this.fetchReachabilityProbe(host, resolvedIps[0], model);
      const failure = classifyOriginError(statusCode, model.proxied);
      if (failure) {
        return {
          host,
          resolvedIps,
          probeOk: false,
          status: statusCode,
          error:
            failure === 'origin-error'
              ? `The proxy in front of ${host} returned HTTP ${statusCode} — it could not reach an origin`
              : `The proxy in front of ${host} returned HTTP ${statusCode} — it reached this server, ` +
                `but the backend behind it did not return a valid response`,
          probeKind,
          failure,
        };
      }
      return {
        host,
        resolvedIps,
        probeOk: true,
        status: statusCode,
        probeKind,
      };
    } catch (e) {
      return {
        host,
        resolvedIps,
        probeOk: false,
        error: e instanceof Error ? e.message : 'Unreachable',
        probeKind,
        failure: 'no-response',
      };
    }
  }

  private webroot(): string {
    return process.env.CERTBOT_WEBROOT || '/var/www/certbot';
  }

  // Both mockable seams below are instance methods for exactly that reason.
  private async resolveA(host: string): Promise<string[]> {
    try {
      return await dns.resolve4(host);
    } catch {
      return [];
    }
  }

  // SSRF/TOCTOU guard (v0.2.18 review, m6 follow-up): `host` was already
  // resolved and vetted by resolveA()/isDisallowedProbeIp() in run(). If we
  // handed the raw hostname to fetch()/http here, the HTTP client would
  // re-resolve DNS itself — a short-TTL record could rebind to a private or
  // metadata IP (or answer with an AAAA record, bypassing the IPv4-only
  // check entirely) between the vetting resolve and this connection. So we
  // pin the TCP connection to the already-vetted IPv4 address (`ip`) and
  // send the real hostname via the Host header, which keeps ACME webroot
  // vhost routing on the target server working exactly as before.
  //
  // Redirects are NOT followed — same as the previous `redirect: 'manual'`
  // fetch() behavior: any non-2xx (including a 3xx) is treated as a probe
  // failure below. A redirect target could point at a different hostname,
  // which would reopen the same rebinding hole one hop later.
  private async fetchProbe(host: string, ip: string | undefined, token: string, _content: string): Promise<string> {
    if (!ip) throw new Error('No resolved address to probe');
    const { statusCode, body } = await this.sendProbeRequest({
      host: ip,
      port: 80,
      path: `/.well-known/acme-challenge/${token}`,
      method: 'GET',
      headers: { Host: host },
      timeout: 5000,
    });
    if (statusCode < 200 || statusCode >= 300) throw new Error(`HTTP ${statusCode} from ${host}`);
    return body;
  }

  // Same TOCTOU pinning as fetchProbe: connect to the already-vetted IPv4
  // address, carry the hostname in SNI (`servername`) AND the Host header so
  // both TLS and vhost selection land on the right server block, and never let
  // the HTTP client re-resolve. Redirects are not followed — a 3xx is simply
  // an answer, which is all reachability mode needs.
  //
  // rejectUnauthorized:false is deliberate and load-bearing. We connect BY IP,
  // so the presented certificate would fail hostname verification even when it
  // is perfectly valid, and a direct origin behind Cloudflare commonly serves a
  // self-signed or CF-origin cert that no public root chains to. This probe
  // proves REACHABILITY, not AUTHENTICITY: nothing from the response is
  // trusted, echoed back, or stored — only the status code is read — and the
  // IP was already vetted by isDisallowedProbeIp() before we got here, so the
  // usual SSRF risk of skipping validation does not apply.
  private async fetchReachabilityProbe(
    host: string,
    ip: string | undefined,
    model: ServingModel,
  ): Promise<{ statusCode: number }> {
    if (!ip) throw new Error('No resolved address to probe');
    // A direct-serving instance with port 80 open is probed there: it is the
    // port nginx definitely answers on (the wildcard/default vhost), and it
    // avoids depending on a certificate existing for a host that, by
    // definition, does not have one yet.
    if (!model.probeHttps) {
      const { statusCode } = await this.sendProbeRequest({
        host: ip,
        port: 80,
        path: '/',
        method: 'GET',
        headers: { Host: host },
        timeout: 5000,
      });
      return { statusCode };
    }
    return this.sendSecureProbeRequest({
      host: ip,
      servername: host,
      port: 443,
      path: '/',
      method: 'GET',
      headers: { Host: host },
      timeout: 5000,
      rejectUnauthorized: false,
    });
  }

  private sendProbeRequest(options: http.RequestOptions): Promise<{ statusCode: number; body: string }> {
    return this.consumeProbeResponse(http.request(options), options);
  }

  private sendSecureProbeRequest(
    options: https.RequestOptions,
  ): Promise<{ statusCode: number; body: string }> {
    return this.consumeProbeResponse(https.request(options), options);
  }

  private consumeProbeResponse(
    req: http.ClientRequest,
    options: http.RequestOptions,
  ): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      req.on('response', (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error(`Timed out probing ${String(options.host)}`)));
      req.on('error', reject);
      req.end();
    });
  }
}
