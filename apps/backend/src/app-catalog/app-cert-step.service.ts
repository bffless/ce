import { Injectable, Logger } from '@nestjs/common';
import { DomainsService } from '../domains/domains.service';
import { PrimarySslService } from '../setup/primary-ssl/primary-ssl.service';
import { loadInstanceConfig } from '../bootstrap/instance-config';
import type { AppManualStep } from './app-manifest.types';

export type CertPlan =
  | { model: 'platform'; action: 'delegated' }
  | { model: 'wildcard'; action: 'covered' }
  | { model: 'edge-terminated'; action: 'none-needed' } // proxyMode cloudflare/proxy, or sslMode selfsigned
  | { model: 'direct-le'; action: 'stage-san-reissue' }
  | { model: 'unknown'; action: 'report' };

export interface AppCertStepResult {
  status: 'done' | 'action-required' | 'skipped';
  detail: string;
  manualStep?: AppManualStep;
}

/**
 * AppCertStepService — Task 8 of the app-catalog spec. Decides how (or
 * whether) this instance's serving model already covers a newly-installed
 * app's host with TLS, and if not, stages a widened Let's Encrypt
 * certificate (never live, never auto-applied) plus a manual step for the
 * operator to review and confirm.
 *
 * A cert problem must NEVER fail the install — the app stays reachable over
 * the wildcard/existing certificate or plain HTTP in the meantime. Every
 * execute() branch degrades to `action-required`/`skipped`/`done`, never
 * throws.
 */
@Injectable()
export class AppCertStepService {
  private readonly logger = new Logger(AppCertStepService.name);

  constructor(
    private readonly domainsService: DomainsService,
    private readonly primarySslService: PrimarySslService,
  ) {}

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

    // 4. Edge (Cloudflare/reverse proxy) or self-signed serving: the
    // wildcard 443 block (or self-signed cert) already answers for
    // *.<primary>, so there's nothing to issue for this specific host.
    if (cfg.proxyMode === 'cloudflare' || cfg.proxyMode === 'proxy' || cfg.sslMode === 'selfsigned') {
      return { model: 'edge-terminated', action: 'none-needed' };
    }

    // 5. Direct serving + Let's Encrypt (proxyMode 'none' + sslMode
    // 'letsencrypt'): the primary cert's fixed SAN list doesn't cover this
    // app's subdomain — stage a widened re-issue.
    return { model: 'direct-le', action: 'stage-san-reissue' };
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
      case 'direct-le':
        return this.executeStageSanReissue(appHost);
    }
  }

  private async executeStageSanReissue(appHost: string): Promise<AppCertStepResult> {
    try {
      await this.primarySslService.issueLetsEncrypt({ extraSans: [appHost] });
      return {
        status: 'action-required',
        detail: `A new certificate including ${appHost} was issued and staged.`,
        manualStep: {
          id: 'apply-ssl-cert',
          title: 'Apply the updated certificate',
          body:
            `A new certificate including ${appHost} was issued and staged. Review and apply it, ` +
            'then confirm within the safety window.',
          deepLink: '/admin/settings/ssl',
          appliesWhen: 'selfHosted',
        },
      };
    } catch (error) {
      // Never fail the install for a cert problem — the app remains
      // reachable over the wildcard/existing certificate or plain HTTP
      // meanwhile. Degrade to a manual step naming both remediation routes.
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Automatic Let's Encrypt SAN re-issue for ${appHost} failed: ${message}`);
      return {
        status: 'action-required',
        detail: `Automatic certificate issuance for ${appHost} failed: ${message}.`,
        manualStep: {
          id: 'apply-ssl-cert',
          title: 'Add SSL coverage for this app manually',
          body:
            `Automatic certificate issuance for ${appHost} failed (${message}). The app remains reachable ` +
            'over the existing certificate/wildcard or plain HTTP meanwhile. Two ways to add coverage: ' +
            "(1) provision a wildcard certificate — it will automatically cover this subdomain once enabled " +
            'via "enable SSL for all subdomains"; or (2) go to Admin → Settings → SSL and re-issue ' +
            `the primary certificate, including ${appHost}.`,
          deepLink: '/admin/settings/ssl',
          appliesWhen: 'selfHosted',
        },
      };
    }
  }
}
