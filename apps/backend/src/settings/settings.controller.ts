import {
  Controller,
  Get,
  Patch,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes } from '@nestjs/swagger';
import Multitenancy from 'supertokens-node/recipe/multitenancy';
import { PrimaryContentService, PrimaryContentConfig } from './primary-content.service';
import { SmtpService } from './smtp.service';
import { EmailSettingsService } from './email-settings.service';
import { GoogleIntegrationCredentialsService } from './google-integration-credentials.service';
import { GOOGLE_SERVICES, type GoogleService } from '../db/schema/google-integration-credentials.schema';
import {
  OidcProvidersService,
  type CreateOidcProviderInput,
  type UpdateOidcProviderInput,
} from './oidc-providers.service';
import { BrandingService, BrandingConfig } from './branding.service';
import { TelemetrySettingsService, TelemetryStatus } from './telemetry-settings.service';
import { syncOidcProviders } from '../auth/supertokens.config';
import { UpdatePrimaryContentDto } from './dto/update-primary-content.dto';
import { UpdateSmtpDto, SmtpStatusResponseDto, TestSmtpResponseDto } from './dto/update-smtp.dto';
import {
  UpdateEmailSettingsDto,
  EmailStatusResponseDto,
  TestEmailResponseDto,
  SendTestEmailDto,
  SendTestEmailResponseDto,
} from './dto/email-settings.dto';
import { ApiKeyGuard, RolesGuard, Roles, CurrentUser } from '../auth';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

@ApiTags('Settings')
@Controller('api/settings')
@UseGuards(ApiKeyGuard, RolesGuard)
export class SettingsController {
  private readonly logger = new Logger(SettingsController.name);

  constructor(
    private readonly primaryContentService: PrimaryContentService,
    private readonly smtpService: SmtpService,
    private readonly emailSettingsService: EmailSettingsService,
    private readonly googleIntegrationCredentials: GoogleIntegrationCredentialsService,
    private readonly oidcProvidersService: OidcProvidersService,
    private readonly brandingService: BrandingService,
    private readonly featureFlagsService: FeatureFlagsService,
    private readonly telemetrySettingsService: TelemetrySettingsService,
  ) {}

  private getTenantId(): string {
    const isMultiTenant = process.env.SUPERTOKENS_MULTI_TENANT === 'true';
    return isMultiTenant
      ? process.env.ORGANIZATION_ID || process.env.TENANT_ID || 'public'
      : 'public';
  }

  @Get('primary-content')
  @ApiOperation({ summary: 'Get primary content configuration' })
  @ApiResponse({ status: 200, description: 'Primary content configuration' })
  async getPrimaryContent(): Promise<PrimaryContentConfig> {
    return this.primaryContentService.getConfig();
  }

  @Patch('primary-content')
  @Roles('admin') // Only admins can modify primary content
  @ApiOperation({ summary: 'Update primary content configuration' })
  @ApiResponse({ status: 200, description: 'Updated primary content configuration' })
  async updatePrimaryContent(
    @Body() dto: UpdatePrimaryContentDto,
    @CurrentUser('id') userId: string,
  ): Promise<{ success: boolean; config: PrimaryContentConfig; message: string }> {
    const config = await this.primaryContentService.updateConfig(dto, userId);
    return {
      success: true,
      config,
      message: 'Primary content updated. Changes will apply within 5 seconds.',
    };
  }

  @Get('primary-content/projects')
  @ApiOperation({ summary: 'List projects available for primary content' })
  @ApiResponse({ status: 200, description: 'Available projects with aliases' })
  async getPrimaryContentProjects() {
    return {
      projects: await this.primaryContentService.getAvailableProjects(),
    };
  }

  // SMTP Settings Endpoints

  @Get('smtp')
  @Roles('admin')
  @ApiOperation({ summary: 'Get SMTP configuration status' })
  @ApiResponse({
    status: 200,
    description: 'SMTP configuration status',
    type: SmtpStatusResponseDto,
  })
  async getSmtpStatus(): Promise<SmtpStatusResponseDto> {
    return this.smtpService.getSmtpStatus();
  }

  @Patch('smtp')
  @Roles('admin')
  @ApiOperation({ summary: 'Update SMTP configuration' })
  @ApiResponse({
    status: 200,
    description: 'Updated SMTP configuration',
    type: SmtpStatusResponseDto,
  })
  async updateSmtp(@Body() dto: UpdateSmtpDto): Promise<SmtpStatusResponseDto> {
    return this.smtpService.updateSmtp(dto);
  }

  @Post('smtp/test')
  @Roles('admin')
  @ApiOperation({ summary: 'Test SMTP connection' })
  @ApiResponse({ status: 200, description: 'SMTP test result', type: TestSmtpResponseDto })
  async testSmtp(): Promise<TestSmtpResponseDto> {
    return this.smtpService.testSmtpConnection();
  }

  // ==========================================================================
  // Email Settings Endpoints (New - Multi-Provider Support)
  // ==========================================================================

  @Get('email')
  @Roles('admin')
  @ApiOperation({ summary: 'Get email configuration status (multi-provider)' })
  @ApiResponse({
    status: 200,
    description: 'Email configuration status',
    type: EmailStatusResponseDto,
  })
  async getEmailStatus(): Promise<EmailStatusResponseDto> {
    return this.emailSettingsService.getEmailStatus();
  }

  @Patch('email')
  @Roles('admin')
  @ApiOperation({ summary: 'Update email provider configuration' })
  @ApiResponse({
    status: 200,
    description: 'Updated email configuration',
    type: EmailStatusResponseDto,
  })
  async updateEmail(@Body() dto: UpdateEmailSettingsDto): Promise<EmailStatusResponseDto> {
    return this.emailSettingsService.updateEmail({
      provider: dto.provider,
      config: dto.config,
    });
  }

  @Delete('email')
  @Roles('admin')
  @ApiOperation({
    summary: 'Clear email provider configuration',
    description:
      'Removes the configured email provider so password reset and verification links fall back to console logging.',
  })
  @ApiResponse({
    status: 200,
    description: 'Updated (unconfigured) email status',
    type: EmailStatusResponseDto,
  })
  async clearEmail(): Promise<EmailStatusResponseDto> {
    return this.emailSettingsService.clearEmail();
  }

  @Post('email/test')
  @Roles('admin')
  @ApiOperation({ summary: 'Test email connection' })
  @ApiResponse({ status: 200, description: 'Email test result', type: TestEmailResponseDto })
  async testEmail(): Promise<TestEmailResponseDto> {
    return this.emailSettingsService.testEmailConnection();
  }

  @Post('email/send-test')
  @Roles('admin')
  @ApiOperation({ summary: 'Send a test email to verify delivery' })
  @ApiResponse({
    status: 200,
    description: 'Test email send result',
    type: SendTestEmailResponseDto,
  })
  async sendTestEmail(@Body() dto: SendTestEmailDto): Promise<SendTestEmailResponseDto> {
    return this.emailSettingsService.sendTestEmail(dto.to);
  }

  // ==========================================================================
  // Branding Settings Endpoints
  // ==========================================================================

  @Get('branding')
  @Roles('admin')
  @ApiOperation({ summary: 'Get branding configuration' })
  @ApiResponse({ status: 200, description: 'Branding configuration' })
  async getBranding(): Promise<BrandingConfig> {
    return this.brandingService.getBrandingConfig();
  }

  @Patch('branding')
  @Roles('admin')
  @ApiOperation({ summary: 'Update branding configuration' })
  @ApiResponse({ status: 200, description: 'Updated branding configuration' })
  async updateBranding(
    @Body() dto: { siteName?: string },
  ): Promise<{ success: boolean; config: BrandingConfig }> {
    const config = await this.brandingService.updateBranding(dto);
    return { success: true, config };
  }

  @Post('branding/logo/:type')
  @Roles('admin')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a branding logo (header or auth)' })
  @ApiResponse({ status: 200, description: 'Logo uploaded successfully' })
  async uploadLogo(
    @Param('type') type: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ success: boolean; config: BrandingConfig }> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    const config = await this.brandingService.uploadLogo(type, file.buffer, file.mimetype);
    return { success: true, config };
  }

  @Delete('branding/logo/:type')
  @Roles('admin')
  @ApiOperation({ summary: 'Delete a branding logo' })
  @ApiResponse({ status: 200, description: 'Logo deleted successfully' })
  async deleteLogo(
    @Param('type') type: string,
  ): Promise<{ success: boolean; config: BrandingConfig }> {
    const config = await this.brandingService.deleteLogo(type);
    return { success: true, config };
  }

  // ==========================================================================
  // Install Telemetry Settings
  // ==========================================================================

  @Get('telemetry')
  @Roles('admin')
  @ApiOperation({ summary: 'Get install telemetry status' })
  @ApiResponse({ status: 200, description: 'Telemetry status' })
  async getTelemetry(): Promise<TelemetryStatus> {
    return this.telemetrySettingsService.getStatus();
  }

  @Patch('telemetry')
  @Roles('admin')
  @ApiOperation({ summary: 'Enable or disable install telemetry' })
  @ApiResponse({ status: 200, description: 'Updated telemetry status' })
  async updateTelemetry(@Body() dto: { enabled: boolean }): Promise<TelemetryStatus> {
    return this.telemetrySettingsService.setEnabled(dto.enabled === true);
  }

  // ==========================================================================
  // OAuth Settings Endpoints
  // ==========================================================================

  @Get('oauth')
  @Roles('admin')
  @ApiOperation({ summary: 'Get OAuth provider configuration' })
  @ApiResponse({ status: 200, description: 'OAuth configuration status' })
  async getOAuthSettings(): Promise<{
    google: { enabled: boolean; configured: boolean };
  }> {
    const tenantId = this.getTenantId();
    let googleConfigured = false;
    let googleEnabled = false;

    try {
      const tenantInfo = await Multitenancy.getTenant(tenantId);
      if (tenantInfo) {
        const googleConfig = tenantInfo.thirdParty?.providers?.find(
          (p: { thirdPartyId: string }) => p.thirdPartyId === 'google',
        );
        googleConfigured = !!googleConfig;
      }
    } catch (error) {
      this.logger.error('[OAuth Settings] Failed to get tenant info:', error);
    }

    // Google OAuth is enabled if credentials are configured at the platform level
    // AND this workspace hasn't disabled OIDC sign-in via the master flag.
    if (googleConfigured) {
      googleEnabled = await this.featureFlagsService.isEnabled('ENABLE_OIDC_PROVIDERS');
    }

    return {
      google: { enabled: googleEnabled, configured: googleConfigured },
    };
  }

  @Patch('oauth/google')
  @Roles('admin')
  @ApiOperation({ summary: 'Enable or disable Google OAuth for this workspace' })
  @ApiResponse({ status: 200, description: 'Google OAuth setting updated' })
  async updateGoogleOAuth(
    @Body() body: { enabled: boolean },
  ): Promise<{ success: boolean; google: { enabled: boolean } }> {
    // When enabling, verify that Google OAuth credentials are actually configured
    if (body.enabled) {
      const tenantId = this.getTenantId();
      let googleConfigured = false;
      try {
        const tenantInfo = await Multitenancy.getTenant(tenantId);
        if (tenantInfo) {
          const googleConfig = tenantInfo.thirdParty?.providers?.find(
            (p: { thirdPartyId: string }) => p.thirdPartyId === 'google',
          );
          googleConfigured = !!googleConfig;
        }
      } catch (error) {
        this.logger.error('[OAuth Settings] Failed to check Google config:', error);
      }

      if (!googleConfigured) {
        throw new BadRequestException(
          'Cannot enable Google OAuth: credentials are not configured. ' +
          'Google OAuth credentials must be configured at the platform level in SuperTokens.',
        );
      }
    }

    // Only toggle the OIDC master flag — credentials are managed at the platform level
    // and per-provider toggles live on oidc_providers.enabled.
    await this.featureFlagsService.setFlag('ENABLE_OIDC_PROVIDERS', body.enabled);

    return {
      success: true,
      google: { enabled: body.enabled },
    };
  }

  // ─── Google integration credentials (per-service) ─────────────────────────
  // Distinct from the SIGN-IN endpoints above — these manage the workspace's
  // Google OAuth client used by Calendar (and future Drive/Sheets/Gmail).
  // Sign-in keeps using env-var credentials shared across all workspaces;
  // integration credentials are workspace-distinct, one row per service.
  // Project owners use the workspace admin's OAuth client to connect their
  // own calendars — per-project refresh tokens live in
  // `projects.settings.integrations['google-calendar'][env]` and don't
  // touch these endpoints.

  @Get('google-integrations')
  @ApiOperation({
    summary: 'List Google integration credential status for every known service',
    description:
      'Returns one entry per Google API surface (calendar today; drive/sheets/gmail when their handlers ship). Readable by any authenticated user so the per-project Connect dialog can render the right CTA. PUT/DELETE stay admin-gated.',
  })
  @ApiResponse({ status: 200, description: 'Per-service status list' })
  async listGoogleIntegrations() {
    return this.googleIntegrationCredentials.listStatuses(GOOGLE_SERVICES);
  }

  @Get('google-integrations/:service')
  @ApiOperation({ summary: 'Get integration credential status for one service' })
  @ApiResponse({ status: 200, description: 'Status (secret never returned)' })
  async getGoogleIntegration(@Param('service') service: string) {
    return this.googleIntegrationCredentials.getStatus(this.assertGoogleService(service));
  }

  @Put('google-integrations/:service')
  @Roles('admin')
  @ApiOperation({ summary: 'Save Google integration credentials for one service' })
  @ApiResponse({ status: 200, description: 'Credentials saved' })
  async updateGoogleIntegration(
    @Param('service') service: string,
    @Body() body: { clientId: string; clientSecret: string; scopes?: string[] },
    @CurrentUser() user: { id: string },
  ) {
    const svc = this.assertGoogleService(service);
    await this.googleIntegrationCredentials.update(
      svc,
      {
        clientId: body.clientId,
        clientSecret: body.clientSecret,
        scopes: body.scopes,
      },
      user.id,
    );
    return this.googleIntegrationCredentials.getStatus(svc);
  }

  @Delete('google-integrations/:service')
  @Roles('admin')
  @ApiOperation({ summary: 'Clear Google integration credentials for one service' })
  @ApiResponse({ status: 200, description: 'Credentials cleared' })
  async deleteGoogleIntegration(@Param('service') service: string) {
    const svc = this.assertGoogleService(service);
    await this.googleIntegrationCredentials.clear(svc);
    return this.googleIntegrationCredentials.getStatus(svc);
  }

  private assertGoogleService(raw: string): GoogleService {
    if (!(GOOGLE_SERVICES as readonly string[]).includes(raw)) {
      throw new BadRequestException(
        `Unknown Google service '${raw}'. Expected one of: ${GOOGLE_SERVICES.join(', ')}.`,
      );
    }
    return raw as GoogleService;
  }

  // ─── Single Sign-On (OIDC) providers ──────────────────────────────────────
  // CRUD over the `oidc_providers` table that drives /api/auth/oauth/...
  // endpoints. Mutations call syncOidcProviders() so changes apply without a
  // backend restart. Per [[feedback-supertokens-single-tenant]], all
  // providers are registered against the 'public' tenant.

  @Get('sso/providers')
  @Roles('admin')
  @ApiOperation({
    summary: 'List configured SSO providers',
    description: 'Returns all rows (enabled or not) with credentials masked.',
  })
  @ApiResponse({ status: 200, description: 'Configured providers' })
  async listSsoProviders() {
    return this.oidcProvidersService.listAll();
  }

  @Get('sso/providers/:id')
  @Roles('admin')
  @ApiOperation({ summary: 'Get one SSO provider by ID' })
  async getSsoProvider(@Param('id') id: string) {
    return this.oidcProvidersService.getStatus(id);
  }

  @Post('sso/providers')
  @Roles('admin')
  @ApiOperation({
    summary: 'Create a new SSO provider',
    description:
      'Body: { providerId (URL slug), displayName, kind: "google"|"okta"|"azure-ad"|"oidc", config: {...kind-specific...}, enabled? }',
  })
  @ApiResponse({ status: 201, description: 'Provider created' })
  @ApiResponse({ status: 400, description: 'Invalid input (missing fields, bad slug, kind/config mismatch)' })
  @ApiResponse({ status: 409, description: 'A provider with that providerId already exists' })
  async createSsoProvider(
    @Body() body: CreateOidcProviderInput,
    @CurrentUser() user: { id: string },
  ) {
    const created = await this.oidcProvidersService.create({
      ...body,
      createdByUserId: user?.id,
      source: 'admin',
    });
    await syncOidcProviders();
    return created;
  }

  @Patch('sso/providers/:id')
  @Roles('admin')
  @ApiOperation({
    summary: 'Update an SSO provider',
    description:
      'Partial update. Omit clientSecret to keep the existing one. Toggle `enabled` to enable/disable without deleting.',
  })
  async updateSsoProvider(@Param('id') id: string, @Body() body: UpdateOidcProviderInput) {
    const updated = await this.oidcProvidersService.update(id, body);
    await syncOidcProviders();
    return updated;
  }

  @Delete('sso/providers/:id')
  @Roles('admin')
  @ApiOperation({
    summary: 'Delete an SSO provider',
    description:
      'Refuses to delete env-sourced rows (source=env) — unset the env vars and restart instead.',
  })
  @ApiResponse({ status: 409, description: 'Provider is env-sourced; cannot be deleted via API' })
  async deleteSsoProvider(@Param('id') id: string) {
    await this.oidcProvidersService.delete(id);
    await syncOidcProviders();
    return { success: true };
  }

  @Post('sso/providers/:id/test')
  @Roles('admin')
  @ApiOperation({
    summary: 'Probe an OIDC provider\'s discovery endpoint',
    description:
      'For kind="oidc", fetches the configured discovery URL and reports back the issuer + authorization_endpoint. Pure read — no token issued. For other kinds (Google/Okta/Azure AD), returns ok=true if the row decrypts (no upstream call).',
  })
  async testSsoProvider(@Param('id') id: string): Promise<{ ok: boolean; issuer?: string; authorizationEndpoint?: string; error?: string }> {
    const row = await this.oidcProvidersService.findById(id);
    if (!row) throw new BadRequestException(`Provider ${id} not found`);
    const cfg = this.oidcProvidersService.decryptConfig(row);
    if (!cfg) {
      return { ok: false, error: 'Failed to decrypt credentials. Re-enter clientId / clientSecret.' };
    }
    if (row.kind !== 'oidc') {
      // Non-discovery kinds: we don't call out (Google/Okta/Azure don't use a
      // generic discovery URL in our config). Just confirm the row is intact.
      return { ok: true };
    }
    if (!cfg.oidcDiscoveryEndpoint) {
      return { ok: false, error: 'No oidcDiscoveryEndpoint configured.' };
    }
    try {
      const res = await fetch(cfg.oidcDiscoveryEndpoint, { redirect: 'follow' });
      if (!res.ok) {
        return { ok: false, error: `Discovery endpoint returned HTTP ${res.status}` };
      }
      const meta = (await res.json()) as { issuer?: string; authorization_endpoint?: string };
      return {
        ok: true,
        issuer: meta.issuer,
        authorizationEndpoint: meta.authorization_endpoint,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to reach discovery endpoint',
      };
    }
  }
}
