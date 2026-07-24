import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { BootstrapSetupService } from '../bootstrap-setup.service';
import { SslCertificateService } from '../../domains/ssl-certificate.service';
import { BootstrapDnsPreflightService, PreflightResult } from '../bootstrap-dns-preflight.service';
import { SslInfoService, SslCertificateInfo } from '../../domains/ssl-info.service';
import { PrimarySslSnapshotService } from './primary-ssl-snapshot.service';
import { loadInstanceConfig, writeInstanceConfig, InstanceConfig, ProxyMode } from '../../bootstrap/instance-config';
import { PrimarySslPasteDto, PrimarySslApplyDto } from './primary-ssl.dto';
import {
  discardStagedCertificates,
  promoteStagedCertificates,
  stagingPopulated,
  stagingPartiallyPopulated,
} from '../ssl-staging';

export interface PrimarySslStatus {
  domain: string | null;
  proxyMode: string | null;
  sslMode: string | null;
  port80: string | null;
  realIp: unknown;
  cert: SslCertificateInfo | null;
  stagedCert: SslCertificateInfo | null;
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
    const stagedCert = await this.info.getStagedPrimaryCertInfo().catch(() => null);
    const wildcardCert = await this.info.getWildcardCertInfo().catch(() => null);
    const pending = this.snap.readPendingRevert();
    return {
      domain: cfg?.primaryDomain ?? null,
      proxyMode: cfg?.proxyMode ?? null,
      sslMode: cfg?.sslMode ?? null,
      port80: cfg?.port80 ?? null,
      realIp: cfg?.realIp ?? null,
      cert,
      stagedCert,
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
    // #514: saveCertificates writes into staging/ — nothing live changes, so
    // no snapshot is needed here. apply() snapshots before promoting.
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
    const pre = await this.preflightSvc.run(domain);
    if (!pre.ok) {
      throw new BadRequestException('DNS/port-80 preflight failed; not requesting a certificate');
    }
    const res = await this.ssl.requestPrimaryDomainCertificate(domain, { target: 'staging' });
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
    // A torn stage (only one of fullchain.pem/privkey.pem present — an
    // interrupted write or manual tampering) must fail loudly rather than
    // silently no-op: stagingPopulated() alone would just treat it as
    // "nothing staged" and quietly skip promotion.
    if (stagingPartiallyPopulated()) {
      throw new BadRequestException('Staged certificate is incomplete — discard it and stage again');
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
      origin: cur.origin,
      primaryDomain: cur.primaryDomain,
      proxyMode: applied.proxyMode,
      sslMode: applied.sslMode,
      port80: applied.port80,
      realIp: applied.realIp,
    };
    const serving = this.isReachabilityChange(cur, next);
    // A cert change is in flight iff files are staged. An sslMode switch also
    // changes the served cert (e.g. paste -> selfsigned) with nothing staged.
    const certAffecting = stagingPopulated() || cur.sslMode !== next.sslMode;
    // On direct serving (nginx terminates TLS) a bad cert breaks the browser
    // on admin.<domain> — the page hosting the rollback button — so cert
    // changes there get the same provisional confirm window as reachability
    // changes. Behind Cloudflare/proxy the origin cert isn't user-facing, so
    // those stay manual-rollback-only (ce#511).
    const needsConfirm = serving || (certAffecting && next.proxyMode === 'none');

    // Snapshot the live pre-change state, THEN promote staging over it — the
    // ordering is now structurally correct instead of call-order discipline.
    this.snap.snapshotForChangeCycle();
    if (applied.sslMode === 'selfsigned') {
      // Committing to self-signed abandons any staged cert: self-signed
      // serves the bootstrap pair regardless, and a lingering "staged"
      // indicator after this apply would mislead.
      discardStagedCertificates();
    } else {
      promoteStagedCertificates();
    }
    writeInstanceConfig(next); // watcher re-renders main.conf + reloads (~3s); no restart

    if (needsConfirm) {
      const deadlineMs = Date.now() + this.confirmTimeoutMs();
      this.snap.writePendingRevert({ deadlineMs, appliedAt: Date.now() });
      return { applied: true, kind: serving ? 'serving' : 'cert-only', deadlineMs };
    }
    // Committed without a confirm window: mark the snapshot applied so the
    // next change cycle re-baselines instead of rolling back past this change.
    // (Deliberate even for a no-op apply: the snapshot just taken of the
    // unchanged state keeps the manual rollback button working.)
    this.snap.markApplied();
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

  discardStaged(): { discarded: true } {
    this.assertEnabled();
    // Touches nothing live, so no pending-revert gate: discarding while a
    // revert is pending is harmless (staging was already cleared by apply).
    discardStagedCertificates();
    return { discarded: true };
  }
}
