import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Res,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes } from '@nestjs/swagger';
import { Response } from 'express';
import ThirdParty from 'supertokens-node/recipe/thirdparty';
import Multitenancy from 'supertokens-node/recipe/multitenancy';
import { PrimaryContentService, PrimaryContentConfig } from './primary-content.service';
import { SmtpService } from './smtp.service';
import { EmailSettingsService } from './email-settings.service';
import { BrandingService, BrandingConfig } from './branding.service';
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
    private readonly brandingService: BrandingService,
    private readonly featureFlagsService: FeatureFlagsService,
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
  // OAuth Settings Endpoints
  // ==========================================================================

  @Get('oauth')
  @Roles('admin')
  @ApiOperation({ summary: 'Get OAuth provider configuration' })
  @ApiResponse({ status: 200, description: 'OAuth configuration status' })
  async getOAuthSettings(): Promise<{
    google: { enabled: boolean; clientId?: string };
  }> {
    const tenantId = this.getTenantId();
    let googleEnabled = false;
    let googleClientId: string | undefined;

    try {
      const tenantInfo = await Multitenancy.getTenant(tenantId);
      if (tenantInfo) {
        const googleConfig = tenantInfo.thirdParty?.providers?.find(
          (p: { thirdPartyId: string }) => p.thirdPartyId === 'google',
        );
        if (googleConfig) {
          googleEnabled = true;
          googleClientId = googleConfig.clients?.[0]?.clientId;
        }
      }
    } catch (error) {
      this.logger.error('[OAuth Settings] Failed to get tenant info:', error);
    }

    return {
      google: { enabled: googleEnabled, clientId: googleClientId },
    };
  }

  @Patch('oauth/google')
  @Roles('admin')
  @ApiOperation({ summary: 'Configure or disable Google OAuth' })
  @ApiResponse({ status: 200, description: 'Google OAuth configuration updated' })
  async updateGoogleOAuth(
    @Body() body: { clientId?: string; clientSecret?: string; enabled?: boolean },
  ): Promise<{ success: boolean; google: { enabled: boolean; clientId?: string } }> {
    const tenantId = this.getTenantId();

    if (body.enabled === false) {
      // Disable Google OAuth
      try {
        await Multitenancy.deleteThirdPartyConfig(tenantId, 'google');
      } catch (error) {
        this.logger.warn('[OAuth Settings] Failed to delete Google config (may not exist):', error);
      }

      // Disable the feature flag
      await this.featureFlagsService.setFlag('ENABLE_GOOGLE_OAUTH', false);

      return { success: true, google: { enabled: false } };
    }

    // Enable/update Google OAuth
    if (!body.clientId || !body.clientSecret) {
      throw new BadRequestException('clientId and clientSecret are required to enable Google OAuth');
    }

    await Multitenancy.createOrUpdateThirdPartyConfig(tenantId, {
      thirdPartyId: 'google',
      clients: [
        {
          clientId: body.clientId,
          clientSecret: body.clientSecret,
        },
      ],
    });

    // Enable the feature flag
    await this.featureFlagsService.setFlag('ENABLE_GOOGLE_OAUTH', true);

    return {
      success: true,
      google: { enabled: true, clientId: body.clientId },
    };
  }

  @Post('oauth/google/test')
  @Roles('admin')
  @ApiOperation({ summary: 'Test Google OAuth configuration' })
  @ApiResponse({ status: 200, description: 'Google OAuth test result' })
  async testGoogleOAuth(): Promise<{ success: boolean; message: string }> {
    const tenantId = this.getTenantId();

    try {
      const provider = await ThirdParty.getProvider(tenantId, 'google', undefined);
      if (!provider) {
        return { success: false, message: 'Google OAuth provider is not configured' };
      }
      return { success: true, message: 'Google OAuth provider is configured and available' };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to validate Google OAuth configuration',
      };
    }
  }
}
