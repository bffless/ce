import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { BootstrapSetupService } from '../bootstrap-setup.service';
import { SslCertificateService } from '../../domains/ssl-certificate.service';
import { BootstrapDnsPreflightService, PreflightResult } from '../bootstrap-dns-preflight.service';
import { SslInfoService, SslCertificateInfo } from '../../domains/ssl-info.service';
import { PrimarySslSnapshotService } from './primary-ssl-snapshot.service';
import { loadInstanceConfig, ProxyMode } from '../../bootstrap/instance-config';
import { PrimarySslPasteDto } from './primary-ssl.dto';

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
    const cert = await this.info.getWildcardCertInfo().catch(() => null);
    const pending = this.snap.readPendingRevert();
    return {
      domain: cfg?.primaryDomain ?? null,
      proxyMode: cfg?.proxyMode ?? null,
      sslMode: cfg?.sslMode ?? null,
      port80: cfg?.port80 ?? null,
      realIp: cfg?.realIp ?? null,
      cert,
      wildcardCovered: !!cert,
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
    const result = this.bootstrap.validateCertificatePair(
      dto.certificatePem, dto.privateKeyPem, domain, dto.servingMode as ProxyMode,
    );
    this.bootstrap.saveCertificates(dto.certificatePem, dto.privateKeyPem, domain);
    return result;
  }
}
