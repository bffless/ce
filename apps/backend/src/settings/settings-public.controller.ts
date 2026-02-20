import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { EmailService } from '../email/email.service';

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
  constructor(private readonly emailService: EmailService) {}

  @Get('email/status-public')
  @ApiOperation({
    summary: 'Check if email service is configured (public)',
    description: 'Returns whether the email service is configured. Used to show/hide email-dependent features.',
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
}
