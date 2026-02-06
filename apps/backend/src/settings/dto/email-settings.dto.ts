import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsObject, IsEnum, IsEmail } from 'class-validator';

export enum EmailProviderEnum {
  SMTP = 'smtp',
  SENDGRID = 'sendgrid',
  RESEND = 'resend',
  SES = 'ses',
  MAILGUN = 'mailgun',
  POSTMARK = 'postmark',
}

export class UpdateEmailSettingsDto {
  @ApiProperty({
    description: 'Email provider type',
    enum: EmailProviderEnum,
    example: 'sendgrid',
  })
  @IsEnum(EmailProviderEnum)
  @IsNotEmpty()
  provider: EmailProviderEnum;

  @ApiProperty({
    description: 'Provider-specific configuration',
    example: { apiKey: 'SG.xxx', fromAddress: 'noreply@example.com' },
  })
  @IsObject()
  @IsNotEmpty()
  config: Record<string, unknown>;
}

export class EmailStatusResponseDto {
  @ApiProperty({ description: 'Whether email is configured', example: true })
  isConfigured: boolean;

  @ApiPropertyOptional({ description: 'Email provider ID', example: 'sendgrid' })
  provider?: string;

  @ApiPropertyOptional({ description: 'Provider display name', example: 'SendGrid' })
  providerName?: string;

  @ApiPropertyOptional({ description: 'From email address', example: 'noreply@example.com' })
  fromAddress?: string;

  @ApiPropertyOptional({ description: 'From display name', example: 'Asset Host' })
  fromName?: string;

  @ApiPropertyOptional({ description: 'Masked API key', example: 'SG.x...xxxx' })
  apiKey?: string;

  @ApiPropertyOptional({ description: 'SMTP host (for SMTP provider)', example: 'smtp.gmail.com' })
  host?: string;

  @ApiPropertyOptional({ description: 'SMTP port (for SMTP provider)', example: 587 })
  port?: number;

  @ApiPropertyOptional({ description: 'SMTP secure mode (for SMTP provider)', example: false })
  secure?: boolean;

  @ApiPropertyOptional({
    description: 'Masked SMTP user (for SMTP provider)',
    example: 'us***@example.com',
  })
  user?: string;
}

export class TestEmailResponseDto {
  @ApiProperty({ description: 'Whether the test was successful', example: true })
  success: boolean;

  @ApiProperty({ description: 'Test result message', example: 'Connection successful' })
  message: string;

  @ApiPropertyOptional({ description: 'Error message if failed' })
  error?: string;

  @ApiPropertyOptional({ description: 'Connection latency in ms', example: 150 })
  latencyMs?: number;
}

export class SendTestEmailDto {
  @ApiProperty({
    description: 'Email address to send test email to',
    example: 'user@example.com',
  })
  @IsEmail()
  @IsNotEmpty()
  to: string;
}

export class SendTestEmailResponseDto {
  @ApiProperty({ description: 'Whether the email was sent successfully', example: true })
  success: boolean;

  @ApiProperty({ description: 'Result message', example: 'Test email sent successfully' })
  message: string;

  @ApiPropertyOptional({ description: 'Error message if failed' })
  error?: string;

  @ApiPropertyOptional({ description: 'Message ID from provider', example: 'msg_123abc' })
  messageId?: string;
}
