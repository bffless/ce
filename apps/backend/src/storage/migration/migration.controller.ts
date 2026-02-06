import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  Inject,
  BadRequestException,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { StorageMigrationService } from './migration.service';
import { SetupService } from '../../setup/setup.service';
import { STORAGE_ADAPTER, IStorageAdapter } from '../storage.interface';
import { StorageModule } from '../storage.module';
import {
  MigrationProgress,
  MigrationScope,
  StartMigrationDto,
  CompleteMigrationDto,
  MigrationStatus,
} from './migration.interface';
import { SessionAuthGuard } from '../../auth/session-auth.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';

@ApiTags('Storage Migration')
@Controller('api/storage/migration')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('admin')
export class MigrationController {
  private readonly logger = new Logger(MigrationController.name);

  constructor(
    private readonly migrationService: StorageMigrationService,
    private readonly setupService: SetupService,
    @Inject(STORAGE_ADAPTER) private readonly currentStorage: IStorageAdapter,
  ) {}

  @Get('scope')
  @ApiOperation({ summary: 'Calculate migration scope' })
  @ApiQuery({ name: 'prefix', required: false })
  @ApiResponse({ status: 200, description: 'Migration scope calculated' })
  async calculateScope(@Query('prefix') prefix?: string): Promise<MigrationScope> {
    return this.migrationService.calculateScope(this.currentStorage, prefix);
  }

  @Post('start')
  @ApiOperation({ summary: 'Start storage migration' })
  @ApiResponse({ status: 200, description: 'Migration started' })
  @ApiResponse({ status: 400, description: 'Migration already in progress or invalid config' })
  async startMigration(
    @Body() dto: StartMigrationDto,
  ): Promise<{ jobId: string; message: string }> {
    // Create target adapter using StorageModule factory
    const targetAdapter = StorageModule.createAdapter({
      storageType: dto.provider,
      config: dto.config,
    });

    // Test target connection
    const connected = await targetAdapter.testConnection();
    if (!connected) {
      throw new BadRequestException('Cannot connect to target storage provider');
    }

    // Get current storage provider name
    const systemConfig = await this.setupService.getSystemConfig();
    const sourceProviderName = systemConfig?.storageProvider || 'unknown';

    // Start migration
    const jobId = await this.migrationService.startMigration(
      this.currentStorage,
      targetAdapter,
      sourceProviderName,
      dto.provider,
      dto.config, // Store target config for later use
      dto.options,
    );

    return {
      jobId,
      message: 'Migration started',
    };
  }

  @Get('progress')
  @ApiOperation({ summary: 'Get migration progress' })
  @ApiResponse({ status: 200, description: 'Current migration progress' })
  async getProgress(): Promise<MigrationProgress | { status: 'none' }> {
    const progress = this.migrationService.getProgress();
    if (!progress) {
      return { status: 'none' };
    }
    return progress;
  }

  @Get('job')
  @ApiOperation({ summary: 'Get current migration job details' })
  @ApiResponse({ status: 200, description: 'Current migration job' })
  async getJob(): Promise<{
    id?: string;
    sourceProvider?: string;
    targetProvider?: string;
    targetConfig?: Record<string, unknown>;
    status: MigrationStatus | 'none';
    progress?: MigrationProgress;
  }> {
    const job = this.migrationService.getCurrentJob();
    if (!job) {
      return { status: 'none' };
    }
    return {
      id: job.id,
      sourceProvider: job.sourceProvider,
      targetProvider: job.targetProvider,
      targetConfig: job.targetConfig, // Return config for frontend to use
      status: job.status,
      progress: job.progress,
    };
  }

  @Delete('cancel')
  @ApiOperation({ summary: 'Cancel current migration' })
  @ApiResponse({ status: 200, description: 'Migration cancelled' })
  async cancelMigration(): Promise<{ success: boolean }> {
    await this.migrationService.cancelMigration();
    return { success: true };
  }

  @Post('resume')
  @ApiOperation({ summary: 'Resume a paused migration' })
  @ApiResponse({ status: 200, description: 'Migration resumed' })
  async resumeMigration(
    @Body() dto: { config: Record<string, unknown> },
  ): Promise<{ success: boolean }> {
    const job = this.migrationService.getCurrentJob();
    if (!job) {
      throw new BadRequestException('No migration to resume');
    }

    // Recreate target adapter
    const targetAdapter = StorageModule.createAdapter({
      storageType: job.targetProvider as 'local' | 'minio' | 's3' | 'gcs' | 'azure',
      config: dto.config,
    });

    await this.migrationService.resumeMigration(this.currentStorage, targetAdapter);
    return { success: true };
  }

  @Post('complete')
  @ApiOperation({ summary: 'Complete migration and switch to new provider' })
  @ApiResponse({ status: 200, description: 'Migration completed, provider switched' })
  async completeMigration(@Body() dto: CompleteMigrationDto): Promise<{ success: boolean }> {
    const progress = this.migrationService.getProgress();
    if (progress?.status !== MigrationStatus.COMPLETED) {
      throw new BadRequestException('Migration is not complete');
    }

    // Save new storage config using SetupService
    // Note: We need a method on SetupService to update storage config post-setup
    await this.saveStorageConfig(dto.provider, dto.config);

    this.logger.log(`Storage provider switched to ${dto.provider}`);

    return { success: true };
  }

  /**
   * Save storage configuration after migration
   * This updates the storage provider without requiring setup wizard
   */
  private async saveStorageConfig(
    provider: string,
    config: Record<string, unknown>,
  ): Promise<void> {
    // Import database operations for direct update
    const { db } = await import('../../db/client');
    const { systemConfig } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');
    const crypto = await import('crypto');

    const sysConfig = await this.setupService.getSystemConfig();
    if (!sysConfig) {
      throw new BadRequestException('System configuration not found');
    }

    // Get encryption key from environment (same as SetupService uses)
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new BadRequestException('ENCRYPTION_KEY not configured');
    }
    const key = Buffer.from(encryptionKey, 'base64');

    // Encrypt storage config
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(JSON.stringify(config), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    const encryptedConfig = `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;

    // Update system config
    await db
      .update(systemConfig)
      .set({
        storageProvider: provider,
        storageConfig: encryptedConfig,
        updatedAt: new Date(),
      })
      .where(eq(systemConfig.id, sysConfig.id));

    this.logger.log(`Storage configuration updated to ${provider}`);
  }
}
