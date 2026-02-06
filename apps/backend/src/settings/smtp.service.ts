import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { db } from '../db/client';
import { systemConfig } from '../db/schema';
import { eq } from 'drizzle-orm';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';
import { UpdateSmtpDto, SmtpStatusResponseDto, TestSmtpResponseDto } from './dto/update-smtp.dto';

@Injectable()
export class SmtpService {
  private readonly logger = new Logger(SmtpService.name);
  private readonly ENCRYPTION_KEY: Buffer;
  private readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';

  constructor(private configService: ConfigService) {
    const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY');
    if (encryptionKey) {
      this.ENCRYPTION_KEY = Buffer.from(encryptionKey, 'base64');
    } else {
      this.ENCRYPTION_KEY = crypto.randomBytes(32);
      this.logger.warn('No ENCRYPTION_KEY found. Generated temporary key.');
    }
  }

  /**
   * Get SMTP configuration status (without sensitive data)
   */
  async getSmtpStatus(): Promise<SmtpStatusResponseDto> {
    try {
      const config = await this.getSystemConfig();

      if (!config || !config.smtpConfig || !config.smtpConfigured) {
        return { isConfigured: false };
      }

      const smtpConfig = JSON.parse(this.decryptData(config.smtpConfig));

      return {
        isConfigured: true,
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        user: this.maskEmail(smtpConfig.user),
        fromAddress: smtpConfig.fromAddress,
        fromName: smtpConfig.fromName,
      };
    } catch (error) {
      this.logger.error('Error getting SMTP status:', error);
      return { isConfigured: false };
    }
  }

  /**
   * Update SMTP configuration
   */
  async updateSmtp(dto: UpdateSmtpDto): Promise<SmtpStatusResponseDto> {
    try {
      const smtpConfig = {
        host: dto.host,
        port: dto.port,
        secure: dto.secure || false,
        user: dto.user,
        password: dto.password,
        fromAddress: dto.fromAddress || dto.user,
        fromName: dto.fromName || 'Static Asset Platform',
      };

      const encryptedConfig = this.encryptData(JSON.stringify(smtpConfig));

      const config = await this.getSystemConfig();
      if (!config) {
        throw new InternalServerErrorException('System configuration not found');
      }

      await db
        .update(systemConfig)
        .set({
          smtpConfig: encryptedConfig,
          smtpConfigured: true,
          updatedAt: new Date(),
        })
        .where(eq(systemConfig.id, config.id));

      this.logger.log('SMTP configuration updated');

      return {
        isConfigured: true,
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        user: this.maskEmail(smtpConfig.user),
        fromAddress: smtpConfig.fromAddress,
        fromName: smtpConfig.fromName,
      };
    } catch (error) {
      this.logger.error('Error updating SMTP:', error);
      throw new InternalServerErrorException('Failed to update SMTP configuration');
    }
  }

  /**
   * Test SMTP connection
   */
  async testSmtpConnection(): Promise<TestSmtpResponseDto> {
    try {
      const config = await this.getSystemConfig();

      if (!config || !config.smtpConfig) {
        return {
          success: false,
          message: 'SMTP not configured',
          error: 'No SMTP configuration found',
        };
      }

      const smtpConfig = JSON.parse(this.decryptData(config.smtpConfig));

      const transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure || false,
        auth: {
          user: smtpConfig.user,
          pass: smtpConfig.password,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
      });

      await transporter.verify();

      this.logger.log('SMTP connection test passed');

      return {
        success: true,
        message: 'Successfully connected to SMTP server',
      };
    } catch (error) {
      this.logger.error('SMTP connection test failed:', error);
      return {
        success: false,
        message: 'SMTP connection test failed',
        error: error.message,
      };
    }
  }

  private async getSystemConfig() {
    const configs = await db.select().from(systemConfig).limit(1);
    return configs.length > 0 ? configs[0] : null;
  }

  private maskEmail(email: string): string {
    const [localPart, domain] = email.split('@');
    if (!domain) return email;

    const maskedLocal =
      localPart.length > 2 ? localPart.substring(0, 2) + '***' : localPart + '***';

    return `${maskedLocal}@${domain}`;
  }

  private encryptData(data: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.ENCRYPTION_ALGORITHM, this.ENCRYPTION_KEY, iv);

    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  private decryptData(encryptedData: string): string {
    const [ivHex, authTagHex, encrypted] = encryptedData.split(':');

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(this.ENCRYPTION_ALGORITHM, this.ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
