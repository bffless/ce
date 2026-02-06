import { Module } from '@nestjs/common';
import { CacheRulesController } from './cache-rules.controller';
import { CacheRulesService } from './cache-rules.service';
import { CacheConfigService } from './cache-config.service';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [PermissionsModule],
  controllers: [CacheRulesController],
  providers: [CacheRulesService, CacheConfigService],
  exports: [CacheRulesService, CacheConfigService],
})
export class CacheRulesModule {}
