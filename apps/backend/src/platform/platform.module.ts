import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UsageReporterService } from './usage-reporter.service';

/**
 * PlatformModule
 *
 * Provides platform-related services for L1 → L2 communication.
 *
 * This module is marked as @Global so that UsageReporterService
 * can be injected anywhere without explicitly importing PlatformModule.
 *
 * Services:
 * - UsageReporterService: Reports storage usage to Control Plane
 *
 * **Platform Mode Only:**
 * - Services are no-ops when not running in platform mode
 * - Platform mode is detected by presence of CONTROL_PLANE_URL env var
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [UsageReporterService],
  exports: [UsageReporterService],
})
export class PlatformModule {}
