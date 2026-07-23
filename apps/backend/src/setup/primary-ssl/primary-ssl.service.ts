import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { BootstrapSetupService } from '../bootstrap-setup.service';
import { SslCertificateService } from '../../domains/ssl-certificate.service';
import { BootstrapDnsPreflightService, PreflightResult } from '../bootstrap-dns-preflight.service';
import { SslInfoService, SslCertificateInfo } from '../../domains/ssl-info.service';
import { PrimarySslSnapshotService } from './primary-ssl-snapshot.service';
import { loadInstanceConfig, writeInstanceConfig, InstanceConfig, ProxyMode } from '../../bootstrap/instance-config';
import { PrimarySslPasteDto, PrimarySslApplyDto } from './primary-ssl.dto';

export interface PrimarySslStatus {
  domain: string | null;
  proxyMode: string | null;
  sslMode: string | null;
  port80: string | null;
  realIp: unknown;
  cert: SslCertificateInfo | null;
  wildcardCovered: boolean;
  pendingRevert: { deadlineMs: number } | null;
}

@Injectable()
export class PrimarySslService {
  constructor(
    private readonly bootstrap: BootstrapSetupService,
    private readonly ssl: SslCertificateService,
    private readonly preflightSvc: BootstrapDnsPreflightService,
    private readonly info: SslInfoService,
    private readonly snap: PrimarySslSnapshotService,
  ) {}

  assertEnabled(): void {
    if (process.env.PLATFORM_MODE === 'true' || process.env.SSL_MANAGED_EXTERNALLY === 'true') {
      throw new ForbiddenException('Primary SSL management is disabled when SSL is handled at the platform edge');
    }
  }

  private requireDomain(): string {
    const cfg = loadInstanceConfig();
    if (!cfg?.primaryDomain) {
      throw new BadRequestException('No primary domain is configured yet');
    }
    return cfg.primaryDomain;
  }

  async getStatus(): Promise<PrimarySslStatus> {
    this.assertEnabled();
    const cfg = loadInstanceConfig();
    // The card shows the cert nginx is actually SERVING, not whatever
    // wildcard.<domain>.crt happens to sit on disk (that file can be a
    // leftover from an earlier SSL mode). Wildcard coverage is reported
    // separately and independently below.
    const cert = await this.info.getServedPrimaryCertInfo().catch(() => null);
    const wildcardCert = await this.info.getWildcardCertInfo().catch(() => null);
    const pending = this.snap.readPendingRevert();
    return {
      domain: cfg?.primaryDomain ?? null,
      proxyMode: cfg?.proxyMode ?? null,
      sslMode: cfg?.sslMode ?? null,
      port80: cfg?.port80 ?? null,
      realIp: cfg?.realIp ?? null,
      cert,
      wildcardCovered: !!wildcardCert,
      pendingRevert: pending ? { deadlineMs: pending.deadlineMs } : null,
    };
  }

  async preflight(): Promise<PreflightResult> {
    this.assertEnabled();
    return this.preflightSvc.run(this.requireDomain());
  }

  stagePaste(dto: PrimarySslPasteDto): { sans: string[]; wildcardCovered: boolean } {
    this.assertEnabled();
    const domain = this.requireDomain();
    if (this.snap.readPendingRevert()) {
      throw new BadRequestException('A serving change is pending confirmation; confirm or roll it back first');
    }
    const result = this.bootstrap.validateCertificatePair(
      dto.certificatePem, dto.privateKeyPem, domain, dto.servingMode as ProxyMode,
    );
    // Capture the OLD live cert BEFORE saveCertificates overwrites it, so a later
    // rollback restores the pre-change cert (not the one we're about to write).
    this.snap.snapshotIfAbsent();
    this.bootstrap.saveCertificates(dto.certificatePem, dto.privateKeyPem, domain);
    return result;
  }

  private confirmTimeoutMs(): number {
    return Number(process.env.SSL_SERVING_CONFIRM_TIMEOUT_MS) || 300000;
  }

  isReachabilityChange(
    cur: Pick<InstanceConfig, 'proxyMode' | 'port80' | 'realIp'>,
    next: Pick<InstanceConfig, 'proxyMode' | 'port80' | 'realIp'>,
  ): boolean {
    return (
      cur.proxyMode !== next.proxyMode ||
      (cur.port80 ?? null) !== (next.port80 ?? null) ||
      JSON.stringify(cur.realIp ?? null) !== JSON.stringify(next.realIp ?? null)
    );
  }

  async issueLetsEncrypt(): Promise<{ issued: boolean; sans: string[]; reused: boolean }> {
    this.assertEnabled();
    const domain = this.requireDomain();
    if (this.snap.readPendingRevert()) {
      throw new BadRequestException('A serving change is pending confirmation; confirm or roll it back first');
    }
    // Capture the current live cert BEFORE issuance overwrites it, only if a
    // snapshot doesn't already exist this change cycle.
    this.snap.snapshotIfAbsent();
    const pre = await this.preflightSvc.run(domain);
    if (!pre.ok) {
      throw new BadRequestException('DNS/port-80 preflight failed; not requesting a certificate');
    }
    const res = await this.ssl.requestPrimaryDomainCertificate(domain);
    if (!res.success) {
      throw new BadRequestException(res.error || 'Certificate issuance failed');
    }
    return { issued: true, sans: res.sans ?? [], reused: res.reused ?? false };
  }

  async apply(dto: PrimarySslApplyDto): Promise<{ applied: true; kind: 'cert-only' | 'serving'; deadlineMs?: number }> {
    this.assertEnabled();
    if (this.snap.readPendingRevert()) {
      throw new BadRequestException('A serving change is pending confirmation; confirm or roll it back first');
    }
    const cur = loadInstanceConfig();
    if (!cur?.primaryDomain) throw new BadRequestException('No primary domain is configured yet');

    // validateApplyConfig expects the bootstrap ApplyBootstrapDto shape; supply the fixed domain.
    const applied = this.bootstrap.validateApplyConfig({ ...dto, domain: cur.primaryDomain } as any);

    // Every non-selfsigned mode must have staged certs present + covering the domain.
    if (applied.sslMode !== 'selfsigned') {
      if (!this.bootstrap.certificatesPresent(cur.primaryDomain)) {
        throw new BadRequestException('Install a certificate before applying');
      }
      this.bootstrap.assertStagedCertificateCovers(cur.primaryDomain, applied.proxyMode);
    }

    const next: InstanceConfig = {
      version: 2,
      state: 'applied',
      primaryDomain: cur.primaryDomain,
      proxyMode: applied.proxyMode,
      sslMode: applied.sslMode,
      port80: applied.port80,
      realIp: applied.realIp,
    };
    const serving = this.isReachabilityChange(cur, next);

    // Reuse the snapshot taken by a prior stage/issue (which holds the OLD cert).
    // For a pure serving change with no prior cert op, this snapshots the current
    // known-good state so a serving rollback can restore it.
    this.snap.snapshotIfAbsent();
    writeInstanceConfig(next); // watcher re-renders main.conf + reloads (~3s); no restart

    if (serving) {
      const deadlineMs = Date.now() + this.confirmTimeoutMs();
      this.snap.writePendingRevert({ deadlineMs, appliedAt: Date.now() });
      return { applied: true, kind: 'serving', deadlineMs };
    }
    return { applied: true, kind: 'cert-only' };
  }

  confirm(): void {
    this.assertEnabled();
    this.snap.clearPendingRevert();
    // A confirmed change is committed: drop the rollback baseline so a later
    // rollback cannot undo it.
    this.snap.clearSnapshot();
  }

  rollback(): void {
    this.assertEnabled();
    this.snap.clearPendingRevert();
    this.snap.restore();
  }
}
