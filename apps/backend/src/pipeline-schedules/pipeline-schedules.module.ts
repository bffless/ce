import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PipelineSchedulesController } from './pipeline-schedules.controller';
import { PipelineSchedulesService } from './pipeline-schedules.service';
import { PipelineSchedulesScheduler } from './pipeline-schedules.scheduler';
import { PermissionsModule } from '../permissions/permissions.module';
import { PipelinesModule } from '../pipelines/pipelines.module';

@Module({
  imports: [ScheduleModule.forRoot(), PermissionsModule, PipelinesModule],
  controllers: [PipelineSchedulesController],
  providers: [PipelineSchedulesService, PipelineSchedulesScheduler],
  exports: [PipelineSchedulesService],
})
export class PipelineSchedulesModule {}
