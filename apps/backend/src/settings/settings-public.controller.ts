import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { EmailService } from '../email/email.service';
import { BrandingService, PublicBrandingConfig } from './branding.service';

/**
 * Response DTO for email status check
 */
export class EmailConfigStatusDto {
  isConfigured: boolean;
}

/**
 * Public Settings Controller
 *
 * Provides public (unauthenticated) endpoints for settings that don't expose sensitive data.
 * Used by the frontend to check feature availability before rendering forms.
 */
@ApiTags('Settings')
@Controller('api/settings')
export class SettingsPublicController {
  constructor(
    private readonly emailService: EmailService,
    private readonly brandingService: BrandingService,
  ) {}

  @Get('email/status-public')
  @ApiOperation({
    summary: 'Check if email service is configured (public)',
    description:
      'Returns whether the email service is configured. Used to show/hide email-dependent features.',
  })
  @ApiResponse({
    status: 200,
    description: 'Email configuration status',
    type: EmailConfigStatusDto,
  })
  async getEmailStatusPublic(): Promise<EmailConfigStatusDto> {
    return {
      isConfigured: this.emailService.isConfigured(),
    };
  }

  @Get('branding/public')
  @ApiOperation({
    summary: 'Get public branding configuration',
    description:
      'Returns site name and whether custom logos are set. Used by auth pages and header.',
  })
  @ApiResponse({ status: 200, description: 'Public branding configuration' })
  async getPublicBranding(): Promise<PublicBrandingConfig> {
    return this.brandingService.getPublicBranding();
  }

  @Get('branding/logo/:type')
  @ApiOperation({
    summary: 'Get branding logo image',
    description: 'Returns the logo image file for the specified type (header or auth).',
  })
  @ApiResponse({ status: 200, description: 'Logo image file' })
  @ApiResponse({ status: 404, description: 'No custom logo set' })
  async getLogoImage(@Param('type') type: string, @Res() res: Response): Promise<void> {
    const result = await this.brandingService.getLogoBuffer(type);
    if (!result) {
      throw new NotFoundException('No custom logo set for this type');
    }

    res.set({
      'Content-Type': result.mimeType,
      'Cache-Control': 'public, max-age=3600',
    });
    res.send(result.buffer);
  }
}
