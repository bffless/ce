import { Module } from '@nestjs/common';
import { ResponseHeaderRulesController } from './response-header-rules.controller';
import { ResponseHeaderRulesService } from './response-header-rules.service';
import { ResponseHeaderConfigService } from './response-header-config.service';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [PermissionsModule],
  controllers: [ResponseHeaderRulesController],
  providers: [ResponseHeaderRulesService, ResponseHeaderConfigService],
  exports: [ResponseHeaderRulesService, ResponseHeaderConfigService],
})
export class ResponseHeaderRulesModule {}
