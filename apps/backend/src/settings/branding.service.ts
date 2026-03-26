import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { db } from '../db/client';
import { systemConfig } from '../db/schema';
import { eq } from 'drizzle-orm';
import { IStorageAdapter } from '../storage/storage.interface';
import { Inject, Optional } from '@nestjs/common';
import { DYNAMIC_STORAGE_ADAPTER } from '../storage/storage.module';

export interface BrandingConfig {
  siteName: string;
  headerLogoKey: string | null;
  authLogoKey: string | null;
}

export interface PublicBrandingConfig {
  siteName: string;
  hasHeaderLogo: boolean;
  hasAuthLogo: boolean;
}

const DEFAULT_BRANDING: BrandingConfig = {
  siteName: 'BFFLESS',
  headerLogoKey: null,
  authLogoKey: null,
};

const BRANDING_STORAGE_PREFIX = '_system/branding';
const ALLOWED_LOGO_TYPES = ['header', 'auth'] as const;
type LogoType = (typeof ALLOWED_LOGO_TYPES)[number];

const MAX_LOGO_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/gif'];

@Injectable()
export class BrandingService {
  private readonly logger = new Logger(BrandingService.name);

  constructor(
    @Optional()
    @Inject(DYNAMIC_STORAGE_ADAPTER)
    private readonly storageAdapter: IStorageAdapter | null,
  ) {}

  async getBrandingConfig(): Promise<BrandingConfig> {
    const configs = await db.select().from(systemConfig).limit(1);
    if (!configs.length || !configs[0].brandingConfig) {
      return { ...DEFAULT_BRANDING };
    }

    try {
      return { ...DEFAULT_BRANDING, ...JSON.parse(configs[0].brandingConfig) };
    } catch {
      return { ...DEFAULT_BRANDING };
    }
  }

  async getPublicBranding(): Promise<PublicBrandingConfig> {
    const config = await this.getBrandingConfig();
    return {
      siteName: config.siteName,
      hasHeaderLogo: !!config.headerLogoKey,
      hasAuthLogo: !!config.authLogoKey,
    };
  }

  async updateBranding(update: { siteName?: string }): Promise<BrandingConfig> {
    const current = await this.getBrandingConfig();

    if (update.siteName !== undefined) {
      const trimmed = update.siteName.trim();
      if (!trimmed) {
        throw new BadRequestException('Site name cannot be empty');
      }
      if (trimmed.length > 100) {
        throw new BadRequestException('Site name must be 100 characters or less');
      }
      current.siteName = trimmed;
    }

    const configs = await db.select().from(systemConfig).limit(1);
    if (configs.length) {
      await db
        .update(systemConfig)
        .set({
          brandingConfig: JSON.stringify(current),
          updatedAt: new Date(),
        })
        .where(eq(systemConfig.id, configs[0].id));
    }

    return current;
  }

  async uploadLogo(
    type: string,
    file: Buffer,
    mimeType: string,
  ): Promise<BrandingConfig> {
    if (!ALLOWED_LOGO_TYPES.includes(type as LogoType)) {
      throw new BadRequestException(`Invalid logo type. Must be one of: ${ALLOWED_LOGO_TYPES.join(', ')}`);
    }

    if (!this.storageAdapter) {
      throw new BadRequestException('Storage is not configured. Please configure storage first.');
    }

    if (file.length > MAX_LOGO_SIZE) {
      throw new BadRequestException('Logo file must be 2MB or less');
    }

    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new BadRequestException(`Invalid file type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`);
    }

    const ext = this.getExtension(mimeType);
    const storageKey = `${BRANDING_STORAGE_PREFIX}/${type}-logo${ext}`;

    await this.storageAdapter.upload(file, storageKey, { contentType: mimeType });
    this.logger.log(`Uploaded ${type} logo to ${storageKey}`);

    // Update config
    const current = await this.getBrandingConfig();
    if (type === 'header') {
      current.headerLogoKey = storageKey;
    } else {
      current.authLogoKey = storageKey;
    }

    const configs = await db.select().from(systemConfig).limit(1);
    if (configs.length) {
      await db
        .update(systemConfig)
        .set({
          brandingConfig: JSON.stringify(current),
          updatedAt: new Date(),
        })
        .where(eq(systemConfig.id, configs[0].id));
    }

    return current;
  }

  async deleteLogo(type: string): Promise<BrandingConfig> {
    if (!ALLOWED_LOGO_TYPES.includes(type as LogoType)) {
      throw new BadRequestException(`Invalid logo type. Must be one of: ${ALLOWED_LOGO_TYPES.join(', ')}`);
    }

    const current = await this.getBrandingConfig();
    const key = type === 'header' ? current.headerLogoKey : current.authLogoKey;

    if (key && this.storageAdapter) {
      try {
        await this.storageAdapter.delete(key);
      } catch (err) {
        this.logger.warn(`Failed to delete logo from storage: ${err}`);
      }
    }

    if (type === 'header') {
      current.headerLogoKey = null;
    } else {
      current.authLogoKey = null;
    }

    const configs = await db.select().from(systemConfig).limit(1);
    if (configs.length) {
      await db
        .update(systemConfig)
        .set({
          brandingConfig: JSON.stringify(current),
          updatedAt: new Date(),
        })
        .where(eq(systemConfig.id, configs[0].id));
    }

    return current;
  }

  async getLogoBuffer(type: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    if (!ALLOWED_LOGO_TYPES.includes(type as LogoType)) {
      throw new BadRequestException(`Invalid logo type`);
    }

    if (!this.storageAdapter) {
      return null;
    }

    const config = await this.getBrandingConfig();
    const key = type === 'header' ? config.headerLogoKey : config.authLogoKey;

    if (!key) {
      return null;
    }

    try {
      const buffer = await this.storageAdapter.download(key);
      const mimeType = this.getMimeType(key);
      return { buffer, mimeType };
    } catch {
      return null;
    }
  }

  private getExtension(mimeType: string): string {
    const map: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/svg+xml': '.svg',
      'image/webp': '.webp',
      'image/gif': '.gif',
    };
    return map[mimeType] || '.png';
  }

  private getMimeType(key: string): string {
    if (key.endsWith('.svg')) return 'image/svg+xml';
    if (key.endsWith('.png')) return 'image/png';
    if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
    if (key.endsWith('.webp')) return 'image/webp';
    if (key.endsWith('.gif')) return 'image/gif';
    return 'image/png';
  }
}
