import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RetentionService } from './retention.service';
import { RetentionController } from './retention.controller';
import { RetentionScheduler } from './retention.scheduler';
import { PermissionsModule } from '../permissions/permissions.module';
import { PlatformModule } from '../platform/platform.module';

@Module({
  imports: [ScheduleModule.forRoot(), PermissionsModule, PlatformModule],
  controllers: [RetentionController],
  providers: [RetentionService, RetentionScheduler],
  exports: [RetentionService],
})
export class RetentionModule {}
