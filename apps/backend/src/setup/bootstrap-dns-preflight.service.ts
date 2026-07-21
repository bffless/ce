import { Injectable, Logger } from '@nestjs/common';
import { promises as dns } from 'dns';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
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
        let probeOk = false;
        let error: string | undefined;
        try {
          const body = await this.fetchProbe(host, token, content);
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

  private async fetchProbe(host: string, token: string, _content: string): Promise<string> {
    const res = await fetch(`http://${host}/.well-known/acme-challenge/${token}`, {
      redirect: 'manual', // a 301 means the ACME location is missing — that's a failure
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${host}`);
    return await res.text();
  }
}
