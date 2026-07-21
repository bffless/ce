import { BadRequestException, Body, Controller, Logger, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BootstrapSetupService } from './bootstrap-setup.service';
import { writeInstanceConfig } from '../bootstrap/instance-config';
import { ApplyBootstrapDto, UploadCertificatesDto } from './setup.dto';

@ApiTags('Setup')
@Controller('api/setup')
export class BootstrapSetupController {
  private readonly logger = new Logger(BootstrapSetupController.name);

  constructor(private readonly bootstrap: BootstrapSetupService) {}

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
    if (!this.bootstrap.certificatesPresent(dto.domain)) {
      throw new BadRequestException('Install certificates before applying');
    }
    // certificatesPresent only proves the four files exist; a later upload
    // for a different domain overwrites the generic fullchain.pem/privkey.pem
    // pair that nginx's apex/admin vhosts serve, while this domain's stale
    // wildcard.* files stick around. Re-verify the staged fullchain actually
    // covers the domain being applied — see assertStagedCertificateCovers.
    this.bootstrap.assertStagedCertificateCovers(dto.domain, dto.proxyMode);
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
    // Mark setup complete BEFORE writing instance.json + exiting: apply is the
    // bootstrap flow's terminal step, so the restarted backend should land the
    // user at login, not back in the normal-mode wizard. Must persist before
    // the process exit below (awaited here, exit is a deferred timer).
    await this.bootstrap.finalizeSetup();
    writeInstanceConfig({
      version: 2,
      state: 'applied',
      primaryDomain: domain,
      proxyMode: applied.proxyMode,
      sslMode: applied.sslMode,
      port80: applied.port80,
      realIp: applied.realIp,
    });
    this.scheduleExit();
    return { applying: true, adminUrl: `https://admin.${domain}` };
  }
}
