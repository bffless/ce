import {
  BadRequestException,
  Body,
  Controller,
  InternalServerErrorException,
  Logger,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BootstrapSetupService } from './bootstrap-setup.service';
import { BootstrapDnsPreflightService, PreflightResult } from './bootstrap-dns-preflight.service';
import { SslCertificateService } from '../domains/ssl-certificate.service';
import { writeInstanceConfig } from '../bootstrap/instance-config';
import { discardStagedCertificates, promoteStagedCertificates, stagingPartiallyPopulated } from './ssl-staging';
import { ApplyBootstrapDto, BootstrapDomainActionDto, UploadCertificatesDto } from './setup.dto';

@ApiTags('Setup')
@Controller('api/setup')
export class BootstrapSetupController {
  private readonly logger = new Logger(BootstrapSetupController.name);

  constructor(
    private readonly bootstrap: BootstrapSetupService,
    private readonly preflight: BootstrapDnsPreflightService,
    private readonly sslCert: SslCertificateService,
  ) {}

  // Overridable in tests (assigned as an own property on the instance, which
  // shadows this prototype method — see the controller spec). Exit lets
  // Docker's restart policy revive the backend, which re-runs main.ts
  // hydration and adopts the new identity. There is no docker socket here,
  // so a file write + process exit is the only way to "apply" the change.
  private scheduleExit(): void {
    setTimeout(() => {
      this.logger.log('[bootstrap] apply complete — exiting for identity restart');
      process.exit(0);
    }, 500).unref();
  }

  @Post('certificates')
  @ApiOperation({ summary: 'Validate and install SSL certificate pair (bootstrap mode)' })
  async uploadCertificates(
    @Body() dto: UploadCertificatesDto,
  ): Promise<{ saved: true; sans: string[]; wildcardCovered: boolean }> {
    // Must be awaited: assertBootstrapAllowed is async (it calls the async
    // FeatureFlagsService.isEnabled). Awaiting first, before any validation
    // or file work, ensures a platform-managed/flag-disabled deployment is
    // refused without doing any of that work.
    await this.bootstrap.assertBootstrapAllowed();
    // Auth: the setup wizard is anonymous/session-less, so these endpoints
    // are claim-token-gated (the same rate-limited token that gates admin
    // creation), not admin-session-guarded. Runs after the mode gate, before
    // any cert parsing or disk writes.
    this.bootstrap.validateClaimToken(dto.token);
    const { sans, wildcardCovered } = this.bootstrap.validateCertificatePair(
      dto.certificatePem,
      dto.privateKeyPem,
      dto.domain,
      dto.servingMode,
    );
    this.bootstrap.saveCertificates(dto.certificatePem, dto.privateKeyPem, dto.domain);
    return { saved: true, sans, wildcardCovered };
  }

  @Post('apply')
  @ApiOperation({ summary: 'Apply domain identity and restart into HTTPS mode (bootstrap mode)' })
  async apply(@Body() dto: ApplyBootstrapDto): Promise<{ applying: true; adminUrl: string }> {
    // Same ordering as uploadCertificates: mode gate first, then the
    // claim-token auth gate, before the certificate presence check or any
    // filesystem/response work.
    await this.bootstrap.assertBootstrapAllowed();
    this.bootstrap.validateClaimToken(dto.token);
    // Self-signed keeps serving the built-in bootstrap cert (behind a
    // TLS-terminating proxy) — there is deliberately no staged fullchain to
    // check. Every other mode stages a real cert (paste) or has one issued
    // (letsencrypt, via issue-certificate) before apply.
    if (dto.sslMode !== 'selfsigned') {
      // A torn stage (only one of fullchain.pem/privkey.pem present) must
      // fail loudly rather than silently no-op-ing through promote — see
      // stagingPartiallyPopulated's doc comment.
      if (stagingPartiallyPopulated()) {
        throw new BadRequestException('Staged certificate is incomplete — discard it and stage again');
      }
      if (!this.bootstrap.certificatesPresent(dto.domain)) {
        throw new BadRequestException('Install certificates before applying');
      }
      // certificatesPresent only proves the four files exist; a later upload
      // for a different domain overwrites the generic fullchain.pem/privkey.pem
      // pair that nginx's apex/admin vhosts serve, while this domain's stale
      // wildcard.* files stick around. Re-verify the staged fullchain actually
      // covers the domain being applied — see assertStagedCertificateCovers.
      this.bootstrap.assertStagedCertificateCovers(dto.domain, dto.proxyMode);
    }
    // writeInstanceConfig is called directly by this controller (it isn't
    // reached through validateCertificatePair/saveCertificates/
    // certificatesPresent, which validate the domain as a side effect of
    // their real job). Explicitly validate + normalize here so the domain
    // written into instance.env (sourced as shell by the nginx render
    // script) and echoed into the adminUrl response can never carry
    // anything other than a plausible, lowercased hostname.
    const domain = this.bootstrap.validateDomain(dto.domain);
    // Combo validation + knob resolution (proxyMode/sslMode/port80/realIp) —
    // throws BadRequestException on any illegal combination before anything
    // is written or the process is marked for restart.
    const applied = this.bootstrap.validateApplyConfig(dto);
    // #514: certs staged by uploadCertificates / issue-certificate go live
    // here — after every validation gate, before the instance write whose
    // watcher-triggered render flips SSL_MODE and starts serving them.
    if (applied.sslMode === 'selfsigned') {
      discardStagedCertificates();
    } else {
      promoteStagedCertificates();
    }
    // Mark setup complete BEFORE writing instance.json + exiting: apply is the
    // bootstrap flow's terminal step, so the restarted backend should land the
    // user at login, not back in the normal-mode wizard. Must persist before
    // the process exit below (awaited here, exit is a deferred timer).
    await this.bootstrap.finalizeSetup();
    try {
      writeInstanceConfig({
        version: 2,
        state: 'applied',
        origin: 'wizard',
        primaryDomain: domain,
        proxyMode: applied.proxyMode,
        sslMode: applied.sslMode,
        port80: applied.port80,
        realIp: applied.realIp,
      });
    } catch (err) {
      // Failed fs write with setup already finalized = permanently dead
      // wizard AND no identity (M3). Put the wizard back so Apply can be
      // retried from the browser once the underlying problem (disk space,
      // mount perms) is fixed.
      await this.bootstrap.unfinalizeSetup();
      this.logger.error(`[bootstrap] apply failed writing instance config: ${(err as Error).message}`);
      throw new InternalServerErrorException(
        'Could not write the instance configuration to disk (check free disk space). Setup was NOT completed — fix the disk issue and retry Apply.',
      );
    }
    this.scheduleExit();
    return { applying: true, adminUrl: `https://admin.${domain}` };
  }

  @Post('dns-preflight')
  @ApiOperation({ summary: 'Check DNS + port-80 reachability for the LE path (bootstrap mode)' })
  async dnsPreflight(@Body() dto: BootstrapDomainActionDto): Promise<PreflightResult> {
    await this.bootstrap.assertBootstrapAllowed();
    this.bootstrap.validateClaimToken(dto.token);
    const domain = this.bootstrap.validateDomain(dto.domain);
    return this.preflight.run(domain);
  }

  @Post('issue-certificate')
  @ApiOperation({ summary: "Issue the primary-domain Let's Encrypt certificate (bootstrap mode)" })
  async issueCertificate(
    @Body() dto: BootstrapDomainActionDto,
  ): Promise<{ issued: true; sans: string[] }> {
    await this.bootstrap.assertBootstrapAllowed();
    this.bootstrap.validateClaimToken(dto.token);
    const domain = this.bootstrap.validateDomain(dto.domain);
    // Server-side re-check — the client's claim that preflight passed is
    // advisory only. Cheap (one token write + three HTTP GETs) relative to
    // burning an LE validation failure.
    const check = await this.preflight.run(domain);
    if (!check.ok) {
      throw new BadRequestException(
        'DNS preflight failed — the domain does not route to this server yet',
      );
    }
    await this.sslCert.initialize();
    const result = await this.sslCert.requestPrimaryDomainCertificate(domain, { target: 'staging' });
    if (!result.success) {
      throw new BadRequestException(`Certificate issuance failed: ${result.error}`);
    }
    return { issued: true, sans: result.sans ?? [] };
  }

  @Post('wildcard/start')
  @ApiOperation({ summary: 'Start the optional DNS-01 wildcard (bootstrap mode)' })
  async wildcardStart(
    @Body() dto: BootstrapDomainActionDto,
  ): Promise<{ recordName: string; recordValues: string[]; expiresAt: string }> {
    await this.bootstrap.assertBootstrapAllowed();
    this.bootstrap.validateClaimToken(dto.token);
    const domain = this.bootstrap.validateDomain(dto.domain);
    await this.sslCert.initialize();
    const challenge = await this.sslCert.startWildcardCertificateRequest(domain);
    return {
      recordName: challenge.recordName,
      recordValues: challenge.recordValues,
      expiresAt: challenge.expiresAt.toISOString(),
    };
  }

  @Post('wildcard/complete')
  @ApiOperation({ summary: 'Verify TXT records and issue the wildcard (bootstrap mode)' })
  async wildcardComplete(
    @Body() dto: BootstrapDomainActionDto,
  ): Promise<{ success: boolean; error?: string }> {
    await this.bootstrap.assertBootstrapAllowed();
    this.bootstrap.validateClaimToken(dto.token);
    const domain = this.bootstrap.validateDomain(dto.domain);
    await this.sslCert.initialize();
    const result = await this.sslCert.completeWildcardCertificateRequest(domain);
    return { success: result.success, error: result.error };
  }
}
