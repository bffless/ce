import { Module, forwardRef } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { RepositoriesController } from './repositories.controller';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [forwardRef(() => PermissionsModule)],
  controllers: [ProjectsController, RepositoriesController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
