import { Injectable } from '@nestjs/common';
import { DomainsService } from '../domains/domains.service';
import { loadInstanceConfig } from '../bootstrap/instance-config';
import type { AppManualStep } from './app-manifest.types';

export type CertPlan =
  | { model: 'platform'; action: 'delegated' }
  | { model: 'wildcard'; action: 'covered' }
  | { model: 'edge-terminated'; action: 'none-needed' } // proxyMode cloudflare/proxy, or sslMode selfsigned
  | { model: 'direct-no-wildcard'; action: 'report' }
  | { model: 'unknown'; action: 'report' };

export interface AppCertStepResult {
  status: 'done' | 'action-required' | 'skipped';
  detail: string;
  manualStep?: AppManualStep;
}

/**
 * AppCertStepService — Task 8 of the app-catalog spec. Decides how (or
 * whether) this instance's serving model already covers a newly-installed
 * app's host with TLS, and reports honestly when it does not.
 *
 * It deliberately issues NOTHING. An app always lives at a subdomain of the
 * primary domain, and such a host can only ever be served with the wildcard
 * certificate: `DomainsService.create` enables `sslEnabled` on a subdomain
 * only when a wildcard exists, and `NginxConfigService`'s cert path for a
 * subdomain of the primary domain IS the wildcard file. A per-app certificate
 * therefore cannot reach the vhost that would serve it — the original design
 * re-issued the PRIMARY certificate with the app host as an extra SAN, which
 * spent an issuance and demanded a timed operator confirmation while leaving
 * the app on HTTP regardless (ce#584).
 *
 * A cert problem must NEVER fail the install — the app stays reachable over
 * the wildcard/existing certificate or plain HTTP in the meantime. Every
 * execute() branch degrades to `action-required`/`skipped`/`done`, never
 * throws.
 */
@Injectable()
export class AppCertStepService {
  constructor(private readonly domainsService: DomainsService) {}

  async plan(appHost: string): Promise<CertPlan> {
    // 1. Platform mode / SSL managed externally — DomainsService.create()
    // already forces sslEnabled: true and notifies the Control Plane; this
    // instance never touches certs for its own apps either.
    if (process.env.PLATFORM_MODE === 'true' || process.env.SSL_MANAGED_EXTERNALLY === 'true') {
      return { model: 'platform', action: 'delegated' };
    }

    // 2. A genuine *.<primary> wildcard already covers every subdomain,
    // including this app's.
    const wildcard = await this.domainsService.getWildcardCertificateStatus();
    if (wildcard?.exists) {
      return { model: 'wildcard', action: 'covered' };
    }

    // 3. No bootstrap-managed instance config (legacy compose install) — we
    // can't safely reason about the serving model here. Report only; never
    // touch certs.
    const cfg = loadInstanceConfig();
    if (!cfg) {
      return { model: 'unknown', action: 'report' };
    }

    // 4. Edge serving — Cloudflare, a reverse proxy, a Cloudflare Tunnel, an
    // externally-managed certificate, or self-signed behind a verify-off CDN.
    // TLS is somebody else's job: the origin answers plain HTTP while the
    // public URL is still HTTPS, so there is nothing to issue for this host
    // and a wildcard would not help.
    //
    // 'cloudflare-tunnel'/'external' are the RESERVED values documented in
    // instance-config.ts for the deferred Umbrel/tunnel profile — compared as
    // strings because they are not in the ProxyMode/SslMode unions yet.
    // Without them a tunnel install falls through to branch 5 and gets told to
    // provision a wildcard it neither needs nor can use.
    const proxyMode: string | undefined = cfg.proxyMode;
    const sslMode: string | undefined = cfg.sslMode;
    if (
      proxyMode === 'cloudflare' ||
      proxyMode === 'proxy' ||
      proxyMode === 'cloudflare-tunnel' ||
      sslMode === 'selfsigned' ||
      sslMode === 'external'
    ) {
      return { model: 'edge-terminated', action: 'none-needed' };
    }

    // 5. Direct serving, no wildcard: nginx terminates TLS here, and nothing
    // covers this app's subdomain. A per-app certificate is NOT an option —
    // `DomainsService.create` only enables SSL on a subdomain when a wildcard
    // exists, and `NginxConfigService.getSslCertPath` resolves any subdomain
    // of the primary domain to the wildcard file — so the app's vhost cannot
    // serve 443 until a wildcard is provisioned. Report it honestly instead of
    // re-issuing the primary certificate for a result that never lands
    // (ce#584).
    return { model: 'direct-no-wildcard', action: 'report' };
  }

  /**
   * Which scheme an app's own URL should use — the "Open" link on the catalog
   * card and the install job's `appUrl`.
   *
   * `sslEnabled` on the domain row only says whether THIS origin's nginx
   * terminates TLS for the host. It is deliberately false on every
   * edge-terminated deployment (Cloudflare, another proxy, platform mode),
   * where the origin vhost is plain HTTP but the public URL is still HTTPS —
   * so the row alone cannot decide the scheme. Reuse the same serving-model
   * branches `plan()` walks: only a direct-serving instance with no
   * certificate covering the host is genuinely HTTP-only (ce#584).
   *
   * `unknown` (legacy compose install with no bootstrap config) stays HTTPS:
   * we cannot reason about that serving model, and assuming HTTP there would
   * downgrade links that work today.
   */
  async schemeFor(appHost: string, domainSslEnabled: boolean): Promise<'http' | 'https'> {
    if (domainSslEnabled) return 'https';
    const plan = await this.plan(appHost);
    return plan.model === 'direct-no-wildcard' ? 'http' : 'https';
  }

  async execute(plan: CertPlan, appHost: string): Promise<AppCertStepResult> {
    switch (plan.model) {
      case 'platform':
        return {
          status: 'skipped',
          detail: 'SSL is managed by the platform edge; no certificate action needed for this app.',
        };
      case 'wildcard':
        return {
          status: 'done',
          detail: `The existing wildcard certificate already covers ${appHost}.`,
        };
      case 'edge-terminated':
        return {
          status: 'skipped',
          detail:
            'TLS for this host is terminated at the edge/proxy (or served self-signed); no certificate action needed.',
        };
      case 'unknown':
        return {
          status: 'skipped',
          detail:
            "Could not determine this instance's SSL configuration (no managed instance config found); " +
            'skipping the automatic certificate step. Verify SSL for this app manually.',
        };
      case 'direct-no-wildcard':
        return {
          status: 'action-required',
          detail:
            `${appHost} is served over HTTP: this instance terminates TLS itself and no wildcard ` +
            'certificate covers it yet. The app works meanwhile; HTTPS needs a wildcard.',
          manualStep: {
            id: 'provision-wildcard-cert',
            title: 'Turn on HTTPS for this app',
            body:
              'Your app is live, over HTTP. Provision a wildcard certificate on the Domains ' +
              'page and it switches to HTTPS on its own.',
            deepLink: '/domains',
            appliesWhen: 'selfHosted',
          },
        };
    }
  }

}
