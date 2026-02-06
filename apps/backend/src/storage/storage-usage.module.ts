import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StorageUsageService } from './storage-usage.service';
import { StorageQuotaService } from './storage-quota.service';
import { StorageUsageController } from './storage-usage.controller';

/**
 * Storage Usage Module
 *
 * Provides storage usage aggregation and quota management.
 *
 * This module is separate from StorageModule because:
 * 1. It doesn't depend on the storage adapter (queries DB directly)
 * 2. It needs ConfigModule for platform mode detection
 * 3. It can be imported independently
 *
 * Features:
 * - Workspace storage usage aggregation
 * - Usage breakdown by project and branch
 * - Quota configuration (from L2 in platform mode)
 * - Quota enforcement before uploads
 */
@Module({
  imports: [ConfigModule],
  controllers: [StorageUsageController],
  providers: [StorageUsageService, StorageQuotaService],
  exports: [StorageUsageService, StorageQuotaService],
})
export class StorageUsageModule {}
