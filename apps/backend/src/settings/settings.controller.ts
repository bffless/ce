import { Controller, Get, Patch, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PrimaryContentService, PrimaryContentConfig } from './primary-content.service';
import { SmtpService } from './smtp.service';
import { EmailSettingsService } from './email-settings.service';
import { UpdatePrimaryContentDto } from './dto/update-primary-content.dto';
import { UpdateSmtpDto, SmtpStatusResponseDto, TestSmtpResponseDto } from './dto/update-smtp.dto';
import {
  UpdateEmailSettingsDto,
  EmailStatusResponseDto,
  TestEmailResponseDto,
  SendTestEmailDto,
  SendTestEmailResponseDto,
} from './dto/email-settings.dto';
import { SessionAuthGuard, RolesGuard, Roles, CurrentUser } from '../auth';

@ApiTags('Settings')
@Controller('api/settings')
@UseGuards(SessionAuthGuard, RolesGuard)
export class SettingsController {
  constructor(
    private readonly primaryContentService: PrimaryContentService,
    private readonly smtpService: SmtpService,
    private readonly emailSettingsService: EmailSettingsService,
  ) {}

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
}
