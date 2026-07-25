import { Injectable, Logger } from '@nestjs/common';
import { promises as dns } from 'dns';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as http from 'http';
import * as path from 'path';

export interface PreflightCheck {
  host: string;
  resolvedIps: string[];
  probeOk: boolean;
  error?: string;
}

export interface PreflightResult {
  ok: boolean;
  checks: PreflightCheck[];
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

  async run(domain: string): Promise<PreflightResult> {
    const hosts = [domain, `www.${domain}`, `admin.${domain}`];
    const token = `preflight-${crypto.randomBytes(16).toString('hex')}`;
    const content = token; // body == token: cheap, unguessable, self-describing
    const filePath = path.join(this.webroot(), '.well-known', 'acme-challenge', token);

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
    try {
      const checks: PreflightCheck[] = [];
      for (const host of hosts) {
        const resolvedIps = await this.resolveA(host);
        if (resolvedIps.some((ip) => isDisallowedProbeIp(ip))) {
          checks.push({ host, resolvedIps, probeOk: false, error: 'resolves to a private or reserved address' });
          continue;
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
        checks.push({ host, resolvedIps, probeOk, error: probeOk ? undefined : error });
      }
      return { ok: checks.every((c) => c.probeOk), checks };
    } finally {
      await fs.rm(filePath, { force: true });
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

  private sendProbeRequest(options: http.RequestOptions): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(options, (res) => {
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
