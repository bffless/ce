import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsBoolean, IsOptional, IsEmail } from 'class-validator';

export class UpdateSmtpDto {
  @ApiProperty({ description: 'SMTP server host', example: 'smtp.gmail.com' })
  @IsString()
  @IsNotEmpty()
  host: string;

  @ApiProperty({ description: 'SMTP server port', example: 587 })
  @IsNumber()
  @IsNotEmpty()
  port: number;

  @ApiPropertyOptional({ description: 'Use SSL/TLS', default: false })
  @IsBoolean()
  @IsOptional()
  secure?: boolean;

  @ApiProperty({ description: 'SMTP username/email' })
  @IsString()
  @IsNotEmpty()
  user: string;

  @ApiProperty({ description: 'SMTP password or app password' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiPropertyOptional({ description: 'From email address', example: 'noreply@example.com' })
  @IsEmail()
  @IsOptional()
  fromAddress?: string;

  @ApiPropertyOptional({ description: 'From display name', example: 'Static Asset Platform' })
  @IsString()
  @IsOptional()
  fromName?: string;
}

export class SmtpStatusResponseDto {
  @ApiProperty({ description: 'Whether SMTP is configured' })
  isConfigured: boolean;

  @ApiPropertyOptional({ description: 'SMTP host' })
  host?: string;

  @ApiPropertyOptional({ description: 'SMTP port' })
  port?: number;

  @ApiPropertyOptional({ description: 'Whether SSL/TLS is enabled' })
  secure?: boolean;

  @ApiPropertyOptional({ description: 'SMTP user (masked)' })
  user?: string;

  @ApiPropertyOptional({ description: 'From email address' })
  fromAddress?: string;

  @ApiPropertyOptional({ description: 'From display name' })
  fromName?: string;
}

export class TestSmtpResponseDto {
  @ApiProperty({ description: 'Whether the test was successful' })
  success: boolean;

  @ApiProperty({ description: 'Status message' })
  message: string;

  @ApiPropertyOptional({ description: 'Error details if failed' })
  error?: string;
}
