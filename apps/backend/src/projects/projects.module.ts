import { Module, forwardRef } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectAISettingsService } from './project-ai-settings.service';
import { ProjectsController } from './projects.controller';
import { RepositoriesController } from './repositories.controller';
import { PermissionsModule } from '../permissions/permissions.module';
import { PipelinesModule } from '../pipelines/pipelines.module';
import { DeploymentsModule } from '../deployments/deployments.module';

@Module({
  imports: [
    forwardRef(() => PermissionsModule),
    forwardRef(() => PipelinesModule),
    forwardRef(() => DeploymentsModule),
  ],
  controllers: [ProjectsController, RepositoriesController],
  providers: [ProjectsService, ProjectAISettingsService],
  exports: [ProjectsService, ProjectAISettingsService],
})
export class ProjectsModule {}
