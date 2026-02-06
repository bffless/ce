import { Module, Global } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';
import { FeatureFlagsController } from './feature-flags.controller';

/**
 * Feature Flags Module
 *
 * Provides a layered feature flag system with three sources:
 *   1. Environment variables (set at container creation by PaaS)
 *   2. Config file (./config/features.json - mountable by PaaS)
 *   3. Database (runtime changes via API)
 *
 * Resolution priority: Database > File > Environment > Default
 *
 * Usage:
 * ```typescript
 * @Injectable()
 * export class MyService {
 *   constructor(private featureFlags: FeatureFlagsService) {}
 *
 *   async doSomething() {
 *     if (await this.featureFlags.isEnabled('ENABLE_CUSTOM_DOMAINS')) {
 *       // Feature is enabled
 *     }
 *
 *     const maxProjects = await this.featureFlags.getNumber('MAX_PROJECTS');
 *   }
 * }
 * ```
 *
 * PaaS Integration:
 * - Set env vars in tenant's docker-compose.yml
 * - Mount features.json into ./config/features.json
 * - Use API to set runtime overrides
 */
@Global()
@Module({
  controllers: [FeatureFlagsController],
  providers: [FeatureFlagsService],
  exports: [FeatureFlagsService],
})
export class FeatureFlagsModule {}
